//! The `quire://` scheme that serves documents to the sandboxed viewer.
//!
//! Security model: every request names a document id. Files are served only
//! from that document's own directory, after resolving symlinks, and hidden
//! files (`.env`, `.git`, `.ssh`, ...) are never served. Each document gets its
//! own origin, so pages cannot read each other or the app.
//!
//! The document's own HTML gets one extra `<script>`: the Quire bridge, which
//! powers visual editing and keeps scroll position across reloads.

use std::borrow::Cow;
use std::path::PathBuf;

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};

use crate::documents::{document_url, dunce_canonicalize, Document, Registry, SCHEME};

const BRIDGE_JS: &str = include_str!("bridge.js");
const BRIDGE_PATH: [&str; 2] = ["__quire", "bridge.js"];

pub fn handle(registry: &Registry, request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    match respond(registry, request) {
        Ok(res) => res,
        Err(status) => error(status),
    }
}

fn respond(registry: &Registry, request: &Request<Vec<u8>>) -> Result<Response<Cow<'static, [u8]>>, StatusCode> {
    let uri = request.uri();
    let host = uri.host().unwrap_or_default();
    let mut raw = uri.path().split('/').filter(|s| !s.is_empty());

    // macOS/Linux: quire://<id>/<path>. Windows: http://quire.localhost/<id>/<path>.
    let windows_host = format!("{SCHEME}.localhost");
    let id = if host == windows_host || host == "localhost" || host.is_empty() {
        raw.next().ok_or(StatusCode::NOT_FOUND)?.to_string()
    } else {
        host.to_string()
    };
    let doc = registry.get(&id).ok_or(StatusCode::NOT_FOUND)?;

    let mut segments = Vec::new();
    for s in raw {
        let segment = percent_decode_str(s).decode_utf8().map_err(|_| StatusCode::BAD_REQUEST)?;
        if segment == ".." || segment.contains(['/', '\\']) {
            return Err(StatusCode::FORBIDDEN);
        }
        segments.push(segment.into_owned());
    }

    if segments == BRIDGE_PATH {
        return Ok(ok("text/javascript", Cow::Borrowed(BRIDGE_JS.as_bytes())));
    }
    if segments.iter().any(|s| s.starts_with('.')) {
        return Err(StatusCode::FORBIDDEN);
    }

    let is_main = segments.len() == 1 && segments[0] == doc.file_name();
    if is_main {
        if let Some(overlay) = &doc.overlay {
            return Ok(html_response(&id, overlay));
        }
    }

    let path = resolve(&doc, &segments)?;
    if path == doc.path {
        let bytes = std::fs::read(&path).map_err(|_| StatusCode::NOT_FOUND)?;
        return Ok(html_response(&id, &String::from_utf8_lossy(&bytes)));
    }
    let bytes = std::fs::read(&path).map_err(|_| StatusCode::NOT_FOUND)?;
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    Ok(ok(mime.essence_str(), Cow::Owned(bytes)))
}

fn resolve(doc: &Document, segments: &[String]) -> Result<PathBuf, StatusCode> {
    let mut path = doc.root.clone();
    path.extend(segments);
    let mut path = dunce_canonicalize(&path).map_err(|_| StatusCode::NOT_FOUND)?;
    if !path.starts_with(&doc.root) {
        return Err(StatusCode::FORBIDDEN);
    }
    if path.is_dir() {
        path.push("index.html");
    }
    if !path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(path)
}

fn html_response(id: &str, html: &str) -> Response<Cow<'static, [u8]>> {
    let script = document_url(id, &BRIDGE_PATH);
    ok("text/html; charset=utf-8", Cow::Owned(inject(html, &script).into_bytes()))
}

