//! Quire account sign-in.
//!
//! Uses the OAuth 2.0 device authorization grant (RFC 8628): the app asks the
//! cloud for a short code, opens the browser where the person signs in and
//! approves that code, and meanwhile polls until the cloud hands over a session
//! token. The token lives in the macOS Keychain, never on disk in plain text.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const CLIENT_ID: &str = "quire-desktop";
const KEYCHAIN_SERVICE: &str = "app.quire.desktop";
const KEYCHAIN_ACCOUNT: &str = "session";

/// Cloud API base URL. Override with QUIRE_API_URL at runtime or build time.
pub fn api_base() -> String {
    std::env::var("QUIRE_API_URL")
        .ok()
        .or_else(|| option_env!("QUIRE_API_URL").map(str::to_string))
        .unwrap_or_else(|| {
            if cfg!(debug_assertions) { "http://localhost:8787" } else { "https://cloud.quire.app" }.to_string()
        })
        .trim_end_matches('/')
        .to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub email: String,
    pub image: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInStart {
    pub user_code: String,
    pub verification_url: String,
    pub expires_in: u64,
}

#[derive(Deserialize)]
struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri_complete: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: Option<String>,
    error: Option<String>,
}

/// Signed-in state. The token is cached in memory so the Keychain is read once.
pub struct AuthState {
    http: reqwest::Client,
    token: Mutex<Option<String>>,
    loaded: Mutex<bool>,
    /// Bumped to cancel an in-flight sign-in poll.
    attempt: AtomicU64,
}

impl Default for AuthState {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .user_agent(concat!("Quire/", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(20))
                .build()
                .expect("http client"),
            token: Mutex::new(None),
            loaded: Mutex::new(false),
            attempt: AtomicU64::new(0),
        }
    }
}

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

impl AuthState {
    fn token(&self) -> Option<String> {
        let mut loaded = self.loaded.lock().unwrap();
        if !*loaded {
            *loaded = true;
            *self.token.lock().unwrap() = keychain().ok().and_then(|k| k.get_password().ok());
        }
        self.token.lock().unwrap().clone()
    }

    fn set_token(&self, token: Option<String>) -> Result<(), String> {
        let entry = keychain()?;
        match &token {
            Some(t) => entry.set_password(t).map_err(|e| e.to_string())?,
            None => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(e) => return Err(e.to_string()),
            },
        }
        *self.loaded.lock().unwrap() = true;
        *self.token.lock().unwrap() = token;
        Ok(())
    }

    /// GET/PATCH /api/me. Clears the token if the server says it is no longer valid.
    async fn me(&self, update: Option<&str>) -> Result<Option<Account>, String> {
        let Some(token) = self.token() else { return Ok(None) };
        let url = format!("{}/api/me", api_base());
        let req = match update {
            Some(name) => self.http.patch(url).json(&serde_json::json!({ "name": name })),
            None => self.http.get(url),
        };
        let res = req.bearer_auth(token).send().await.map_err(offline)?;
        if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            self.set_token(None)?;
            return Ok(None);
        }
        if !res.status().is_success() {
            let body: serde_json::Value = res.json().await.unwrap_or_default();
            return Err(body["error"].as_str().unwrap_or("Request failed").to_string());
        }
        res.json().await.map(Some).map_err(|e| e.to_string())
    }
}

fn offline(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        "Can't reach Quire Cloud. Check your connection.".into()
    } else {
        e.to_string()
    }
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub async fn account(state: tauri::State<'_, AuthState>) -> Result<Option<Account>, String> {
    state.me(None).await
}

#[tauri::command]
pub async fn update_profile(state: tauri::State<'_, AuthState>, name: String) -> Result<Option<Account>, String> {
    state.me(Some(name.trim())).await
}

#[tauri::command]
pub async fn start_sign_in(app: AppHandle, state: tauri::State<'_, AuthState>) -> Result<SignInStart, String> {
    let res = state
        .http
        .post(format!("{}/api/auth/device/code", api_base()))
        .json(&serde_json::json!({ "client_id": CLIENT_ID }))
        .send()
        .await
        .map_err(offline)?;
    if !res.status().is_success() {
        return Err(format!("Sign-in is unavailable right now ({})", res.status()));
    }
    let code: DeviceCode = res.json().await.map_err(|e| e.to_string())?;
    let attempt = state.attempt.fetch_add(1, Ordering::SeqCst) + 1;

    let _ = tauri_plugin_opener::open_url(&code.verification_uri_complete, None::<&str>);
    let start = SignInStart {
        user_code: code.user_code.clone(),
        verification_url: code.verification_uri_complete.clone(),
        expires_in: code.expires_in,
    };
    tauri::async_runtime::spawn(poll(app, attempt, code));
    Ok(start)
}

#[tauri::command]
pub fn cancel_sign_in(state: tauri::State<'_, AuthState>) {
    state.attempt.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
pub async fn sign_out(app: AppHandle, state: tauri::State<'_, AuthState>) -> Result<(), String> {
    if let Some(token) = state.token() {
        // Revoke on the server when we can; signing out locally must work offline.
        let _ = state
            .http
            .post(format!("{}/api/auth/sign-out", api_base()))
            .header("Origin", api_base())
            .bearer_auth(token)
            .json(&serde_json::json!({}))
            .send()
            .await;
    }
    state.set_token(None)?;
    let _ = app.emit("auth-changed", Option::<Account>::None);
    Ok(())
}

/// Polls for the token until the person approves, denies or the code expires.
async fn poll(app: AppHandle, attempt: u64, code: DeviceCode) {
    let state = app.state::<AuthState>();
    let mut interval = code.interval.max(1);
    let deadline = std::time::Instant::now() + Duration::from_secs(code.expires_in);
    let fail = |reason: &str| {
        let _ = app.emit("auth-failed", reason);
    };

    while std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if state.attempt.load(Ordering::SeqCst) != attempt {
            return; // cancelled or superseded
        }
        let reply = state
            .http
            .post(format!("{}/api/auth/device/token", api_base()))
            .json(&serde_json::json!({
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": code.device_code,
                "client_id": CLIENT_ID,
            }))
            .send()
            .await;
        let Ok(reply) = reply else { continue }; // transient network error: keep trying
        let Ok(body) = reply.json::<TokenReply>().await else { continue };
        if let Some(token) = body.access_token {
            if let Err(e) = state.set_token(Some(token)) {
                return fail(&format!("Couldn't save your sign-in to the Keychain: {e}"));
            }
            match state.me(None).await {
                Ok(Some(account)) => {
                    let _ = app.emit("auth-changed", Some(account));
                }
                Ok(None) => fail("The sign-in was rejected. Try again."),
                Err(e) => fail(&e),
            }
            return;
        }
        match body.error.as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval += 5,
            Some("access_denied") => return fail("Sign-in was cancelled in the browser."),
            Some("expired_token") => return fail("The sign-in code expired. Try again."),
            _ => {}
        }
    }
    if state.attempt.load(Ordering::SeqCst) == attempt {
        fail("The sign-in code expired. Try again.");
    }
}
