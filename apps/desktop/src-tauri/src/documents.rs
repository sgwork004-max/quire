//! Registry of HTML documents the UI is showing: open tabs, library
//! thumbnails and version previews.
//!
//! Each document gets an unguessable id. The sandboxed `quire://` protocol
//! uses that id to decide which directory a page may load files from, so a
//! page can only ever see its own folder. A document can carry an *overlay*:
//! in-memory HTML served instead of the file on disk (unsaved edits, or an old
//! version being previewed).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Serialize;

pub const SCHEME: &str = "quire";
pub const HTML_EXTENSIONS: &[&str] = &["html", "htm", "xhtml"];

/// Characters left unescaped in a URL path segment.
const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'.').remove(b'_').remove(b'~');

#[derive(Clone)]
pub struct Document {
    /// Canonical path to the HTML file.
    pub path: PathBuf,
    /// Canonical directory the page may load assets from.
    pub root: PathBuf,
    pub overlay: Option<Arc<String>>,
    /// Virtual documents (version previews) are never written to disk.
    pub is_virtual: bool,
}

impl Document {
    pub fn file_name(&self) -> String {
        self.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub url: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

#[derive(Default)]
pub struct Registry {
    docs: Mutex<HashMap<String, Document>>,
}

fn new_id() -> String {
    format!("{:016x}", rand::random::<u64>())
}

impl Registry {
    pub fn get(&self, id: &str) -> Option<Document> {
        self.docs.lock().unwrap().get(id).cloned()
    }

    /// Registers `path` and returns its info. Reopening an already registered
    /// file returns the existing id so tabs and thumbnails share one origin.
    pub fn open(&self, path: &Path) -> Result<(DocumentInfo, bool), String> {
        let path = dunce_canonicalize(path)?;
        if !path.is_file() {
            return Err(format!("{} is not a file", path.display()));
        }
        if !is_html(&path) {
            return Err(format!("{} is not an HTML file", path.display()));
        }
        let root = path.parent().ok_or("file has no parent directory")?.to_path_buf();

        let mut docs = self.docs.lock().unwrap();
        if let Some((id, doc)) = docs.iter().find(|(_, d)| d.path == path && !d.is_virtual) {
            return Ok((info(id, doc), false));
        }
        let id = new_id();
        let doc = Document { path, root, overlay: None, is_virtual: false };
        let info = info(&id, &doc);
        docs.insert(id, doc);
        Ok((info, true))
    }

    /// A read-only document showing `content` as if it lived at `path`, so
    /// relative assets still load. Used to preview old versions.
    pub fn open_virtual(&self, path: &Path, content: String) -> Result<DocumentInfo, String> {
        let dir = path.parent().ok_or("file has no parent directory")?;
        let root = dunce_canonicalize(dir)?;
        let path = root.join(path.file_name().ok_or("missing file name")?);
        let id = new_id();
        let doc = Document { path, root, overlay: Some(Arc::new(content)), is_virtual: true };
        let info = info(&id, &doc);
        self.docs.lock().unwrap().insert(id, doc);
        Ok(info)
    }

    pub fn set_overlay(&self, id: &str, overlay: Option<String>) -> Result<(), String> {
        let mut docs = self.docs.lock().unwrap();
        let doc = docs.get_mut(id).ok_or("document is not open")?;
        doc.overlay = overlay.map(Arc::new);
        Ok(())
    }

    pub fn close(&self, id: &str) {
        self.docs.lock().unwrap().remove(id);
    }
}

pub fn is_html(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| HTML_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn info(id: &str, doc: &Document) -> DocumentInfo {
    let meta = std::fs::metadata(&doc.path).ok();
    let modified_ms = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let name = doc.file_name();
    DocumentInfo {
        id: id.to_string(),
        path: doc.path.to_string_lossy().into_owned(),
        url: document_url(id, &[&name]),
        name,
        size_bytes: meta.map(|m| m.len()).unwrap_or(0),
        modified_ms,
    }
}

/// URL for a file inside a document's origin. Windows' WebView2 only supports
/// custom schemes as `http://<scheme>.localhost`, so the id moves into the path.
pub fn document_url(id: &str, segments: &[&str]) -> String {
    let path: Vec<String> = segments.iter().map(|s| utf8_percent_encode(s, SEGMENT).to_string()).collect();
    let path = path.join("/");
    if cfg!(windows) {
        format!("http://{SCHEME}.localhost/{id}/{path}")
    } else {
        format!("{SCHEME}://{id}/{path}")
    }
}

/// `canonicalize` without Windows' `\\?\` prefix, which breaks `starts_with`
/// checks against paths built elsewhere.
pub fn dunce_canonicalize(path: &Path) -> Result<PathBuf, String> {
    let p = std::fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?;
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            if !rest.starts_with("UNC") {
                return Ok(PathBuf::from(rest));
            }
        }
    }
    Ok(p)
}
