//! Watches open documents. When the HTML or one of its assets changes on disk
//! the UI reloads, and changes to the HTML itself are saved to version history
//! (so an AI tool rewriting a file never loses the previous version).

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::Db;
use crate::versions;

const ASSET_EXTENSIONS: &[&str] = &[
    "css", "js", "mjs", "json", "csv", "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "woff",
    "woff2", "ttf",
];

#[derive(Default)]
pub struct Watchers {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl Watchers {
    pub fn watch(&self, app: &AppHandle, id: &str, file: &Path, root: &Path) -> notify::Result<()> {
        let app = app.clone();
        let doc_id = id.to_string();
        let file = file.to_path_buf();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) {
                return;
            }
            let doc_changed = event.paths.iter().any(|p| p == &file);
            if doc_changed {
                if let Ok(bytes) = std::fs::read(&file) {
                    let content = String::from_utf8_lossy(&bytes);
                    let db = app.state::<Db>();
                    let _ = versions::record(&db.conn(), &file.to_string_lossy(), &content, "disk");
                }
            }
            if doc_changed || event.paths.iter().any(|p| is_asset(p)) {
                let _ = app.emit("document-changed", serde_json::json!({ "id": doc_id, "doc": doc_changed }));
            }
        })?;
        watcher.watch(root, RecursiveMode::NonRecursive)?;
        self.watchers.lock().unwrap().insert(id.to_string(), watcher);
        Ok(())
    }

    pub fn unwatch(&self, id: &str) {
        self.watchers.lock().unwrap().remove(id);
    }
}

fn is_asset(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ASSET_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}
