//! Sharing with Quire Cloud.
//!
//! Nothing leaves this computer unless the user shares a file. Sharing links a
//! local file to a cloud document (`cloud_links`): the owner's original file,
//! or for recipients a cached copy in Quire's own folder. A background loop
//! keeps each link in sync:
//!
//! - content: local edits are pushed as a three-way merge against `synced`
//!   (the last text both sides agreed on), remote changes are pulled when the
//!   file has no unpushed edits. Files open in a live session skip this; the
//!   real-time connection carries their content.
//! - assets: the files the page uses are uploaded once by content hash, and
//!   downloaded into recipients' copies.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::assets;
use crate::auth::{api_base, AuthState};
use crate::commands::write_file;
use crate::db::{err, Db};

const SYNC_INTERVAL: Duration = Duration::from_secs(60);
const SYNC_INTERVAL_IDLE: Duration = Duration::from_secs(300);

type R<T> = Result<T, String>;

/// Documents whose content currently flows through a live connection.
#[derive(Default)]
pub struct Cloud {
    live: Mutex<HashSet<String>>,
    running: tokio::sync::Mutex<()>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CloudDocument {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub revision: i64,
    pub updated_at: i64,
    pub owner_id: String,
    pub owner_name: String,
    pub owner_email: String,
    pub role: String,
    pub member_count: i64,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub used_bytes: i64,
    pub quota_bytes: i64,
}

#[derive(Deserialize)]
struct DocumentList {
    documents: Vec<CloudDocument>,
    usage: Usage,
    /// Unread notifications (servers before 0.3 don't send it).
    #[serde(default)]
    unread: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub document_id: String,
    pub path: String,
    pub role: String,
    pub title: String,
    pub owner_name: Option<String>,
    #[serde(skip)]
    pub account_id: String,
    #[serde(skip)]
    pub revision: i64,
    #[serde(skip)]
    pub synced: String,
    #[serde(skip)]
    pub assets_sig: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    documents: Vec<CloudDocument>,
    usage: Usage,
    links: Vec<Link>,
}

#[derive(Serialize, Deserialize, Clone)]
struct AssetEntry {
    path: String,
    hash: String,
    size: u64,
}

fn can_edit(role: &str) -> bool {
    role == "owner" || role == "editor"
}

// ---------------------------------------------------------------- API client

async fn call(auth: &AuthState, method: reqwest::Method, path: &str, body: Option<Value>) -> R<Value> {
    let token = auth.token().ok_or("Sign in to share files")?;
    let mut req = auth.http.request(method, format!("{}{}", api_base(), path)).bearer_auth(token);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req.send().await.map_err(|e| {
        if e.is_connect() || e.is_timeout() { "Can't reach Quire Cloud. Check your connection.".to_string() } else { e.to_string() }
    })?;
    let status = res.status();
    let value: Value = res.json().await.unwrap_or(Value::Null);
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Your session expired. Sign in again.".into());
    }
    if !status.is_success() {
        return Err(value["error"].as_str().unwrap_or("Quire Cloud returned an error").to_string());
    }
    Ok(value)
}

async fn get_bytes(auth: &AuthState, path: &str) -> R<Vec<u8>> {
    let token = auth.token().ok_or("Signed out")?;
    let res = auth
        .http
        .get(format!("{}{}", api_base(), path))
        .bearer_auth(token)
        .send()
        .await
        .map_err(err)?;
    if !res.status().is_success() {
        return Err(format!("Download failed ({})", res.status()));
    }
    Ok(res.bytes().await.map_err(err)?.to_vec())
}

async fn put_bytes(auth: &AuthState, path: &str, bytes: Vec<u8>) -> R<()> {
    let token = auth.token().ok_or("Signed out")?;
    let res = auth
        .http
        .put(format!("{}{}", api_base(), path))
        .bearer_auth(token)
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
        .send()
        .await
        .map_err(err)?;
    if !res.status().is_success() {
        let v: Value = res.json().await.unwrap_or(Value::Null);
        return Err(v["error"].as_str().unwrap_or("Upload failed").to_string());
    }
    Ok(())
}

