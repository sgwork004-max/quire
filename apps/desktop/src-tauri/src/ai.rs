//! AI editing with the user's own Anthropic API key.
//!
//! The key is stored in the macOS Keychain and only ever used here, in Rust;
//! the UI never sees it. Claude is asked for the smallest set of exact
//! find/replace edits (structured output), which the UI shows as a diff for
//! the user to accept, so nothing changes without review.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const KEYCHAIN_SERVICE: &str = "app.quire.desktop";
const KEYCHAIN_ACCOUNT: &str = "anthropic-api-key";
const API: &str = "https://api.anthropic.com/v1/messages";
const MODEL: &str = "claude-opus-5-5";
/// Largest document sent to Claude (characters).
const MAX_DOCUMENT: usize = 600_000;

const SYSTEM: &str = "You edit HTML documents for the user of Quire, an HTML editor.\n\
Return the smallest set of edits that carries out the user's request, as exact find/replace pairs:\n\
- Every `find` must be copied character for character from the document, including whitespace and line breaks, and must occur exactly once. Include enough surrounding text to make it unique.\n\
- To insert something, find a nearby unique snippet and replace it with that snippet plus the new content.\n\
- Change nothing the request doesn't need. Keep the document's existing style, structure and libraries.\n\
- Write production-quality HTML/CSS/JS. Never leave placeholders or TODOs.\n\
If the user points at a specific element, focus your changes there.\n\
If the request can't be done safely or is unclear, return no edits and explain why in `summary`.\n\
`summary` is one or two plain sentences for the user describing what you changed.";

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

fn api_key() -> Option<String> {
    keychain().ok()?.get_password().ok()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Quire/", env!("CARGO_PKG_VERSION")))
        // Edits on large pages can take a while; this is a single request.
        .timeout(Duration::from_secs(300))
        .build()
        .expect("http client")
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Edit {
    pub find: String,
    pub replace: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct EditPlan {
    pub summary: String,
    pub edits: Vec<Edit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Focus {
    tag: String,
    snippet: String,
    source: String,
}

#[tauri::command]
pub fn ai_key_status() -> bool {
    api_key().is_some()
}

/// Checks the key with Anthropic before saving it, so typos fail right away.
#[tauri::command]
pub async fn ai_set_key(key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    if !key.starts_with("sk-ant-") {
        return Err("That doesn't look like an Anthropic API key (they start with sk-ant-).".into());
    }
    let res = client()
        .get("https://api.anthropic.com/v1/models?limit=1")
        .header("x-api-key", &key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|_| "Can't reach Anthropic. Check your connection.".to_string())?;
    if res.status() == reqwest::StatusCode::UNAUTHORIZED || res.status() == reqwest::StatusCode::FORBIDDEN {
        return Err("Anthropic didn't accept that key.".into());
    }
    keychain()?.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_remove_key() -> Result<(), String> {
    match keychain()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Asks Claude for edits to `html` that carry out `instruction`.
#[tauri::command]
pub async fn ai_edit(html: String, instruction: String, focus: Option<Focus>) -> Result<EditPlan, String> {
    let key = api_key().ok_or("Add your Anthropic API key to use AI edit.")?;
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err("Describe the change you want.".into());
    }
    if html.len() > MAX_DOCUMENT {
        return Err("This file is too large for AI edit.".into());
    }

    let mut request = format!("Request: {instruction}");
    if let Some(f) = &focus {
        request.push_str(&format!(
            "\n\nThe user selected this <{}> element (\"{}\"). Its source in the document:\n<selected>\n{}\n</selected>",
            f.tag, f.snippet, f.source
        ));
    }

    let body = json!({
        "model": MODEL,
        "max_tokens": 16000,
        "fallbacks": "default",
        "output_config": {
            "effort": "medium",
            "format": {
                "type": "json_schema",
                "schema": {
                    "type": "object",
                    "properties": {
                        "summary": { "type": "string" },
                        "edits": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "find": { "type": "string" },
                                    "replace": { "type": "string" }
                                },
                                "required": ["find", "replace"],
                                "additionalProperties": false
                            }
                        }
                    },
                    "required": ["summary", "edits"],
                    "additionalProperties": false
                }
            }
        },
        "system": SYSTEM,
        "messages": [{
            "role": "user",
            "content": [
                // The document is cached so follow-up edits to the same page are cheaper.
                { "type": "text", "text": format!("<document>\n{html}\n</document>"), "cache_control": { "type": "ephemeral" } },
                { "type": "text", "text": request }
            ]
        }]
    });

    let res = client()
        .post(API)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", "server-side-fallback-2026-07-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() { "Claude took too long. Try a smaller change.".to_string() } else { "Can't reach Anthropic. Check your connection.".to_string() }
        })?;

    let status = res.status();
    let value: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let message = value["error"]["message"].as_str().unwrap_or("request failed");
        return Err(match status.as_u16() {
            401 | 403 => "Anthropic didn't accept your API key. Update it in AI settings.".into(),
            429 => "Anthropic rate limit reached. Wait a moment and try again.".into(),
            529 | 503 => "Claude is busy right now. Try again in a moment.".into(),
            _ => format!("Claude returned an error: {message}"),
        });
    }

    match value["stop_reason"].as_str() {
        Some("refusal") => return Err("Claude declined this request.".into()),
        Some("max_tokens") => return Err("That change is too large to make in one go. Try a smaller step.".into()),
        _ => {}
    }
    let text = value["content"]
        .as_array()
        .and_then(|blocks| blocks.iter().find(|b| b["type"] == "text"))
        .and_then(|b| b["text"].as_str())
        .ok_or("Claude didn't return any edits.")?;
    serde_json::from_str::<EditPlan>(text).map_err(|_| "Claude's answer couldn't be read. Try again.".into())
}
