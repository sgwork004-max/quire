//! Registry of HTML documents currently open in the app.
//!
//! Each open document gets an unguessable id. The sandboxed `quire://` protocol
//! uses that id to decide which directory a page is allowed to load files from,
//! so a page can only ever see its own folder.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
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

impl Registry {
    pub fn get(&self, id: &str) -> Option<Document> {
        self.docs.lock().unwrap().get(id).cloned()
    }

    /// Registers `path` and returns its info. Reopening an already open file
    /// returns the existing id so tabs are not duplicated.
    pub fn open(&self, path: &Path) -> Result<(DocumentInfo, bool), String> {
        let path = dunce_canonicalize(path)?;
        if !path.is_file() {
            return Err(format!("{} is not a file", path.display()));
        }
        if !is_html(&path) {
            return Err(format!("{} is not an HTML file", path.display()));
        }
        let root = path
            .parent()
            .ok_or_else(|| "file has no parent directory".to_string())?
            .to_path_buf();

        let mut docs = self.docs.lock().unwrap();
        if let Some((id, doc)) = docs.iter().find(|(_, d)| d.path == path) {
            return Ok((info(id, doc)?, false));
        }
        let id = format!("{:016x}", rand::random::<u64>());
        let doc = Document { path, root };
        let info = info(&id, &doc)?;
        docs.insert(id, doc);
        Ok((info, true))
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

fn info(id: &str, doc: &Document) -> Result<DocumentInfo, String> {
    let meta = std::fs::metadata(&doc.path).map_err(|e| e.to_string())?;
    let name = doc
        .path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(DocumentInfo {
        id: id.to_string(),
        path: doc.path.to_string_lossy().into_owned(),
        url: document_url(id, &name),
        name,
        size_bytes: meta.len(),
        modified_ms,
    })
}

/// URL the sandboxed iframe loads. Windows' WebView2 only supports custom
/// schemes in the `http://<scheme>.localhost` form, so the id moves into the path.
pub fn document_url(id: &str, file_name: &str) -> String {
    let file = utf8_percent_encode(file_name, SEGMENT);
    if cfg!(windows) {
        format!("http://{SCHEME}.localhost/{id}/{file}")
    } else {
        format!("{SCHEME}://{id}/{file}")
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