fn enc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

// ---------------------------------------------------------------- links

fn link_from_row(r: &rusqlite::Row) -> rusqlite::Result<Link> {
    Ok(Link {
        document_id: r.get(0)?,
        path: r.get(1)?,
        account_id: r.get(2)?,
        role: r.get(3)?,
        title: r.get(4)?,
        owner_name: r.get(5)?,
        revision: r.get(6)?,
        synced: r.get(7)?,
        assets_sig: r.get(8)?,
    })
}

const LINK_COLUMNS: &str = "document_id, path, account_id, role, title, owner_name, revision, synced, assets_sig";

fn links_for(db: &Db, account_id: &str) -> R<Vec<Link>> {
    let conn = db.conn();
    let mut stmt = conn
        .prepare(&format!("SELECT {LINK_COLUMNS} FROM cloud_links WHERE account_id = ?1"))
        .map_err(err)?;
    let rows = stmt.query_map([account_id], link_from_row).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

fn link(db: &Db, document_id: &str) -> R<Option<Link>> {
    db.conn()
        .query_row(&format!("SELECT {LINK_COLUMNS} FROM cloud_links WHERE document_id = ?1"), [document_id], link_from_row)
        .optional()
        .map_err(err)
}

/// The link for a file, only if it belongs to `account`. Links made by another
/// account (or against another server) are stale for this one.
fn link_by_path(db: &Db, path: &str, account: &str) -> R<Option<Link>> {
    let link = db
        .conn()
        .query_row(&format!("SELECT {LINK_COLUMNS} FROM cloud_links WHERE path = ?1"), [path], link_from_row)
        .optional()
        .map_err(err)?;
    Ok(link.filter(|l| l.account_id == account))
}

fn save_link(db: &Db, l: &Link) -> R<()> {
    db.conn()
        .execute(
            "INSERT INTO cloud_links (document_id, path, account_id, role, title, owner_name, revision, synced, assets_sig)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(document_id) DO UPDATE SET path = excluded.path, account_id = excluded.account_id,
               role = excluded.role, title = excluded.title, owner_name = excluded.owner_name,
               revision = excluded.revision, synced = excluded.synced, assets_sig = excluded.assets_sig",
            params![l.document_id, l.path, l.account_id, l.role, l.title, l.owner_name, l.revision, l.synced, l.assets_sig],
        )
        .map(|_| ())
        .map_err(err)
}

fn drop_link(db: &Db, l: &Link) -> R<()> {
    db.conn().execute("DELETE FROM cloud_links WHERE document_id = ?1", [&l.document_id]).map_err(err)?;
    // A recipient's copy is ours to remove; an owner's original never is.
    if l.role != "owner" {
        let dir = db.shared_dir.join(&l.document_id);
        if dir.starts_with(&db.shared_dir) {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    Ok(())
}

/// Removes every recipient copy (on sign-out, so nobody else on this Mac sees them).
pub fn clear_shared_copies(db: &Db) {
    let _ = db.conn().execute("DELETE FROM cloud_links WHERE role != 'owner'", []);
    if let Ok(entries) = std::fs::read_dir(&db.shared_dir) {
        for e in entries.flatten() {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

fn account_id(auth: &AuthState) -> R<String> {
    auth.current.lock().unwrap().as_ref().map(|a| a.id.clone()).ok_or_else(|| "Sign in to share files".into())
}

async fn ensure_account(auth: &AuthState) -> R<String> {
    if let Ok(id) = account_id(auth) {
        return Ok(id);
    }
    let me = call(auth, reqwest::Method::GET, "/api/me", None).await?;
    let account: crate::auth::Account = serde_json::from_value(me).map_err(err)?;
    let id = account.id.clone();
    *auth.current.lock().unwrap() = Some(account);
    Ok(id)
}

// ---------------------------------------------------------------- assets

fn signature(list: &[AssetEntry]) -> String {
    let mut parts: Vec<String> = list.iter().map(|a| format!("{}:{}", a.path, a.hash)).collect();
    parts.sort();
    assets::sha256_hex(parts.join("\n").as_bytes())
}

/// Uploads the files the page uses (only those not already in the cloud).
async fn push_assets(auth: &AuthState, db: &Db, l: &mut Link, html: &str) -> R<()> {
    let page = PathBuf::from(&l.path);
    let root = page.parent().ok_or("no folder")?;
    let found = assets::collect(root, html, &page);
    let list: Vec<AssetEntry> = found.iter().map(|a| AssetEntry { path: a.path.clone(), hash: a.hash.clone(), size: a.size }).collect();
    let sig = signature(&list);
    if sig == l.assets_sig {
        return Ok(());
    }
    let hashes: Vec<&str> = list.iter().map(|a| a.hash.as_str()).collect();
    let missing = call(auth, reqwest::Method::POST, &format!("/api/documents/{}/blobs/missing", l.document_id), Some(json!({ "hashes": hashes }))).await?;
    let missing: HashSet<String> = missing["missing"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect();
    for a in found.iter().filter(|a| missing.contains(&a.hash)) {
        let bytes = std::fs::read(&a.abs).map_err(err)?;
        put_bytes(auth, &format!("/api/documents/{}/blobs/{}", l.document_id, a.hash), bytes).await?;
    }
    call(auth, reqwest::Method::PUT, &format!("/api/documents/{}/assets", l.document_id), Some(json!({ "assets": list }))).await?;
    l.assets_sig = sig;
    save_link(db, l)
}

/// A relative asset path from the cloud, made safe to write under `root`.
fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut p = root.to_path_buf();
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(s) if !s.to_string_lossy().starts_with('.') => p.push(s),
            _ => return None,
        }
    }
    Some(p)
}

/// Downloads assets that are missing or different locally.
async fn pull_assets(auth: &AuthState, db: &Db, l: &mut Link) -> R<bool> {
    let res = call(auth, reqwest::Method::GET, &format!("/api/documents/{}/assets", l.document_id), None).await?;
    let list: Vec<AssetEntry> = serde_json::from_value(res["assets"].clone()).map_err(err)?;
    let sig = signature(&list);
    if sig == l.assets_sig {
        return Ok(false);
    }
    let root = PathBuf::from(&l.path).parent().ok_or("no folder")?.to_path_buf();
    let mut changed = false;
    for a in &list {
        let Some(target) = safe_join(&root, &a.path) else { continue };
        let current = std::fs::read(&target).ok().map(|b| assets::sha256_hex(&b));
        if current.as_deref() == Some(a.hash.as_str()) {
            continue;
        }
        let bytes = get_bytes(auth, &format!("/api/documents/{}/blobs/{}", l.document_id, a.hash)).await?;
        if assets::sha256_hex(&bytes) != a.hash {
            return Err("A downloaded file was corrupted".into());
        }
        if let Some(dir) = target.parent() {
            std::fs::create_dir_all(dir).map_err(err)?;
        }
        std::fs::write(&target, bytes).map_err(err)?;
        changed = true;
    }
    l.assets_sig = sig;
    save_link(db, l)?;
    Ok(changed)
}

// ---------------------------------------------------------------- sync

/// Brings one linked file and its cloud document in line.
async fn sync_link(app: &AppHandle, mut l: Link, remote: Option<&CloudDocument>) -> R<()> {
    let auth = app.state::<AuthState>();
    let db = app.state::<Db>();
    let Some(remote) = remote else {
        // Unshared, deleted, or our access was removed.
        drop_link(&db, &l)?;
        let _ = app.emit("cloud-changed", ());
        return Ok(());
    };
    l.role = remote.role.clone();
    l.title = remote.title.clone();
    l.owner_name = Some(remote.owner_name.clone());

    let path = PathBuf::from(&l.path);
    let Ok(local) = std::fs::read(&path).map(|b| String::from_utf8_lossy(&b).into_owned()) else {
        save_link(&db, &l)?;
        return Ok(()); // the owner moved or deleted the file; nothing to sync from
    };
    let live = app.state::<Cloud>().live.lock().unwrap().contains(&l.document_id);
    let mut changed = false;

    if !live && can_edit(&l.role) && local != l.synced {
        // If the cloud already has exactly this text (e.g. a live session ended
        // abruptly), just record it; re-applying the change would duplicate it.
        let current = call(&auth, reqwest::Method::GET, &format!("/api/documents/{}/content", l.document_id), None).await?;
        if current["html"].as_str() == Some(local.as_str()) {
            l.synced = local.clone();
        }
    }
    if !live && can_edit(&l.role) && local != l.synced {
        let res = call(
            &auth,
            reqwest::Method::PUT,
            &format!("/api/documents/{}/content", l.document_id),
            Some(json!({ "base": l.synced, "html": local })),
        )
        .await?;
        let merged = res["html"].as_str().unwrap_or(&local).to_string();
        if merged != local {
            write_file(&db, &path, &merged, "remote")?;
            changed = true;
        }
        l.synced = merged;
        save_link(&db, &l)?;
    }
    if can_edit(&l.role) {
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        push_assets(&auth, &db, &mut l, &text).await?;
    }
    if remote.revision > l.revision {
        if !live {
            let res = call(&auth, reqwest::Method::GET, &format!("/api/documents/{}/content", l.document_id), None).await?;
            let html = res["html"].as_str().unwrap_or_default().to_string();
            let current = std::fs::read_to_string(&path).unwrap_or_default();
            // Only overwrite when there are no unpushed local edits.
            if current == l.synced && html != current {
                write_file(&db, &path, &html, "remote")?;
                l.synced = html;
                changed = true;
            }
        }
        changed |= pull_assets(&auth, &db, &mut l).await?;
        l.revision = remote.revision;
    }
    save_link(&db, &l)?;
    if changed {
        let _ = app.emit("cloud-changed", ());
    }
    Ok(())
}

async fn fetch_list(auth: &AuthState) -> R<DocumentList> {
    let v = call(auth, reqwest::Method::GET, "/api/documents", None).await?;
    serde_json::from_value(v).map_err(err)
}

/// One pass over every linked file of the signed-in account.
pub async fn sync_all(app: &AppHandle) -> R<()> {
    let cloud = app.state::<Cloud>();
    let _guard = cloud.running.lock().await;
    let auth = app.state::<AuthState>();
    if auth.token().is_none() {
        return Ok(());
    }
    let account = ensure_account(&auth).await?;
    let list = fetch_list(&auth).await?;
    let remote: HashMap<&str, &CloudDocument> = list.documents.iter().map(|d| (d.id.as_str(), d)).collect();
    for l in links_for(&app.state::<Db>(), &account)? {
        let id = l.document_id.clone();
        if let Err(e) = sync_link(app, l, remote.get(id.as_str()).copied()).await {
            eprintln!("sync {id}: {e}");
        }
    }
    // Unread mentions and replies, for the notification bell.
    let unread = match list.unread {
        Some(n) => Some(n),
        None => call(&auth, reqwest::Method::GET, "/api/notifications", None).await.ok().and_then(|n| n["unread"].as_i64()),
    };
    if let Some(n) = unread {
        let _ = app.emit("notifications", n);
    }
    Ok(())
}

/// Starts the background sync loop.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(e) = sync_all(&app).await {
                if !e.contains("Sign in") {
                    eprintln!("sync: {e}");
                }
            }
            // Every request counts against Quire Cloud's free tier, so poll
            // gently: once a minute while Quire is in use, every five minutes
            // in the background. The UI also asks for a sync when the window
            // comes to the front, and open shared files are live anyway.
            let focused = app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
            tokio::time::sleep(if focused { SYNC_INTERVAL } else { SYNC_INTERVAL_IDLE }).await;
        }
    });
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub async fn cloud_overview(auth: State<'_, AuthState>, db: State<'_, Db>) -> R<Overview> {
    let account = ensure_account(&auth).await?;
    let list = fetch_list(&auth).await?;
    Ok(Overview { documents: list.documents, usage: list.usage, links: links_for(&db, &account)? })
}

