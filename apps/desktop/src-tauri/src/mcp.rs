//! Built-in MCP server: `quire mcp` speaks the Model Context Protocol over
//! stdio so Claude (desktop app, Claude Code) can find, read, create and
//! update HTML in the user's Quire library and open it in the app.
//!
//! It runs as a separate, windowless process started by Claude, using the
//! same database and library code as the app. Writes are limited to HTML
//! files in the library, and the previous content of a file is saved to
//! version history before it is replaced, so every change can be undone.
//!
//! `connect_claude` / `disconnect_claude` register this server with the
//! Claude desktop app and Claude Code.

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::db::Db;
use crate::documents::is_html;
use crate::library::{self, Query};

const APP_ID: &str = "app.quire.desktop";
const MAX_FILE_BYTES: usize = 5 * 1024 * 1024;
const PROTOCOL: &str = "2025-06-18";
const SERVER_NAME: &str = "quire";

const INSTRUCTIONS: &str = "Quire is the user's app for viewing, organising and sharing HTML files. \
Whenever you make an HTML page, dashboard, report or prototype for the user, save it with quire_create_file so it appears in Quire, and tell them it's there. \
When you revise a page you already saved, call quire_update_file with the same path instead of creating a new file; Quire keeps the previous version in its history. \
Use quire_list_files to find a page the user mentions.";

// ---------------------------------------------------------------- paths

fn home() -> Option<PathBuf> {
    crate::home_dir()
}

/// Where the app keeps its database (Tauri's app data dir for our identifier).
fn data_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("QUIRE_DATA_DIR") {
        return Some(PathBuf::from(dir));
    }
    #[cfg(target_os = "macos")]
    return home().map(|h| h.join("Library/Application Support").join(APP_ID));
    #[cfg(target_os = "windows")]
    return std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(APP_ID));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return home().map(|h| h.join(".local/share").join(APP_ID));
}

/// ~/Quire, where new files go unless a folder is named.
fn default_folder() -> Result<PathBuf, String> {
    let dir = home().ok_or("No home folder")?.join("Quire");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::documents::dunce_canonicalize(&dir)
}

fn expand_home(p: &str) -> PathBuf {
    match (p.strip_prefix("~/"), home()) {
        (Some(rest), Some(h)) => h.join(rest),
        _ => PathBuf::from(p),
    }
}

// ---------------------------------------------------------------- tools

struct Tools {
    db: Db,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo {
    path: String,
    name: String,
    title: Option<String>,
    folder: String,
    modified_ms: i64,
    size_bytes: i64,
    starred: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    snippet: Option<String>,
}

impl Tools {
    fn open() -> Result<Self, String> {
        let dir = data_dir().ok_or("No home folder")?;
        if !dir.join("quire.db").exists() {
            return Err("Quire's library wasn't found. Open the Quire app once to create it.".into());
        }
        Ok(Self { db: Db::open(&dir)? })
    }

    fn list(&self, query: Option<&str>, limit: usize) -> Result<Vec<FileInfo>, String> {
        let q = Query {
            view: if query.is_some() { "all".into() } else { "recent".into() },
            location_id: None,
            tag_id: None,
            folder_id: None,
            search: query.map(str::to_string),
            sort: None,
        };
        let mut files = library::query(&self.db.conn(), &q)?;
        if files.is_empty() && query.is_none() {
            files = library::query(&self.db.conn(), &Query { view: "all".into(), ..q })?;
        }
        Ok(files
            .into_iter()
            .filter(|f| Path::new(&f.path).exists())
            .take(limit)
            .map(|f| FileInfo {
                path: f.path,
                name: f.name,
                title: f.title,
                folder: f.dir,
                modified_ms: f.modified_ms,
                size_bytes: f.size_bytes,
                starred: f.starred,
                snippet: f.snippet.map(|s| s.replace('\u{1}', "«").replace('\u{2}', "»")),
            })
            .collect())
    }

