//! Finds the local files an HTML page uses (stylesheets, scripts, images,
//! fonts, data files) so sharing uploads exactly those and nothing else from
//! the folder. Static references are found in attributes, `url(...)` and
//! quoted strings in the page and in its CSS/JS (which catches things like
//! `fetch("data.json")`). Only files inside the page's folder qualify.

use std::collections::{BTreeMap, VecDeque};
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

const MAX_ASSETS: usize = 300;
pub const MAX_ASSET_BYTES: u64 = 25 * 1024 * 1024;
const SCANNABLE: &[&str] = &["css", "js", "mjs", "html", "htm", "svg", "json"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asset {
    /// Path relative to the page's folder, with `/` separators.
    pub path: String,
    pub abs: PathBuf,
    pub hash: String,
    pub size: u64,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Every candidate reference in a text: attribute values, url(...) and quoted strings.
fn references(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Only ASCII delimiters matter; skip into the middle of multi-byte
        // characters (e.g. "·" or "₹") without slicing there.
        if !text.is_char_boundary(i) {
            i += 1;
            continue;
        }
        let c = bytes[i];
        if c == b'"' || c == b'\'' || c == b'`' {
            if let Some(end) = text[i + 1..].find(c as char) {
                let s = &text[i + 1..i + 1 + end];
                if s.len() < 300 && !s.contains('\n') {
                    out.push(s.to_string());
                }
                i += end + 2;
                continue;
            }
        } else if text[i..].starts_with("url(") {
            if let Some(end) = text[i + 4..].find(')') {
                out.push(text[i + 4..i + 4 + end].trim().trim_matches(['"', '\'']).to_string());
                i += end + 5;
                continue;
            }
        } else if text[i..].starts_with("srcset=") {
            // srcset lists "a.png 1x, b.png 2x"; split it into paths.
            if let Some(q) = text[i + 7..].chars().next().filter(|q| *q == '"' || *q == '\'') {
                if let Some(end) = text[i + 8..].find(q) {
                    for part in text[i + 8..i + 8 + end].split(',') {
                        if let Some(p) = part.split_whitespace().next() {
                            out.push(p.to_string());
                        }
                    }
                }
            }
        }
        i += 1;
    }
    out
}

/// Resolves a reference against `from_dir`, returning it only if it is a
/// plain relative path to an existing, non-hidden file inside `root`.
fn resolve(root: &Path, from_dir: &Path, reference: &str) -> Option<PathBuf> {
    let r = reference.split(['?', '#']).next()?.trim();
    if r.is_empty() || r.starts_with('/') || r.starts_with("//") || r.contains("://") || r.contains('\\') {
        return None;
    }
    if r.starts_with("data:") || r.starts_with("mailto:") || r.starts_with("javascript:") || r.contains(['<', '>', '{', '}', ' ']) {
        return None;
    }
    // Needs a file extension to be worth checking.
    let last = r.rsplit('/').next()?;
    if !last.contains('.') || last.ends_with('.') {
        return None;
    }
    let decoded = percent_encoding::percent_decode_str(r).decode_utf8().ok()?;
    let mut path = from_dir.to_path_buf();
    for comp in Path::new(decoded.as_ref()).components() {
        match comp {
            Component::Normal(s) if !s.to_string_lossy().starts_with('.') => path.push(s),
            Component::CurDir => {}
            Component::ParentDir => {
                path.pop();
            }
            _ => return None,
        }
    }
    let path = std::fs::canonicalize(&path).ok()?;
    (path.starts_with(root) && path.is_file()).then_some(path)
}

/// The assets `html` (living in `root`) uses, transitively through CSS/JS.
pub fn collect(root: &Path, html: &str, page: &Path) -> Vec<Asset> {
    let root = match std::fs::canonicalize(root) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let page = std::fs::canonicalize(page).unwrap_or_default();
    let mut found: BTreeMap<PathBuf, ()> = BTreeMap::new();
    let mut queue: VecDeque<(PathBuf, String)> = VecDeque::from([(root.clone(), html.to_string())]);

    while let Some((dir, text)) = queue.pop_front() {
        for reference in references(&text) {
            let Some(path) = resolve(&root, &dir, &reference) else { continue };
            if path == page || found.contains_key(&path) || found.len() >= MAX_ASSETS {
                continue;
            }
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            if meta.len() > MAX_ASSET_BYTES {
                continue;
            }
            found.insert(path.clone(), ());
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            if SCANNABLE.contains(&ext.as_str()) && meta.len() < 2 * 1024 * 1024 {
                if let Ok(t) = std::fs::read_to_string(&path) {
                    queue.push_back((path.parent().unwrap_or(&root).to_path_buf(), t));
                }
            }
        }
    }

    found
        .into_keys()
        .filter_map(|abs| {
            let bytes = std::fs::read(&abs).ok()?;
            let rel = abs.strip_prefix(&root).ok()?;
            let path = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            Some(Asset { path, hash: sha256_hex(&bytes), size: bytes.len() as u64, abs })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_referenced_files_only() {
        let dir = std::env::temp_dir().join(format!("quire-assets-{:x}", rand::random::<u64>()));
        let site = dir.join("site");
        for d in ["css", "img", "fonts"] {
            fs::create_dir_all(site.join(d)).unwrap();
        }
        fs::write(dir.join("secret.txt"), "outside").unwrap();
        fs::write(site.join("css/app.css"), "body{background:url('../img/bg.png')} @font-face{src:url(../fonts/a.woff2)}").unwrap();
        fs::write(site.join("img/bg.png"), "png").unwrap();
        fs::write(site.join("img/logo 2x.png"), "png2").unwrap();
        fs::write(site.join("fonts/a.woff2"), "font").unwrap();
        fs::write(site.join("app.js"), "fetch('data.json').then(r => r.json())").unwrap();
        fs::write(site.join("data.json"), "{}").unwrap();
        fs::write(site.join("unused.png"), "nope").unwrap();
        fs::write(site.join(".env"), "TOKEN=1").unwrap();
        let html = r#"<p>Week 41 · Mumbai ₹4.2 Cr — “quoted”</p><link rel="stylesheet" href="css/app.css?v=2"><script src="./app.js"></script>
            <img srcset="img/logo%202x.png 2x"><img src="https://cdn.example.com/x.png">
            <a href="../secret.txt">x</a><img src=".env"><img src="/etc/hosts"><p>"just some text."</p>"#;
        fs::write(site.join("index.html"), html).unwrap();

        let mut paths: Vec<String> = collect(&site, html, &site.join("index.html")).into_iter().map(|a| a.path).collect();
        paths.sort();
        assert_eq!(
            paths,
            vec!["app.js", "css/app.css", "data.json", "fonts/a.woff2", "img/bg.png", "img/logo 2x.png"]
        );
        let _ = fs::remove_dir_all(dir);
    }
}
