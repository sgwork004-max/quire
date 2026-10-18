//! Downloads import: HTML that AI chats (ChatGPT, claude.ai, Gemini…) save to
//! ~/Downloads is copied into ~/Quire/Inbox automatically. A re-download of
//! the same file (`report (1).html`) updates `report.html` in Quire instead of
//! adding a copy, with the old content kept in version history. The Downloads
//! folder itself is never changed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{now_ms, set_setting, setting, Db};
use crate::documents::is_html;
use crate::{commands, library, scan};

const ENABLED: &str = "inbox.enabled";
/// Downloads older than this were there before import was switched on.
const SINCE: &str = "inbox.since_ms";
const MAX_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Default)]
pub struct Inbox {
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Download path -> (size, modified) last imported, to ignore repeat events.
    seen: Mutex<HashMap<PathBuf, (u64, i64)>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub path: String,
    pub name: String,
    /// True if an existing Inbox file was updated rather than created.
    pub updated: bool,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

pub fn downloads_dir() -> Option<PathBuf> {
    home().map(|h| h.join("Downloads"))
}

pub fn inbox_dir() -> Option<PathBuf> {
    home().map(|h| h.join("Quire").join("Inbox"))
}

/// `report (1).html`, `report(2).htm` -> `report.html`. Browsers add these
/// suffixes when the same file is downloaded again.
pub fn canonical_name(file_name: &str) -> String {
    let (stem, ext) = file_name.rsplit_once('.').unwrap_or((file_name, "html"));
    let trimmed = stem.trim_end();
    let stem = match trimmed.strip_suffix(')').and_then(|s| s.rsplit_once('(')) {
        Some((base, n)) if !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()) && !base.trim().is_empty() => base.trim_end(),
        _ => trimmed,
    };
    format!("{stem}.{}", if ext.eq_ignore_ascii_case("htm") { "html" } else { ext })
}

fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Copies one download into the Inbox (or updates its earlier copy).
fn import(app: &AppHandle, download: &Path) -> Option<Imported> {
    let name = download.file_name()?.to_string_lossy().into_owned();
    if name.starts_with('.') || !is_html(download) {
        return None;
    }
    let meta = std::fs::metadata(download).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_BYTES {
        return None;
    }
    let key = (meta.len(), modified_ms(&meta));
    let inbox = app.state::<Inbox>();
    if inbox.seen.lock().unwrap().get(download) == Some(&key) {
        return None;
    }
    let html = String::from_utf8_lossy(&std::fs::read(download).ok()?).into_owned();
    inbox.seen.lock().unwrap().insert(download.to_path_buf(), key);

    let dir = inbox_dir()?;
    std::fs::create_dir_all(&dir).ok()?;
    let target_name = canonical_name(&name);
    let target = dir.join(&target_name);
    let existed = target.exists();
    if existed && std::fs::read_to_string(&target).ok().as_deref() == Some(html.as_str()) {
        return None; // identical re-download
    }
    let db = app.state::<Db>();
    if existed {
        // Keep what was there in history before replacing it.
        if let Ok(old) = std::fs::read_to_string(&target) {
            let _ = crate::versions::record(&db.conn(), &target.to_string_lossy(), &old, "disk");
            let _ = crate::versions::close_session(&db.conn(), &target.to_string_lossy());
        }
    }
    commands::write_file(&db, &target, &html, "import").ok()?;
    Some(Imported { path: target.to_string_lossy().into_owned(), name: target_name, updated: existed })
}

/// Makes sure ~/Quire is a watched library folder so imports show up.
fn ensure_library_folder(app: &AppHandle) {
    let Some(quire) = home().map(|h| h.join("Quire")) else { return };
    let _ = std::fs::create_dir_all(quire.join("Inbox"));
    let Ok(quire) = crate::documents::dunce_canonicalize(&quire) else { return };
    let db = app.state::<Db>();
    let known = library::locations(&db.conn()).map(|l| l.iter().any(|(_, p)| *p == quire)).unwrap_or(false);
    if !known {
        if let Ok(id) = library::add_location(&db.conn(), &quire) {
            scan::start_location(app, id, quire);
        }
    }
}

fn handle(app: &AppHandle, paths: Vec<PathBuf>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Browsers write in bursts; let the file settle first.
        tokio::time::sleep(Duration::from_millis(800)).await;
        for p in paths {
            if let Some(imported) = import(&app, &p) {
                let _ = app.emit("inbox-imported", imported);
            }
        }
    });
}

