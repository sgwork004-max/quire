//! The `quire://` scheme that serves open documents to the sandboxed viewer.
//!
//! Security model: every request names a document id. Files are served only
//! from that document's own directory, after resolving symlinks, and hidden
//! files (`.env`, `.git`, `.ssh`, ...) are never served. Each document gets its
//! own origin, so pages cannot read each other or the app.

use std::borrow::Cow;
use std::path::PathBuf;

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};

use crate::documents::{dunce_canonicalize, Registry, SCHEME};

pub fn handle(registry: &Registry, request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    match resolve(registry, request) {
        Ok(path) => match std::fs::read(&path) {
            Ok(bytes) => {
                let mime = mime_guess::from_path(&path).first_or_octet_stream();
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, mime.essence_str())
                    .header(header::CACHE_CONTROL, "no-store")
                    .header("X-Content-Type-Options", "nosniff")
                    .body(Cow::Owned(bytes))
                    .unwrap()
            }
            Err(_) => error(StatusCode::NOT_FOUND),
        },
        Err(status) => error(status),
    }
}

fn resolve(registry: &Registry, request: &Request<Vec<u8>>) -> Result<PathBuf, StatusCode> {
    let uri = request.uri();
    let host = uri.host().unwrap_or_default();
    let mut segments = uri.path().split('/').filter(|s| !s.is_empty());

    // macOS/Linux: quire://<id>/<path>. Windows: http://quire.localhost/<id>/<path>.
    let windows_host = format!("{SCHEME}.localhost");
    let id = if host == windows_host || host == "localhost" || host.is_empty() {
        segments.next().ok_or(StatusCode::NOT_FOUND)?.to_string()
    } else {
        host.to_string()
    };
    let doc = registry.get(&id).ok_or(StatusCode::NOT_FOUND)?;

    let mut path = doc.root.clone();
    for raw in segments {
        let segment = percent_decode_str(raw)
            .decode_utf8()
            .map_err(|_| StatusCode::BAD_REQUEST)?;
        if segment == ".." || segment.starts_with('.') || segment.contains(['/', '\\']) {
            return Err(StatusCode::FORBIDDEN);
        }
        path.push(segment.as_ref());
    }

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
        fs::write(site.join("index.html"), "<h1>hi</h1>").unwrap();
        fs::write(site.join("my page.html"), "spaced").unwrap();
        fs::write(site.join("assets/app.css"), "body{}").unwrap();
        fs::write(site.join(".env"), "TOKEN=1").unwrap();
        let registry = Registry::default();
        let (info, _) = registry.open(&site.join("index.html")).unwrap();
        Fixture { dir, registry, id: info.id }
    }

    fn get(f: &Fixture, path: &str) -> (StatusCode, String, String) {
        let uri = format!("quire://{}/{}", f.id, path);
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
    fn serves_document_and_assets_with_mime() {
        let f = fixture();
        assert_eq!(get(&f, "index.html"), (StatusCode::OK, "text/html".into(), "<h1>hi</h1>".into()));
        let (status, mime, _) = get(&f, "assets/app.css");
        assert_eq!((status, mime.as_str()), (StatusCode::OK, "text/css"));
        assert_eq!(get(&f, "").0, StatusCode::OK, "directory falls back to index.html");
        assert_eq!(get(&f, "my%20page.html").2, "spaced");
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
        let req = Request::builder().uri("quire://deadbeef/index.html").body(Vec::new()).unwrap();
        assert_eq!(handle(&f.registry, &req).status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn windows_style_urls_resolve() {
        let f = fixture();
        let uri = format!("http://quire.localhost/{}/assets/app.css", f.id);
        let req = Request::builder().uri(uri).body(Vec::new()).unwrap();
        assert_eq!(handle(&f.registry, &req).status(), StatusCode::OK);
    }
}