/// Links this file is part of, if any (used to show roles and sharing state).
#[tauri::command]
pub async fn cloud_link_for_path(auth: State<'_, AuthState>, db: State<'_, Db>, path: String) -> R<Option<Link>> {
    let account = ensure_account(&auth).await?;
    link_by_path(&db, &path, &account)
}

/// Shares a local file: creates the cloud document and uploads what it uses.
#[tauri::command]
pub async fn share_file(app: AppHandle, path: String) -> R<String> {
    let db = app.state::<Db>();
    let auth = app.state::<AuthState>();
    let account = ensure_account(&auth).await?;
    let path = crate::documents::dunce_canonicalize(Path::new(&path))?;
    let path_str = path.to_string_lossy().into_owned();
    if path.starts_with(&db.shared_dir) {
        return Err("This is someone else's file. Only its owner can share it.".into());
    }
    if let Some(l) = link_by_path(&db, &path_str, &account)? {
        return Ok(l.document_id);
    }
    // A link left by another account or server would block this file's row.
    db.conn().execute("DELETE FROM cloud_links WHERE path = ?1", [&path_str]).map_err(err)?;
    let html = std::fs::read_to_string(&path).map_err(err)?;
    let file_name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let title = crate::extract::extract(&html).title.unwrap_or_else(|| file_name.clone());
    let res = call(
        &auth,
        reqwest::Method::POST,
        "/api/documents",
        Some(json!({ "fileName": file_name, "title": title, "html": html })),
    )
    .await?;
    let id = res["id"].as_str().ok_or("Quire Cloud didn't return a document")?.to_string();
    let mut l = Link {
        document_id: id.clone(),
        path: path_str,
        account_id: account,
        role: "owner".into(),
        title,
        owner_name: None,
        revision: 0,
        synced: html.clone(),
        assets_sig: String::new(),
    };
    save_link(&db, &l)?;
    if let Err(e) = push_assets(&auth, &db, &mut l, &html).await {
        // The page is shared; assets will retry on the next sync.
        eprintln!("asset upload for {id}: {e}");
    }
    let _ = app.emit("cloud-changed", ());
    Ok(id)
}