fn start_watching(app: &AppHandle) -> Result<(), String> {
    let downloads = downloads_dir().ok_or("No Downloads folder")?;
    ensure_library_folder(app);
    let handle_app = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
            let paths: Vec<PathBuf> = event.paths.into_iter().filter(|p| is_html(p)).collect();
            if !paths.is_empty() {
                handle(&handle_app, paths);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&downloads, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    *app.state::<Inbox>().watcher.lock().unwrap() = Some(watcher);

    // Pick up anything downloaded while Quire was closed.
    let since: i64 = setting(&app.state::<Db>().conn(), SINCE).and_then(|v| v.parse().ok()).unwrap_or_else(now_ms);
    let missed: Vec<PathBuf> = std::fs::read_dir(&downloads)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| is_html(p) && std::fs::metadata(p).map(|m| modified_ms(&m) > since).unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();
    if !missed.is_empty() {
        handle(app, missed);
    }
    Ok(())
}

/// Called at startup. Import is on unless the user switched it off.
pub fn start(app: &AppHandle) {
    let db = app.state::<Db>();
    let enabled = setting(&db.conn(), ENABLED).map(|v| v == "1").unwrap_or(true);
    if setting(&db.conn(), SINCE).is_none() {
        let _ = set_setting(&db.conn(), SINCE, &now_ms().to_string());
    }
    if enabled {
        if let Err(e) = start_watching(app) {
            eprintln!("downloads import: {e}");
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxStatus {
    enabled: bool,
    downloads: String,
    inbox: String,
    /// HTML files in Downloads from before import was switched on.
    past_count: usize,
}

#[tauri::command]
pub fn inbox_status(db: State<'_, Db>) -> Result<InboxStatus, String> {
    let downloads = downloads_dir().ok_or("No Downloads folder")?;
    let since: i64 = setting(&db.conn(), SINCE).and_then(|v| v.parse().ok()).unwrap_or_else(now_ms);
    let past_count = std::fs::read_dir(&downloads)
        .map(|e| e.flatten().filter(|e| is_html(&e.path()) && e.metadata().map(|m| modified_ms(&m) <= since).unwrap_or(false)).count())
        .unwrap_or(0);
    Ok(InboxStatus {
        enabled: setting(&db.conn(), ENABLED).map(|v| v == "1").unwrap_or(true),
        downloads: downloads.to_string_lossy().into_owned(),
        inbox: inbox_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        past_count,
    })
}

#[tauri::command]
pub fn set_inbox_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let db = app.state::<Db>();
    set_setting(&db.conn(), ENABLED, if enabled { "1" } else { "0" })?;
    if enabled {
        set_setting(&db.conn(), SINCE, &now_ms().to_string())?;
        start_watching(&app)
    } else {
        *app.state::<Inbox>().watcher.lock().unwrap() = None;
        Ok(())
    }
}

/// One-time import of HTML files already in Downloads. Returns how many.
#[tauri::command]
pub async fn import_past_downloads(app: AppHandle) -> Result<usize, String> {
    let downloads = downloads_dir().ok_or("No Downloads folder")?;
    ensure_library_folder(&app);
    // Oldest first, so the newest download of each name ends up current.
    let mut files: Vec<(i64, PathBuf)> = std::fs::read_dir(&downloads)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| is_html(&e.path()))
        .filter_map(|e| e.metadata().ok().map(|m| (modified_ms(&m), e.path())))
        .collect();
    files.sort();
    let mut count = 0;
    for (_, p) in files {
        if import(&app, &p).is_some() {
            count += 1;
        }
    }
    let _ = app.emit("library-changed", ());
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::canonical_name;

    #[test]
    fn re_downloads_map_to_the_original_name() {
        assert_eq!(canonical_name("report.html"), "report.html");
        assert_eq!(canonical_name("report (1).html"), "report.html");
        assert_eq!(canonical_name("report(12).htm"), "report.html");
        assert_eq!(canonical_name("DAS Project Tree (1).html"), "DAS Project Tree.html");
        // Numbers that are part of the name stay.
        assert_eq!(canonical_name("q3-2024.html"), "q3-2024.html");
        assert_eq!(canonical_name("DAS_Project_Tree_1.html"), "DAS_Project_Tree_1.html");
        assert_eq!(canonical_name("(1).html"), "(1).html");
        assert_eq!(canonical_name("plan (draft).html"), "plan (draft).html");
    }
}
