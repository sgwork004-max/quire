//! Importing HTML into Quire.
//!
//! Nothing is read or watched until the user chooses it: in onboarding or the
//! Import window they pick folders (Downloads, Desktop, anything) and files
//! with the system file picker, which macOS treats as consent, so there are no
//! extra permission prompts. Chosen folders can also be watched ("sources"):
//! new HTML saved there afterwards is copied into ~/Quire/Inbox and filed into
//! the source's Quire folder and tags. A re-download of the same file
//! (`report (1).html`) updates `report.html` instead of adding a copy, with
//! the old content kept in version history. Source files are never changed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::event::ModifyKind;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{now_ms, set_setting, setting, Db};
use crate::documents::is_html;
use crate::{commands, library, scan};

/// Watched sources, as JSON (see `Source`).
const SOURCES: &str = "inbox.sources";
const MAX_BYTES: u64 = 20 * 1024 * 1024;

/// A folder watched for new HTML, and where its imports are filed.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub path: String,
    /// Quire folder new files go into.
    #[serde(default)]
    pub folder_id: Option<i64>,
    /// Tags new files get.
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    /// Only files saved after this are imported automatically.
    #[serde(default)]
    pub since_ms: i64,
}

pub fn sources(db: &Db) -> Vec<Source> {
    setting(&db.conn(), SOURCES).and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}

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

/// Puts an imported file into a Quire folder and tags.
fn file_into(db: &Db, path: &str, folder: Option<i64>, tags: &[i64]) -> Option<i64> {
    let conn = db.conn();
    let id: i64 = conn.query_row("SELECT id FROM files WHERE path = ?1", [path], |r| r.get(0)).ok()?;
    if folder.is_some() {
        let _ = library::set_folder(&conn, id, folder);
    }
    for t in tags {
        let _ = library::set_file_tag(&conn, id, *t, true);
    }
    Some(id)
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
        let sources = sources(&app.state::<Db>());
        for p in paths {
            let Some(src) = sources.iter().find(|s| p.parent() == Some(Path::new(&s.path))) else { continue };
            // Only files saved after the source was added; old files whose
            // details merely changed (Spotlight, Finder tags…) are not new.
            let fresh = std::fs::metadata(&p).map(|m| modified_ms(&m) > src.since_ms).unwrap_or(false);
            if !fresh {
                continue;
            }
            if let Some(imported) = import(&app, &p) {
                file_into(&app.state::<Db>(), &imported.path, src.folder_id, &src.tag_ids);
                let _ = app.emit("inbox-imported", imported);
            }
        }
    });
}

fn start_watching(app: &AppHandle) -> Result<(), String> {
    let sources = sources(&app.state::<Db>());
    if sources.is_empty() {
        *app.state::<Inbox>().watcher.lock().unwrap() = None;
        return Ok(());
    }
    ensure_library_folder(app);
    let handle_app = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let new_content = matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(ModifyKind::Data(_)) | EventKind::Modify(ModifyKind::Name(_)) | EventKind::Modify(ModifyKind::Any)
        );
        if new_content {
            let paths: Vec<PathBuf> = event.paths.into_iter().filter(|p| is_html(p)).collect();
            if !paths.is_empty() {
                handle(&handle_app, paths);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    for s in &sources {
        if let Err(e) = watcher.watch(Path::new(&s.path), RecursiveMode::NonRecursive) {
            eprintln!("import: can't watch {}: {e}", s.path);
        }
    }
    *app.state::<Inbox>().watcher.lock().unwrap() = Some(watcher);

    // Pick up anything saved to a source while Quire was closed.
    let missed: Vec<PathBuf> = sources
        .iter()
        .flat_map(|s| std::fs::read_dir(&s.path).into_iter().flatten().flatten())
        .map(|e| e.path())
        .filter(|p| is_html(p))
        .collect();
    if !missed.is_empty() {
        handle(app, missed);
    }
    Ok(())
}

/// Called at startup. Watches only the sources the user chose; with none,
/// Quire never touches Downloads, Desktop or anything else.
pub fn start(app: &AppHandle) {
    if sources(&app.state::<Db>()).is_empty() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = start_watching(&app) {
            eprintln!("import: {e}");
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxStatus {
    sources: Vec<Source>,
    downloads: String,
    desktop: String,
    documents: String,
    inbox: String,
}

/// Paths only: this never reads any folder, so it can't trigger a permission prompt.
#[tauri::command]
pub fn inbox_status(db: State<'_, Db>) -> Result<InboxStatus, String> {
    let at = |p: Option<PathBuf>| p.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(InboxStatus {
        sources: sources(&db),
        downloads: at(downloads_dir()),
        desktop: at(desktop_dir()),
        documents: at(home().map(|h| h.join("Documents"))),
        inbox: at(inbox_dir()),
    })
}

/// Replaces the watched sources. New sources only import files saved from now on.
#[tauri::command]
pub fn set_import_sources(app: AppHandle, sources: Vec<Source>) -> Result<(), String> {
    let previous = self::sources(&app.state::<Db>());
    let now = now_ms();
    let sources: Vec<Source> = sources
        .into_iter()
        .map(|mut s| {
            s.since_ms = previous.iter().find(|p| p.path == s.path).map(|p| p.since_ms).unwrap_or(now);
            s
        })
        .collect();
    set_setting(&app.state::<Db>().conn(), SOURCES, &serde_json::to_string(&sources).map_err(|e| e.to_string())?)?;
    start_watching(&app)
}

/// Folders skipped when looking for HTML: code dependencies, caches, and
/// places macOS guards with their own permission prompts (other apps' data,
/// photo and music libraries, iCloud).
const SKIP_DIRS: &[&str] = &[
    "node_modules", "Library", "Applications", "target", "dist", "build", "vendor", "__pycache__",
    "Pictures", "Music", "Movies", "Mobile Documents", "Containers", "Group Containers",
];
/// Package-like folders (apps, photo libraries…) are never scanned inside.
fn is_package(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, ext)| {
        matches!(ext, "app" | "photoslibrary" | "musiclibrary" | "tvlibrary" | "bundle" | "framework" | "plugin" | "kext" | "pkg" | "xcodeproj" | "xcworkspace" | "lproj" | "noindex")
    })
}
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
        // file_type() doesn't follow symlinks, so links to other places (and volumes) are skipped.
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            if depth > 0 && !SKIP_DIRS.contains(&name.as_str()) && !is_package(&name) {
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
pub async fn import_paths(
    app: AppHandle,
    paths: Vec<String>,
    dest: Option<String>,
    folder_id: Option<i64>,
    tag_ids: Option<Vec<i64>>,
) -> Result<ImportSummary, String> {
    let tag_ids = tag_ids.unwrap_or_default();
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
            if let Some(id) = file_into(&app.state::<Db>(), &target.to_string_lossy(), folder_id, &tag_ids) {
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