#[tauri::command]
pub async fn share_details(auth: State<'_, AuthState>, document_id: String) -> R<Value> {
    call(&auth, reqwest::Method::GET, &format!("/api/documents/{document_id}"), None).await
}

#[tauri::command]
pub async fn share_invite(auth: State<'_, AuthState>, document_id: String, email: String, role: String) -> R<Value> {
    call(&auth, reqwest::Method::POST, &format!("/api/documents/{document_id}/members"), Some(json!({ "email": email, "role": role }))).await
}

#[tauri::command]
pub async fn share_set_role(auth: State<'_, AuthState>, document_id: String, email: String, role: String) -> R<Value> {
    call(
        &auth,
        reqwest::Method::PATCH,
        &format!("/api/documents/{document_id}/members/{}", enc(&email)),
        Some(json!({ "role": role })),
    )
    .await
}

#[tauri::command]
pub async fn share_remove(auth: State<'_, AuthState>, document_id: String, email: String) -> R<Value> {
    call(&auth, reqwest::Method::DELETE, &format!("/api/documents/{document_id}/members/{}", enc(&email)), None).await
}

/// Owner: delete the cloud copy. The local file stays exactly as it is.
#[tauri::command]
pub async fn stop_sharing(app: AppHandle, document_id: String) -> R<()> {
    call(&app.state::<AuthState>(), reqwest::Method::DELETE, &format!("/api/documents/{document_id}"), None).await?;
    if let Some(l) = link(&app.state::<Db>(), &document_id)? {
        drop_link(&app.state::<Db>(), &l)?;
    }
    let _ = app.emit("cloud-changed", ());
    Ok(())
}

