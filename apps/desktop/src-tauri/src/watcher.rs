//! Watches open documents and tells the UI to reload when the HTML or one of
//! its assets changes on disk, so edits from an editor or an AI tool show up live.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

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
            if !matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            ) {
                return;
            }
            if event.paths.iter().any(|p| p == &file || is_asset(p)) {
                let _ = app.emit("document-changed", &doc_id);
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
