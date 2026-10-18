//! Importing HTML into Quire. HTML that AI chats (ChatGPT, claude.ai,
//! Gemini…) save to ~/Downloads, and HTML saved to ~/Desktop, is copied into
//! ~/Quire/Inbox automatically. A re-download of the same file
//! (`report (1).html`) updates `report.html` in Quire instead of adding a
//! copy, with the old content kept in version history. Manual imports pick
//! their sources (folders or files) and destination each time. Source files
//! are never changed.

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
    crate::home_dir()
}

pub fn downloads_dir() -> Option<PathBuf> {
    home().map(|h| h.join("Downloads"))
}

pub fn desktop_dir() -> Option<PathBuf> {
    home().map(|h| h.join("Desktop"))
}

/// Folders watched for new HTML while automatic import is on.
fn watched_dirs() -> Vec<PathBuf> {
    [downloads_dir(), desktop_dir()].into_iter().flatten().filter(|d| d.is_dir()).collect()
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
    import_into(app, download, &inbox_dir()?)
}

/// Copies one HTML file into `dir` (or updates the copy already there).
fn import_into(app: &AppHandle, download: &Path, dir: &Path) -> Option<Imported> {
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

    std::fs::create_dir_all(dir).ok()?;
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
    let dirs = watched_dirs();
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
    for dir in &dirs {
        if let Err(e) = watcher.watch(dir, RecursiveMode::NonRecursive) {
            eprintln!("import: can't watch {}: {e}", dir.display());
        }
    }
    *app.state::<Inbox>().watcher.lock().unwrap() = Some(watcher);

    // Pick up anything saved while Quire was closed.
    let since: i64 = setting(&app.state::<Db>().conn(), SINCE).and_then(|v| v.parse().ok()).unwrap_or_else(now_ms);
    let missed: Vec<PathBuf> = dirs
        .iter()
        .flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten())
        .map(|e| e.path())
        .filter(|p| is_html(p) && std::fs::metadata(p).map(|m| modified_ms(&m) > since).unwrap_or(false))
        .collect();
    if !missed.is_empty() {
        handle(app, missed);
    }
    Ok(())
}