/// Recipient: remove yourself from a file shared with you.
#[tauri::command]
pub async fn leave_shared(app: AppHandle, document_id: String) -> R<()> {
    let auth = app.state::<AuthState>();
    let email = auth.current.lock().unwrap().as_ref().map(|a| a.email.clone()).ok_or("Signed out")?;
    call(&auth, reqwest::Method::DELETE, &format!("/api/documents/{document_id}/members/{}", enc(&email)), None).await?;
    if let Some(l) = link(&app.state::<Db>(), &document_id)? {
        drop_link(&app.state::<Db>(), &l)?;
    }
    let _ = app.emit("cloud-changed", ());
    Ok(())
}

/// Recipient: makes sure the local copy is current and returns its path.
#[tauri::command]
pub async fn open_shared(app: AppHandle, document_id: String) -> R<String> {
    let db = app.state::<Db>();
    let auth = app.state::<AuthState>();
    let account = ensure_account(&auth).await?;
    if let Some(l) = link(&db, &document_id)? {
        if Path::new(&l.path).exists() {
            if let Err(e) = sync_all(&app).await {
                eprintln!("sync before open: {e}");
            }
            return Ok(l.path);
        }
    }
    let details = call(&auth, reqwest::Method::GET, &format!("/api/documents/{document_id}"), None).await?;
    let file_name = details["fileName"].as_str().unwrap_or("shared.html").replace(['/', '\\'], "_");
    let file_name = if crate::documents::is_html(Path::new(&file_name)) && !file_name.starts_with('.') { file_name } else { "shared.html".into() };
    let dir = db.shared_dir.join(&document_id);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(&file_name);
    let content = call(&auth, reqwest::Method::GET, &format!("/api/documents/{document_id}/content"), None).await?;
    let html = content["html"].as_str().unwrap_or_default().to_string();
    std::fs::write(&path, &html).map_err(err)?;
    let mut l = Link {
        document_id: document_id.clone(),
        path: path.to_string_lossy().into_owned(),
        account_id: account,
        role: details["role"].as_str().unwrap_or("viewer").to_string(),
        title: details["title"].as_str().unwrap_or(&file_name).to_string(),
        owner_name: details["owner"]["name"].as_str().map(String::from),
        revision: content["revision"].as_i64().unwrap_or(0),
        synced: html,
        assets_sig: String::new(),
    };
    save_link(&db, &l)?;
    pull_assets(&auth, &db, &mut l).await?;
    Ok(l.path)
}