    fn folders(&self) -> Result<Value, String> {
        let overview = library::overview(&self.db.conn())?;
        let on_disk: Vec<Value> = overview.locations.iter().map(|l| json!({ "name": l.name, "path": l.path, "files": l.count })).collect();
        Ok(json!({ "folders": on_disk, "defaultFolder": default_folder()?.to_string_lossy() }))
    }

    /// An HTML file that Quire knows about, or that sits inside a library folder.
    fn resolve_existing(&self, path: &str) -> Result<PathBuf, String> {
        let abs = expand_home(path);
        if !abs.exists() {
            return Err(format!("No file at {path}"));
        }
        let real = crate::documents::dunce_canonicalize(&abs)?;
        if !is_html(&real) {
            return Err("Only HTML files can be used".into());
        }
        let conn = self.db.conn();
        let indexed: bool = conn
            .query_row("SELECT 1 FROM files WHERE path = ?1 AND trashed_ms IS NULL", [real.to_string_lossy()], |_| Ok(()))
            .is_ok();
        let in_library = library::locations(&conn)?.iter().any(|(_, root)| real.starts_with(root));
        if !indexed && !in_library {
            return Err("That file isn't in your Quire library. Open it in Quire or add its folder first.".into());
        }
        Ok(real)
    }

    fn read(&self, path: &str) -> Result<String, String> {
        let real = self.resolve_existing(path)?;
        let bytes = std::fs::read(&real).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_FILE_BYTES {
            return Err("File is larger than 5 MB".into());
        }
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn pick_folder(&self, folder: Option<&str>) -> Result<PathBuf, String> {
        let Some(folder) = folder.filter(|f| !f.trim().is_empty()) else { return default_folder() };
        let locations = library::overview(&self.db.conn())?.locations;
        let wanted = expand_home(folder);
        locations
            .iter()
            .find(|l| l.name.eq_ignore_ascii_case(folder) || Path::new(&l.path) == wanted)
            .map(|l| PathBuf::from(&l.path))
            .ok_or_else(|| {
                let names: Vec<&str> = locations.iter().map(|l| l.name.as_str()).collect();
                format!("No library folder called \"{folder}\". Folders: {}", if names.is_empty() { "none yet".into() } else { names.join(", ") })
            })
    }

    /// Creates a new HTML file. Never overwrites.
    fn create(&self, name: &str, html: &str, folder: Option<&str>) -> Result<PathBuf, String> {
        check_size(html)?;
        let dir = self.pick_folder(folder)?;
        let file_name = safe_file_name(name);
        let (stem, ext) = file_name.rsplit_once('.').unwrap_or((&file_name, "html"));
        let target = library::unique_path(&dir, stem, ext);
        crate::commands::write_file(&self.db, &target, html, "claude")?;
        Ok(target)
    }

    /// Replaces a file's content; the previous content is kept in version history.
    fn update(&self, path: &str, html: &str) -> Result<PathBuf, String> {
        check_size(html)?;
        let real = self.resolve_existing(path)?;
        let previous = std::fs::read_to_string(&real).unwrap_or_default();
        if previous == html {
            return Ok(real);
        }
        {
            let conn = self.db.conn();
            let p = real.to_string_lossy();
            crate::versions::record(&conn, &p, &previous, "disk")?;
            crate::versions::close_session(&conn, &p)?;
        }
        crate::commands::write_file(&self.db, &real, html, "claude")?;
        Ok(real)
    }
}

fn check_size(html: &str) -> Result<(), String> {
    if html.len() > MAX_FILE_BYTES {
        return Err("HTML is larger than 5 MB".into());
    }
    Ok(())
}

fn safe_file_name(name: &str) -> String {
    let base = Path::new(name.trim()).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut n: String = base
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '-' } else { c })
        .collect::<String>()
        .trim_start_matches('.')
        .to_string();
    if n.is_empty() {
        n = "Untitled".into();
    }
    if !is_html(Path::new(&n)) {
        n.push_str(".html");
    }
    n.chars().take(200).collect()
}

