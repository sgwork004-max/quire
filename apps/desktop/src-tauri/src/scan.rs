//! Scans watched folders for HTML files and keeps the index in sync with disk.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

use crate::db::Db;
use crate::documents::is_html;
use crate::library;

const MAX_DEPTH: usize = 12;
const MAX_FILES: usize = 20_000;
const SKIP_DIRS: &[&str] = &["node_modules", "target", "__pycache__", "venv", "Library", "bower_components"];

fn skipped(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

/// True if any component of `path` below `root` is hidden or a skipped dir.
fn ignored(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root)
        .map(|rel| {
            rel.components().any(|c| match c {
                Component::Normal(s) => skipped(&s.to_string_lossy()),
                _ => false,
            })
        })
        .unwrap_or(true)
}

fn html_files(dir: &Path) -> Vec<PathBuf> {
    WalkDir::new(dir)
        .max_depth(MAX_DEPTH)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !skipped(&e.file_name().to_string_lossy()))
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && is_html(e.path()))
        .take(MAX_FILES)
        .map(|e| e.into_path())
        .collect()
}

/// Brings one location's index up to date. Only changed files are re-read.
pub fn scan_location(db: &Db, location_id: i64, root: &Path) -> Result<(), String> {
    let found = html_files(root);
    let seen: HashSet<String> = found.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    for path in &found {
        let Some((size, modified)) = library::stat(path) else { continue };
        let conn = db.conn();
        if library::needs_index(&conn, &path.to_string_lossy(), size, modified) {
            if let Err(e) = library::index_file(&conn, path, Some(location_id)) {
                eprintln!("index {}: {e}", path.display());
            }
        }
    }
    let conn = db.conn();
    for (path, id) in library::location_paths(&conn, location_id)? {
        if !seen.contains(&path) && !Path::new(&path).exists() {
            library::forget(&conn, id)?;
        }
    }
    Ok(())
}

/// Applies filesystem events under a location to the index.
fn apply_events(db: &Db, location_id: i64, root: &Path, paths: &[PathBuf]) -> bool {
    let mut changed = false;
    for path in paths {
        if ignored(root, path) {
            continue;
        }
        if path.is_dir() {
            for file in html_files(path) {
                changed |= library::index_file(&db.conn(), &file, Some(location_id)).is_ok();
            }
        } else if path.is_file() {
            if !is_html(path) {
                continue;
            }
            let Some((size, modified)) = library::stat(path) else { continue };
            let conn = db.conn();
            if library::needs_index(&conn, &path.to_string_lossy(), size, modified) {
                changed |= library::index_file(&conn, path, Some(location_id)).is_ok();
            }
        } else {
            changed |= library::remove_path(&db.conn(), &path.to_string_lossy()).unwrap_or(0) > 0;
        }
    }
    changed
}

#[derive(Default)]
pub struct LocationWatchers {
    watchers: Mutex<HashMap<i64, RecommendedWatcher>>,
}

impl LocationWatchers {
    pub fn watch(&self, app: &AppHandle, location_id: i64, root: &Path) -> notify::Result<()> {
        let app_handle = app.clone();
        let root_owned = root.to_path_buf();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            if event.kind.is_access() {
                return;
            }
            let db = app_handle.state::<Db>();
            if apply_events(&db, location_id, &root_owned, &event.paths) {
                let _ = app_handle.emit("library-changed", ());
            }
        })?;
        watcher.watch(root, RecursiveMode::Recursive)?;
        self.watchers.lock().unwrap().insert(location_id, watcher);
        Ok(())
    }

    pub fn unwatch(&self, location_id: i64) {
        self.watchers.lock().unwrap().remove(&location_id);
    }
}

/// Scans and starts watching a location on a background thread.
pub fn start_location(app: &AppHandle, location_id: i64, root: PathBuf) {
    let app = app.clone();
    std::thread::spawn(move || {
        let db = app.state::<Db>();
        if let Err(e) = scan_location(&db, location_id, &root) {
            eprintln!("scan {}: {e}", root.display());
        }
        if let Err(e) = app.state::<LocationWatchers>().watch(&app, location_id, &root) {
            eprintln!("watch {}: {e}", root.display());
        }
        let _ = app.emit("library-changed", ());
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn scan_skips_hidden_and_dependency_folders() {
        let dir = std::env::temp_dir().join(format!("quire-scan-{:x}", rand::random::<u64>()));
        for d in ["a", "node_modules/pkg", ".git", "b/c"] {
            fs::create_dir_all(dir.join(d)).unwrap();
        }
        for f in ["a/one.html", "b/c/two.htm", "node_modules/pkg/x.html", ".git/y.html", "a/style.css"] {
            fs::write(dir.join(f), "<p>x</p>").unwrap();
        }
        let db = Db::open_in_memory(dir.join("trash"));
        let loc = library::add_location(&db.conn(), &dir).unwrap();
        scan_location(&db, loc, &dir).unwrap();
        let mut names: Vec<_> = library::location_paths(&db.conn(), loc)
            .unwrap()
            .into_keys()
            .map(|p| PathBuf::from(p).file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["one.html", "two.htm"]);

        fs::remove_file(dir.join("a/one.html")).unwrap();
        scan_location(&db, loc, &dir).unwrap();
        assert_eq!(library::location_paths(&db.conn(), loc).unwrap().len(), 1);
        let _ = fs::remove_dir_all(dir);
    }
}