/// A ticket for the real-time connection, plus the caller's role.
#[tauri::command]
pub async fn live_ticket(auth: State<'_, AuthState>, document_id: String) -> R<Value> {
    call(&auth, reqwest::Method::POST, &format!("/api/documents/{document_id}/ticket"), None).await
}

/// The UI reports when a document's content is flowing through a live
/// connection (so the background loop leaves its content alone), and the
/// text both sides agree on when it stops.
#[tauri::command]
pub fn set_live(cloud: State<'_, Cloud>, db: State<'_, Db>, document_id: String, live: bool, synced: Option<String>) -> R<()> {
    if live {
        cloud.live.lock().unwrap().insert(document_id.clone());
    } else {
        cloud.live.lock().unwrap().remove(&document_id);
    }
    if let (Some(text), Some(mut l)) = (synced, link(&db, &document_id)?) {
        l.synced = text;
        save_link(&db, &l)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_now(app: AppHandle) -> R<()> {
    sync_all(&app).await
}

/// Comments and notifications go through this one call. The UI never sees
/// the session token; only these paths and methods can be reached.
#[tauri::command]
pub async fn cloud_api(auth: State<'_, AuthState>, method: String, path: String, body: Option<Value>) -> R<Value> {
    let allowed_path = path == "/api/notifications"
        || path == "/api/notifications/read"
        || (path.starts_with("/api/documents/") && path.split('/').nth(4) == Some("comments"));
    let method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("Method not allowed".into()),
    };
    if !allowed_path || path.contains("..") || path.contains('?') {
        return Err("Path not allowed".into());
    }
    call(&auth, method, &path, body).await
}
