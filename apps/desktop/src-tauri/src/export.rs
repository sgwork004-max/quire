//! Export: PDF through the macOS print panel, and single-file HTML with every
//! stylesheet, script, image, font and data file inlined, ready to email.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use base64::Engine;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::assets;
use crate::db::err;
use crate::documents::{Registry, SCHEME};

/// Opens the document in its own window and shows the print panel, where
/// "Save as PDF" lives. The window gets no app permissions (capabilities
/// only cover "main") and can't navigate away from the document.
#[tauri::command]
pub async fn print_document(app: AppHandle, registry: State<'_, Registry>, id: String) -> Result<(), String> {
    let doc = registry.get(&id).ok_or("document is not open")?;
    let url: tauri::Url = crate::documents::document_url(&id, &[&doc.file_name()]).parse().map_err(err)?;
    let label = format!("print-{id}");
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.close();
    }
    let allowed = url.clone();
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::CustomProtocol(url))
        .title(format!("Print · {}", doc.file_name()))
        .inner_size(900.0, 1000.0)
        .on_navigation(move |next| {
            let same_doc = next.scheme() == allowed.scheme() && next.host_str() == allowed.host_str();
            same_doc || (cfg!(windows) && next.as_str().starts_with(&format!("http://{SCHEME}.localhost/")))
        })
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                // Give charts and fonts a moment to render before printing.
                let w = window.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                    let _ = w.print();
                });
            }
        })
        .build()
        .map_err(err)?;
    Ok(())
}

fn mime(path: &Path) -> String {
    mime_guess::from_path(path).first_or_octet_stream().essence_str().to_string()
}