/// Inserts the bridge script as the first thing in `<head>` (or `<html>`, or
/// after the doctype), so it runs before the page's own scripts.
pub fn inject(html: &str, script_url: &str) -> String {
    let tag = format!(r#"<script src="{script_url}"></script>"#);
    let lower = html.to_ascii_lowercase();
    let at = tag_end(&lower, "<head")
        .or_else(|| tag_end(&lower, "<html"))
        .or_else(|| tag_end(&lower, "<!doctype"))
        .unwrap_or(0);
    let mut out = String::with_capacity(html.len() + tag.len());
    out.push_str(&html[..at]);
    out.push_str(&tag);
    out.push_str(&html[at..]);
    out
}

/// Byte offset just after the `>` of the first `<name ...>` tag.
fn tag_end(lower: &str, open: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(found) = lower[from..].find(open) {
        let start = from + found;
        let next = lower.as_bytes().get(start + open.len()).copied();
        if matches!(next, Some(b'>' | b' ' | b'\t' | b'\n' | b'\r')) {
            return lower[start..].find('>').map(|e| start + e + 1);
        }
        from = start + open.len();
    }
    None
}

fn ok(mime: &str, body: Cow<'static, [u8]>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(body)
        .unwrap()
}

fn error(status: StatusCode) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(Cow::Borrowed(status.canonical_reason().unwrap_or("error").as_bytes()))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Fixture {
        dir: PathBuf,
        registry: Registry,
        id: String,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    /// Layout: <tmp>/secret.txt, <tmp>/site/{index.html, assets/app.css, .env, my page.html}
    fn fixture() -> Fixture {
        let dir = std::env::temp_dir().join(format!("quire-test-{:x}", rand::random::<u64>()));
        let site = dir.join("site");
        fs::create_dir_all(site.join("assets")).unwrap();
        fs::write(dir.join("secret.txt"), "outside").unwrap();
        fs::write(site.join("index.html"), "<html><head><title>t</title></head><h1>hi</h1></html>").unwrap();
        fs::write(site.join("my page.html"), "spaced").unwrap();
        fs::write(site.join("assets/app.css"), "body{}").unwrap();
        fs::write(site.join(".env"), "TOKEN=1").unwrap();
        let registry = Registry::default();
        let (info, _) = registry.open(&site.join("index.html")).unwrap();
        Fixture { dir, registry, id: info.id }
    }

    fn get(f: &Fixture, path: &str) -> (StatusCode, String, String) {
        get_id(f, &f.id, path)
    }

    fn get_id(f: &Fixture, id: &str, path: &str) -> (StatusCode, String, String) {
        let uri = format!("quire://{id}/{path}");
        let req = Request::builder().uri(uri).body(Vec::new()).unwrap();
        let res = handle(&f.registry, &req);
        let mime = res
            .headers()
            .get(header::CONTENT_TYPE)
            .map(|v| v.to_str().unwrap().to_string())
            .unwrap_or_default();
        (res.status(), mime, String::from_utf8_lossy(res.body()).into_owned())
    }

    #[test]
    fn serves_document_with_bridge_and_assets_untouched() {
        let f = fixture();
        let (status, mime, body) = get(&f, "index.html");
        assert_eq!((status, mime.as_str()), (StatusCode::OK, "text/html; charset=utf-8"));
        assert!(body.starts_with(&format!(
            "<html><head><script src=\"quire://{}/__quire/bridge.js\"></script><title>",
            f.id
        )));
        let (status, mime, body) = get(&f, "assets/app.css");
        assert_eq!((status, mime.as_str(), body.as_str()), (StatusCode::OK, "text/css", "body{}"));
        assert_eq!(get(&f, "").0, StatusCode::OK, "directory falls back to index.html");
        assert_eq!(get(&f, "my%20page.html").2, "spaced", "other html files are not injected");
        let (status, mime, _) = get(&f, "__quire/bridge.js");
        assert_eq!((status, mime.as_str()), (StatusCode::OK, "text/javascript"));
    }

    #[test]
    fn overlay_replaces_the_document_only() {
        let f = fixture();
        f.registry.set_overlay(&f.id, Some("<p>draft</p>".into())).unwrap();
        assert!(get(&f, "index.html").2.ends_with("<p>draft</p>"));
        assert_eq!(get(&f, "assets/app.css").2, "body{}");
        f.registry.set_overlay(&f.id, None).unwrap();
        assert!(get(&f, "index.html").2.contains("<h1>hi</h1>"));
    }

    #[test]
    fn virtual_documents_serve_content_with_real_assets() {
        let f = fixture();
        let v = f.registry.open_virtual(&f.dir.join("site/index.html"), "<p>old</p>".into()).unwrap();
        assert_ne!(v.id, f.id);
        assert!(get_id(&f, &v.id, "index.html").2.ends_with("<p>old</p>"));
        assert_eq!(get_id(&f, &v.id, "assets/app.css").0, StatusCode::OK);
    }

    #[test]
    fn blocks_escaping_the_document_folder() {
        let f = fixture();
        assert_eq!(get(&f, "../secret.txt").0, StatusCode::FORBIDDEN);
        assert_eq!(get(&f, "%2E%2E/secret.txt").0, StatusCode::FORBIDDEN);
        assert_eq!(get(&f, "..%2Fsecret.txt").0, StatusCode::FORBIDDEN);
        assert_eq!(get(&f, "assets/..%2F..%2Fsecret.txt").0, StatusCode::FORBIDDEN);
    }

    #[test]
    fn blocks_hidden_files() {
        let f = fixture();
        assert_eq!(get(&f, ".env").0, StatusCode::FORBIDDEN);
        assert_eq!(get(&f, "%2Eenv").0, StatusCode::FORBIDDEN);
    }

    #[cfg(unix)]
    #[test]
    fn blocks_symlinks_pointing_outside() {
        let f = fixture();
        std::os::unix::fs::symlink(f.dir.join("secret.txt"), f.dir.join("site/link.txt")).unwrap();
        assert_eq!(get(&f, "link.txt").0, StatusCode::FORBIDDEN);
    }

    #[test]
    fn unknown_document_is_not_found() {
        let f = fixture();
        assert_eq!(get_id(&f, "deadbeef", "index.html").0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn windows_style_urls_resolve() {
        let f = fixture();
        let uri = format!("http://quire.localhost/{}/assets/app.css", f.id);
        let req = Request::builder().uri(uri).body(Vec::new()).unwrap();
        assert_eq!(handle(&f.registry, &req).status(), StatusCode::OK);
    }

    #[test]
    fn injection_placement() {
        let s = "S";
        let script = r#"<script src="S"></script>"#;
        assert_eq!(inject("<!DOCTYPE html><HTML><Head><title>x", s), format!("<!DOCTYPE html><HTML><Head>{script}<title>x"));
        assert_eq!(inject("<html lang=en><header>h</header>", s), format!("<html lang=en>{script}<header>h</header>"));
        assert_eq!(inject("<!doctype html><p>x", s), format!("<!doctype html>{script}<p>x"));
        assert_eq!(inject("<p>x", s), format!("{script}<p>x"));
    }
}