/// Opens a file in the Quire app.
fn open_in_quire(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let ok = std::process::Command::new("open").args(["-b", APP_ID]).arg(path).status().map(|s| s.success()).unwrap_or(false);
        if ok { Ok(()) } else { Err("Couldn't open Quire. Is it installed?".into()) }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Opening files from Claude works on a Mac only. The file is in your Quire library.".into())
    }
}

fn tool_list() -> Value {
    json!([
        {
            "name": "quire_list_files",
            "title": "List or search HTML files",
            "description": "Lists HTML files in the user's Quire library, most recently opened first. With a query, searches file names, page titles and the visible text of every page.",
            "inputSchema": { "type": "object", "properties": {
                "query": { "type": "string", "description": "Words to search for" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
            } },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "quire_list_folders",
            "title": "List library folders",
            "description": "Lists the folders on this computer that are in the user's Quire library. New files go to ~/Quire unless a folder is named.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "quire_read_file",
            "title": "Read an HTML file",
            "description": "Returns the full HTML source of a file in the user's Quire library.",
            "inputSchema": { "type": "object", "properties": {
                "path": { "type": "string", "description": "Absolute path, as returned by quire_list_files" }
            }, "required": ["path"] },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "quire_create_file",
            "title": "Create an HTML file",
            "description": "Saves a new, complete, self-contained HTML document to the user's Quire library and (by default) opens it in Quire. Never overwrites: a number is added if the name is taken. Use this to deliver dashboards, reports and pages to the user.",
            "inputSchema": { "type": "object", "properties": {
                "name": { "type": "string", "description": "File name, e.g. 'Q3 sales dashboard.html'" },
                "html": { "type": "string", "description": "The complete HTML document" },
                "folder": { "type": "string", "description": "Library folder name from quire_list_folders; defaults to ~/Quire" },
                "open": { "type": "boolean", "description": "Open it in Quire (default true)" }
            }, "required": ["name", "html"] }
        },
        {
            "name": "quire_update_file",
            "title": "Update an HTML file",
            "description": "Replaces the HTML of an existing file in the user's Quire library. The previous version is kept in Quire's version history, and files open in Quire update live. Read the file first and send the complete new document.",
            "inputSchema": { "type": "object", "properties": {
                "path": { "type": "string", "description": "Absolute path of an existing library file" },
                "html": { "type": "string", "description": "The complete new HTML document" }
            }, "required": ["path", "html"] },
            "annotations": { "destructiveHint": false, "idempotentHint": true }
        },
        {
            "name": "quire_open",
            "title": "Open in Quire",
            "description": "Opens a library file in the Quire app.",
            "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] }
        }
    ])
}

fn call_tool(name: &str, args: &Value) -> Result<Value, String> {
    let s = |k: &str| args.get(k).and_then(Value::as_str);
    let need = |k: &str| s(k).ok_or_else(|| format!("Missing \"{k}\""));
    let tools = Tools::open()?;
    match name {
        "quire_list_files" => {
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(25).clamp(1, 100) as usize;
            Ok(json!(tools.list(s("query").filter(|q| !q.trim().is_empty()), limit)?))
        }
        "quire_list_folders" => tools.folders(),
        "quire_read_file" => Ok(Value::String(tools.read(need("path")?)?)),
        "quire_create_file" => {
            let path = tools.create(need("name")?, need("html")?, s("folder"))?;
            let open = args.get("open").and_then(Value::as_bool).unwrap_or(true);
            let opened = open && open_in_quire(&path).is_ok();
            Ok(json!({ "path": path.to_string_lossy(), "opened": opened }))
        }
        "quire_update_file" => {
            let path = tools.update(need("path")?, need("html")?)?;
            Ok(json!({ "path": path.to_string_lossy(), "previousVersionSaved": true }))
        }
        "quire_open" => {
            let path = tools.resolve_existing(need("path")?)?;
            open_in_quire(&path)?;
            Ok(json!({ "opened": path.to_string_lossy() }))
        }
        _ => Err(format!("Unknown tool {name}")),
    }
}

fn as_text(v: Value) -> Value {
    let text = match v {
        Value::String(s) => s,
        other => serde_json::to_string_pretty(&other).unwrap_or_default(),
    };
    json!([{ "type": "text", "text": text }])
}

/// Handles one JSON-RPC message. Returns the response, or None for notifications.
fn handle(msg: &Value) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => {
            let requested = params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL);
            Ok(json!({
                "protocolVersion": requested,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": SERVER_NAME, "title": "Quire", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_list() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            Ok(match call_tool(name, &args) {
                Ok(v) => json!({ "content": as_text(v) }),
                Err(e) => json!({ "content": as_text(Value::String(e)), "isError": true }),
            })
        }
        "resources/list" => Ok(json!({ "resources": [] })),
        "prompts/list" => Ok(json!({ "prompts": [] })),
        _ => Err(json!({ "code": -32601, "message": format!("Method not found: {method}") })),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
    })
}