fn data_uri(path: &Path, bytes: &[u8]) -> String {
    format!("data:{};base64,{}", mime(path), base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn is_text_data(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("json" | "csv" | "tsv" | "txt")
    )
}

fn ext(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// Every way `rel` might be written in a page relative to `from_dir`.
fn spellings(rel_from_root: &str) -> Vec<String> {
    let encoded = rel_from_root.replace(' ', "%20");
    let mut v = vec![rel_from_root.to_string(), format!("./{rel_from_root}")];
    if encoded != rel_from_root {
        v.push(encoded.clone());
        v.push(format!("./{encoded}"));
    }
    v
}

/// Replaces quoted or url()-wrapped references to `spelling` (optionally with ?query/#hash).
fn replace_refs(text: &str, spelling: &str, with: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find(spelling) {
        let before = rest[..i].chars().last();
        let after_idx = i + spelling.len();
        let tail = &rest[after_idx..];
        let suffix_len = if tail.starts_with('?') || tail.starts_with('#') {
            tail.find(['"', '\'', ')', '`', ' ']).unwrap_or(0)
        } else {
            0
        };
        let after = tail[suffix_len..].chars().next();
        let delimited = matches!(before, Some('"' | '\'' | '(' | '`' | ' ' | '='))
            && matches!(after, Some('"' | '\'' | ')' | '`' | ' ' | ','));
        out.push_str(&rest[..i]);
        if delimited {
            out.push_str(with);
            rest = &tail[suffix_len..];
        } else {
            out.push_str(spelling);
            rest = tail;
        }
    }
    out.push_str(rest);
    out
}

/// Inlines url(...) references in a stylesheet located at `css_path`.
fn inline_css(css: &str, css_path: &Path, by_path: &HashMap<PathBuf, (String, Vec<u8>)>) -> String {
    let dir = css_path.parent().unwrap_or(Path::new(""));
    let mut out = css.to_string();
    for (abs, (_, bytes)) in by_path {
        if let Ok(rel) = pathdiff(abs, dir) {
            for s in spellings(&rel) {
                out = replace_refs(&out, &s, &data_uri(abs, bytes));
            }
        }
    }
    out
}

/// `target` relative to `base` with `/` separators (both absolute).
fn pathdiff(target: &Path, base: &Path) -> Result<String, ()> {
    let t: Vec<_> = target.components().collect();
    let b: Vec<_> = base.components().collect();
    let common = t.iter().zip(&b).take_while(|(x, y)| x == y).count();
    if common == 0 {
        return Err(());
    }
    let mut parts: Vec<String> = std::iter::repeat("..".to_string()).take(b.len() - common).collect();
    parts.extend(t[common..].iter().map(|c| c.as_os_str().to_string_lossy().into_owned()));
    Ok(parts.join("/"))
}

/// Builds a self-contained copy of `html` (living at `page`): stylesheets and
/// scripts are inlined, images and fonts become data URIs, and data files read
/// with fetch() are embedded and served by a small fetch shim.
pub fn standalone(page: &Path, html: &str) -> String {
    let root = page.parent().unwrap_or(Path::new("/"));
    let found = assets::collect(root, html, page);
    let mut by_path: HashMap<PathBuf, (String, Vec<u8>)> = HashMap::new();
    for a in &found {
        if let Ok(bytes) = std::fs::read(&a.abs) {
            by_path.insert(a.abs.clone(), (a.path.clone(), bytes));
        }
    }

    let mut out = html.to_string();
    let mut data_files: Vec<(String, String, String)> = Vec::new(); // (rel, mime, text)

    // Stylesheets and scripts first (tags are replaced whole), then everything else.
    for (abs, (rel, bytes)) in &by_path {
        let text = String::from_utf8_lossy(bytes);
        for s in spellings(rel) {
            match ext(abs).as_str() {
                "css" => {
                    let css = inline_css(&text, abs, &by_path).replace("</style", "<\\/style");
                    out = replace_tag(&out, "link", "href", &s, &format!("<style>\n{css}\n</style>"));
                }
                "js" | "mjs" => {
                    let js = text.replace("</script", "<\\/script");
                    let module = if ext(abs) == "mjs" { " type=\"module\"" } else { "" };
                    out = replace_script(&out, &s, &format!("<script{module}>\n{js}\n</script>"));
                }
                _ => {}
            }
        }
    }
    for (abs, (rel, bytes)) in &by_path {
        if is_text_data(abs) {
            data_files.push((rel.clone(), mime(abs), String::from_utf8_lossy(bytes).into_owned()));
            continue;
        }
        if matches!(ext(abs).as_str(), "css" | "js" | "mjs") {
            continue;
        }
        let uri = data_uri(abs, bytes);
        for s in spellings(rel) {
            out = replace_refs(&out, &s, &uri);
        }
    }

    if !data_files.is_empty() {
        let map: serde_json::Map<String, serde_json::Value> = data_files
            .iter()
            .flat_map(|(rel, mime, text)| {
                spellings(rel).into_iter().map(move |s| (s, serde_json::json!({ "type": mime, "body": text })))
            })
            .collect();
        let json = serde_json::Value::Object(map).to_string().replace("</", "<\\/");
        let shim = format!(
            "<script>/* Quire: data files embedded at export */(()=>{{const files={json};const real=window.fetch;\
window.fetch=(input,init)=>{{const url=typeof input===\"string\"?input:input.url;const key=url.split(/[?#]/)[0];\
const f=files[key];return f?Promise.resolve(new Response(f.body,{{headers:{{\"Content-Type\":f.type}}}})):real(input,init);}};}})();</script>"
        );
        out = crate::protocol::insert_in_head(&out, &shim);
    }
    out
}

/// Replaces `<tag ... attr="value" ...>` (any quote style) with `with`.
fn replace_tag(html: &str, tag: &str, attr: &str, value: &str, with: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut out = String::new();
    let mut last = 0;
    let open = format!("<{tag}");
    let mut from = 0;
    while let Some(i) = lower[from..].find(&open) {
        let start = from + i;
        let Some(end) = lower[start..].find('>').map(|e| start + e + 1) else { break };
        let tag_text = &html[start..end];
        let matches = [format!("{attr}=\"{value}\""), format!("{attr}='{value}'"), format!("{attr}={value}")]
            .iter()
            .any(|p| tag_text.contains(p.as_str()));
        if matches {
            out.push_str(&html[last..start]);
            out.push_str(with);
            last = end;
        }
        from = end;
    }
    out.push_str(&html[last..]);
    out
}

/// Replaces `<script ... src="value" ...></script>` with `with`.
fn replace_script(html: &str, value: &str, with: &str) -> String {
    let replaced = replace_tag(html, "script", "src", value, "\u{0}QUIRE_SCRIPT\u{0}");
    // Drop the now-empty closing tag that followed each replaced opening tag.
    let mut out = String::new();
    let mut rest = replaced.as_str();
    while let Some(i) = rest.find("\u{0}QUIRE_SCRIPT\u{0}") {
        out.push_str(&rest[..i]);
        out.push_str(with);
        rest = &rest[i + "\u{0}QUIRE_SCRIPT\u{0}".len()..];
        let trimmed = rest.trim_start();
        if trimmed.to_ascii_lowercase().starts_with("</script>") {
            rest = &trimmed["</script>".len()..];
        }
    }
    out.push_str(rest);
    out
}

#[tauri::command]
pub fn export_standalone(registry: State<'_, Registry>, id: String, dest: String) -> Result<String, String> {
    let doc = registry.get(&id).ok_or("document is not open")?;
    // The UI saves pending edits first, so the file on disk is what's on screen.
    let html = String::from_utf8_lossy(&std::fs::read(&doc.path).map_err(err)?).into_owned();
    let dest = PathBuf::from(dest);
    if !crate::documents::is_html(&dest) {
        return Err("Save it with an .html extension".into());
    }
    std::fs::write(&dest, standalone(&doc.path, &html)).map_err(err)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn inlines_everything_a_page_uses() {
        let dir = std::env::temp_dir().join(format!("quire-export-{:x}", rand::random::<u64>()));
        fs::create_dir_all(dir.join("css")).unwrap();
        fs::create_dir_all(dir.join("img")).unwrap();
        fs::write(dir.join("css/app.css"), "body{background:url('../img/bg.png')}").unwrap();
        fs::write(dir.join("img/bg.png"), [137, 80, 78, 71]).unwrap();
        fs::write(dir.join("img/logo 1.svg"), "<svg/>").unwrap();
        fs::write(dir.join("app.js"), "fetch('data.json').then(r=>r.json()); // </script> in a string").unwrap();
        fs::write(dir.join("data.json"), "{\"ok\":true}").unwrap();
        let html = "<!doctype html><html><head><link rel=\"stylesheet\" href=\"css/app.css\"></head>\
            <body><img src=\"img/logo%201.svg\"><script src=\"app.js\"></script></body></html>";
        let page = dir.join("index.html");
        fs::write(&page, html).unwrap();

        let out = standalone(&fs::canonicalize(&page).unwrap(), html);
        assert!(out.contains("<style>\nbody{background:url('data:image/png;base64,iVBORw==')}"), "{out}");
        assert!(out.contains("src=\"data:image/svg+xml;base64,"));
        assert!(out.contains("<script>\nfetch('data.json')"));
        assert!(out.contains("<\\/script> in a string"), "closing tags inside scripts are escaped");
        assert!(!out.contains("src=\"app.js\""));
        assert!(out.contains("\"data.json\":{\"body\":\"{\\\"ok\\\":true}\""), "data files are embedded for fetch");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn relative_paths() {
        assert_eq!(pathdiff(Path::new("/a/img/x.png"), Path::new("/a/css")).unwrap(), "../img/x.png");
        assert_eq!(pathdiff(Path::new("/a/x.png"), Path::new("/a")).unwrap(), "x.png");
    }
}

#[cfg(test)]
mod manual {
    /// Writes the demo fixture as a single file for checking by eye:
    /// `QUIRE_EXPORT_OUT=/tmp/demo.html cargo test export_demo_fixture -- --ignored`
    #[test]
    #[ignore]
    fn export_demo_fixture() {
        let page = std::fs::canonicalize(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../fixtures/demo/index.html")).unwrap();
        let html = std::fs::read_to_string(&page).unwrap();
        let out = std::env::var("QUIRE_EXPORT_OUT").expect("set QUIRE_EXPORT_OUT");
        std::fs::write(out, super::standalone(&page, &html)).unwrap();
    }
}