/// Called at startup. Import is on unless the user switched it off.
///
/// Runs off the main thread: the first read of ~/Downloads makes macOS ask
/// the user for permission, and that must never hold up the window opening.
pub fn start(app: &AppHandle) {
    let db = app.state::<Db>();
    let enabled = setting(&db.conn(), ENABLED).map(|v| v == "1").unwrap_or(true);
    if setting(&db.conn(), SINCE).is_none() {
        let _ = set_setting(&db.conn(), SINCE, &now_ms().to_string());
    }
    if enabled {
        let app = app.clone();
        std::thread::spawn(move || {
            // Let the window appear before macOS shows its permission prompt.
            std::thread::sleep(Duration::from_secs(2));
            if let Err(e) = start_watching(&app) {
                eprintln!("downloads import: {e}");
            }
        });
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxStatus {
    enabled: bool,
    downloads: String,
    desktop: String,
    documents: String,
    inbox: String,
    /// HTML files in Downloads from before import was switched on.
    past_count: usize,
}

#[tauri::command]
pub fn inbox_status(db: State<'_, Db>) -> Result<InboxStatus, String> {
    let downloads = downloads_dir().ok_or("No Downloads folder")?;
    let since: i64 = setting(&db.conn(), SINCE).and_then(|v| v.parse().ok()).unwrap_or_else(now_ms);
    let past_count = watched_dirs()
        .iter()
        .flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten())
        .filter(|e| is_html(&e.path()) && e.metadata().map(|m| modified_ms(&m) <= since).unwrap_or(false))
        .count();
    Ok(InboxStatus {
        enabled: setting(&db.conn(), ENABLED).map(|v| v == "1").unwrap_or(true),
        downloads: downloads.to_string_lossy().into_owned(),
        desktop: desktop_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        documents: home().map(|h| h.join("Documents").to_string_lossy().into_owned()).unwrap_or_default(),
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

/// Folders skipped when looking for HTML: app bundles, code dependencies and caches.
const SKIP_DIRS: &[&str] = &["node_modules", "Library", "Applications", "target", "dist", "build", "vendor", "__pycache__"];
const SCAN_DEPTH: usize = 4;
const SCAN_LIMIT: usize = 5000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    path: String,
    name: String,
    size_bytes: u64,
    modified_ms: i64,
}

fn scan_dir(dir: &Path, depth: usize, out: &mut Vec<Candidate>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        if out.len() >= SCAN_LIMIT {
            return;
        }
        let path = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            if depth > 0 && !SKIP_DIRS.contains(&name.as_str()) && !name.ends_with(".app") {
                scan_dir(&path, depth - 1, out);
            }
        } else if ft.is_file() && is_html(&path) {
            if let Ok(m) = e.metadata() {
                if m.len() > 0 && m.len() <= MAX_BYTES {
                    out.push(Candidate { path: path.to_string_lossy().into_owned(), name, size_bytes: m.len(), modified_ms: modified_ms(&m) });
                }
            }
        }
    }
}

/// Finds the HTML files an import would bring in: everything inside `folders`
/// (a few levels deep) plus the individually chosen `files`.
#[tauri::command(async)]
pub fn import_scan(folders: Vec<String>, files: Vec<String>) -> Result<Vec<Candidate>, String> {
    let mut out = Vec::new();
    for f in &folders {
        scan_dir(Path::new(f), SCAN_DEPTH, &mut out);
    }
    for f in &files {
        let p = Path::new(f);
        if let (true, Ok(m)) = (is_html(p), std::fs::metadata(p)) {
            if m.is_file() && m.len() <= MAX_BYTES {
                let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                out.push(Candidate { path: f.clone(), name, size_bytes: m.len(), modified_ms: modified_ms(&m) });
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out.dedup_by(|a, b| a.path == b.path);
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    added: usize,
    updated: usize,
    unchanged: usize,
    /// Library ids of the imported copies (new, updated or already there).
    ids: Vec<i64>,
}

/// Copies the given HTML files into `dest` (a library folder; ~/Quire/Inbox
/// when empty). Files already there with the same content are left alone.
#[tauri::command]
pub async fn import_paths(app: AppHandle, paths: Vec<String>, dest: Option<String>) -> Result<ImportSummary, String> {
    ensure_library_folder(&app);
    let dest = match dest.filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => inbox_dir().ok_or("No home folder")?,
    };
    // Oldest first, so the newest file of each name ends up current.
    let mut files: Vec<(i64, PathBuf)> = paths
        .iter()
        .map(PathBuf::from)
        .filter_map(|p| std::fs::metadata(&p).ok().map(|m| (modified_ms(&m), p)))
        .collect();
    files.sort();
    let mut summary = ImportSummary { added: 0, updated: 0, unchanged: 0, ids: Vec::new() };
    for (_, p) in files {
        // A manual import always reconsiders the file, even if auto-import saw it.
        app.state::<Inbox>().seen.lock().unwrap().remove(&p);
        match import_into(&app, &p, &dest) {
            Some(i) if i.updated => summary.updated += 1,
            Some(_) => summary.added += 1,
            None => summary.unchanged += 1,
        }
        if let Some(name) = p.file_name() {
            let target = dest.join(canonical_name(&name.to_string_lossy()));
            let conn = app.state::<Db>();
            let id = conn.conn().query_row("SELECT id FROM files WHERE path = ?1", [target.to_string_lossy()], |r| r.get::<_, i64>(0));
            if let Ok(id) = id {
                if !summary.ids.contains(&id) {
                    summary.ids.push(id);
                }
            }
        }
    }
    let _ = app.emit("library-changed", ());
    Ok(summary)
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