/// Runs the server on stdin/stdout until the client disconnects.
pub fn run() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(batch)) => {
                let replies: Vec<Value> = batch.iter().filter_map(handle).collect();
                (!replies.is_empty()).then(|| Value::Array(replies))
            }
            Ok(msg) => handle(&msg),
            Err(e) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": e.to_string() } })),
        };
        if let Some(r) = response {
            let _ = writeln!(out, "{r}");
            let _ = out.flush();
        }
    }
}

// ---------------------------------------------------------------- connecting Claude

/// The command Claude runs to start this server: the Quire executable itself.
fn server_command() -> Result<String, String> {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())
}

fn desktop_config() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return home().map(|h| h.join("Library/Application Support/Claude/claude_desktop_config.json"));
    #[cfg(target_os = "windows")]
    return std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("Claude").join("claude_desktop_config.json"));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return home().map(|h| h.join(".config/Claude/claude_desktop_config.json"));
}

/// Claude Code keeps user-wide MCP servers in ~/.claude.json.
fn code_config() -> Option<PathBuf> {
    home().map(|h| h.join(".claude.json"))
}

fn read_json(path: &Path) -> Result<Value, String> {
    match std::fs::read_to_string(path) {
        Ok(s) if s.trim().is_empty() => Ok(json!({})),
        Ok(s) => serde_json::from_str(&s).map_err(|_| format!("{} isn't valid JSON, so Quire left it alone", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(e.to_string()),
    }
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("quire-tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(value).map_err(|e| e.to_string())? + "\n").map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn is_connected(config: &Value, command: &str) -> bool {
    config["mcpServers"][SERVER_NAME]["command"].as_str() == Some(command)
}

/// Adds (or removes) the Quire server in a Claude config file, keeping everything else.
fn set_server(path: &Path, on: bool, command: &str) -> Result<(), String> {
    set_server_entry(path, on, json!({ "command": command, "args": ["mcp"] }))
}

fn set_server_entry(path: &Path, on: bool, entry: Value) -> Result<(), String> {
    let mut config = read_json(path)?;
    let root = config.as_object_mut().ok_or("Unexpected Claude settings format")?;
    let servers = root.entry("mcpServers").or_insert_with(|| json!({}));
    let servers = servers.as_object_mut().ok_or("Unexpected Claude settings format")?;
    if on {
        servers.insert(SERVER_NAME.into(), entry);
    } else if servers.remove(SERVER_NAME).is_none() {
        return Ok(());
    }
    write_json(path, &config)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeTarget {
    /// The Claude app (or Claude Code) seems to be installed.
    installed: bool,
    /// Quire is registered with it.
    connected: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    desktop: ClaudeTarget,
    code: ClaudeTarget,
}

fn target_status(path: Option<PathBuf>, installed: bool, command: &str) -> ClaudeTarget {
    let connected = path.and_then(|p| read_json(&p).ok()).map(|c| is_connected(&c, command)).unwrap_or(false);
    ClaudeTarget { installed: installed || connected, connected }
}

#[tauri::command]
pub fn claude_status() -> Result<ClaudeStatus, String> {
    let command = server_command()?;
    let desktop_installed = desktop_config().and_then(|p| p.parent().map(Path::exists)).unwrap_or(false)
        || cfg!(target_os = "macos") && Path::new("/Applications/Claude.app").exists();
    let code_installed = code_config().map(|p| p.exists()).unwrap_or(false);
    Ok(ClaudeStatus {
        desktop: target_status(desktop_config(), desktop_installed, &command),
        code: target_status(code_config(), code_installed, &command),
    })
}

/// Runs Claude Code's own `claude mcp …` command through the user's login
/// shell (apps opened from the Dock don't get the Terminal's PATH).
/// Returns false if Claude Code's command isn't available.
fn claude_cli(args: &[&str]) -> bool {
    #[cfg(unix)]
    {
        let quoted: Vec<String> = args.iter().map(|a| format!("'{}'", a.replace('\'', "'\\''"))).collect();
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        std::process::Command::new(shell)
            .args(["-lc", &format!("command -v claude >/dev/null && claude {}", quoted.join(" "))])
            .stdin(std::process::Stdio::null())
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        std::process::Command::new("cmd")
            .args(["/C", "claude"])
            .args(args)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Registers Quire with the Claude desktop app ("desktop") or Claude Code ("code").
#[tauri::command(async)]
pub fn connect_claude(target: String, connect: bool) -> Result<(), String> {
    let command = server_command()?;
    match target.as_str() {
        "desktop" => set_server(&desktop_config().ok_or("No home folder")?, connect, &command),
        "code" => {
            // Prefer Claude Code's own command: it may be rewriting ~/.claude.json while running.
            let _ = claude_cli(&["mcp", "remove", "--scope", "user", SERVER_NAME]);
            if !connect || claude_cli(&["mcp", "add", "--scope", "user", SERVER_NAME, "--", &command, "mcp"]) {
                if !connect {
                    set_server(&code_config().ok_or("No home folder")?, false, &command)?;
                }
                return Ok(());
            }
            let entry = json!({ "type": "stdio", "command": command, "args": ["mcp"], "env": {} });
            set_server_entry(&code_config().ok_or("No home folder")?, true, entry)
        }
        _ => Err("Unknown Claude app".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_the_mcp_handshake_and_lists_tools() {
        let init = handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } })).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["result"]["serverInfo"]["name"], "quire");
        assert!(handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none(), "notifications get no reply");
        let tools = handle(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        let names: Vec<&str> = tools["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"quire_update_file") && names.contains(&"quire_create_file"));
        let missing = handle(&json!({ "jsonrpc": "2.0", "id": 3, "method": "nope" })).unwrap();
        assert_eq!(missing["error"]["code"], -32601);
    }

    #[test]
    fn edits_claude_config_without_touching_other_settings() {
        let dir = std::env::temp_dir().join(format!("quire-mcp-{:x}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("claude_desktop_config.json");
        std::fs::write(&path, r#"{"theme":"dark","mcpServers":{"other":{"command":"x"}}}"#).unwrap();
        set_server(&path, true, "/Applications/Quire.app/Contents/MacOS/quire").unwrap();
        let c = read_json(&path).unwrap();
        assert_eq!(c["theme"], "dark");
        assert_eq!(c["mcpServers"]["other"]["command"], "x");
        assert!(is_connected(&c, "/Applications/Quire.app/Contents/MacOS/quire"));
        set_server(&path, false, "").unwrap();
        let c = read_json(&path).unwrap();
        assert!(c["mcpServers"].get("quire").is_none());
        assert_eq!(c["mcpServers"]["other"]["command"], "x");

        std::fs::write(&path, "not json").unwrap();
        assert!(set_server(&path, true, "q").is_err(), "a broken config is never overwritten");
    }

    #[test]
    fn file_names_are_safe() {
        assert_eq!(safe_file_name("Q3 sales"), "Q3 sales.html");
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd.html");
        assert_eq!(safe_file_name("a/b:c.html"), "b-c.html");
        assert_eq!(safe_file_name(""), "Untitled.html");
    }
}
