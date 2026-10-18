//! Live data: a page can pull CSV or JSON from a URL into `data/<name>` next
//! to it, refreshed on a schedule. The page reads it with an ordinary
//! `fetch("data/<name>")`, and shared copies receive the fresh file through
//! the normal asset sync.

use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{err, now_ms, Db};

const MAX_BYTES: usize = 10 * 1024 * 1024;
const EXTENSIONS: &[&str] = &["csv", "tsv", "json", "txt"];
const CHECK_EVERY: Duration = Duration::from_secs(60);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSource {
    id: i64,
    doc_path: String,
    name: String,
    url: String,
    interval_min: i64,
    last_fetched_ms: Option<i64>,
    last_error: Option<String>,
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<DataSource> {
    Ok(DataSource {
        id: r.get(0)?,
        doc_path: r.get(1)?,
        name: r.get(2)?,
        url: r.get(3)?,
        interval_min: r.get(4)?,
        last_fetched_ms: r.get(5)?,
        last_error: r.get(6)?,
    })
}

const COLUMNS: &str = "id, doc_path, name, url, interval_min, last_fetched_ms, last_error";

/// Google Sheets "edit" links become their CSV export (the sheet must be shared by link).
pub fn normalize_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    if !url.starts_with("https://") {
        return Err("Use an https:// link".into());
    }
    if let Some(rest) = url.strip_prefix("https://docs.google.com/spreadsheets/d/") {
        let id = rest.split('/').next().unwrap_or_default();
        if !id.is_empty() && id != "e" && !url.contains("/pub") && !url.contains("format=csv") {
            let gid = url.split("gid=").nth(1).map(|g| g.split(['&', '#']).next().unwrap_or("0")).unwrap_or("0");
            return Ok(format!("https://docs.google.com/spreadsheets/d/{id}/export?format=csv&gid={gid}"));
        }
    }
    Ok(url.to_string())
}

/// `sales.csv` style names only: no folders, no hidden files, a data extension.
pub fn validate_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\', ':']) || name.len() > 100 {
        return Err("Use a simple file name like sales.csv".into());
    }
    if !EXTENSIONS.contains(&ext.as_str()) {
        return Err("The file name must end in .csv, .tsv, .json or .txt".into());
    }
    Ok(name.to_string())
}

fn target(doc_path: &str, name: &str) -> Result<PathBuf, String> {
    let dir = Path::new(doc_path).parent().ok_or("no folder")?.join("data");
    Ok(dir.join(name))
}

fn get(conn: &Connection, id: i64) -> Result<DataSource, String> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM data_sources WHERE id = ?1"), [id], row).map_err(err)
}

/// Downloads one source and writes it only if it changed. Returns true if the file changed.
async fn refresh(http: &reqwest::Client, db: &Db, src: &DataSource) -> bool {
    let result: Result<bool, String> = async {
        let res = http.get(&src.url).send().await.map_err(|e| format!("Couldn't download: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("The link returned {}", res.status()));
        }
        let bytes = res.bytes().await.map_err(err)?;
        if bytes.len() > MAX_BYTES {
            return Err("The data is larger than 10 MB".into());
        }
        if src.name.ends_with(".json") && serde_json::from_slice::<serde_json::Value>(&bytes).is_err() {
            return Err("The link didn't return valid JSON".into());
        }
        let path = target(&src.doc_path, &src.name)?;
        if std::fs::read(&path).ok().as_deref() == Some(&bytes[..]) {
            return Ok(false);
        }
        std::fs::create_dir_all(path.parent().unwrap()).map_err(err)?;
        let tmp = path.with_file_name(format!(".{}.quire-tmp", src.name));
        std::fs::write(&tmp, &bytes).map_err(err)?;
        std::fs::rename(&tmp, &path).map_err(err)?;
        Ok(true)
    }
    .await;
    let (changed, error) = match result {
        Ok(c) => (c, None),
        Err(e) => (false, Some(e)),
    };
    let _ = db.conn().execute(
        "UPDATE data_sources SET last_fetched_ms = ?1, last_error = ?2 WHERE id = ?3",
        params![now_ms(), error, src.id],
    );
    changed
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Quire/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("http client")
}

/// Refreshes sources that are due, every minute, for as long as the app runs.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let client = http();
        loop {
            let due: Vec<DataSource> = {
                let db = app.state::<Db>();
                let conn = db.conn();
                let now = now_ms();
                conn.prepare(&format!(
                    "SELECT {COLUMNS} FROM data_sources WHERE last_fetched_ms IS NULL OR last_fetched_ms + interval_min * 60000 <= ?1"
                ))
                .and_then(|mut s| s.query_map([now], row)?.collect::<Result<Vec<_>, _>>())
                .unwrap_or_default()
            };
            for src in due {
                if refresh(&client, &app.state::<Db>(), &src).await {
                    let _ = app.emit("data-refreshed", &src.doc_path);
                }
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

#[tauri::command]
pub fn list_data_sources(db: State<'_, Db>, path: String) -> Result<Vec<DataSource>, String> {
    let conn = db.conn();
    let mut stmt = conn
        .prepare(&format!("SELECT {COLUMNS} FROM data_sources WHERE doc_path = ?1 ORDER BY name"))
        .map_err(err)?;
    let rows = stmt.query_map([path], row).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[tauri::command]
pub async fn add_data_source(app: AppHandle, path: String, url: String, name: String, interval_min: i64) -> Result<DataSource, String> {
    let db = app.state::<Db>();
    let url = normalize_url(&url)?;
    let name = validate_name(&name)?;
    if !crate::documents::is_html(Path::new(&path)) || !Path::new(&path).is_file() {
        return Err("Open an HTML file first".into());
    }
    let interval = interval_min.clamp(5, 7 * 24 * 60);
    let id: i64 = db
        .conn()
        .query_row(
            "INSERT INTO data_sources (doc_path, name, url, interval_min, created_ms) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (doc_path, name) DO UPDATE SET url = excluded.url, interval_min = excluded.interval_min, last_error = NULL
             RETURNING id",
            params![path, name, url, interval, now_ms()],
            |r| r.get(0),
        )
        .map_err(err)?;
    let src = get(&db.conn(), id)?;
    if refresh(&http(), &db, &src).await {
        let _ = app.emit("data-refreshed", &src.doc_path);
    }
    let updated = get(&db.conn(), id);
    updated
}

#[tauri::command]
pub async fn refresh_data_source(app: AppHandle, id: i64) -> Result<DataSource, String> {
    let db = app.state::<Db>();
    let src = get(&db.conn(), id)?;
    if refresh(&http(), &db, &src).await {
        let _ = app.emit("data-refreshed", &src.doc_path);
    }
    let updated = get(&db.conn(), id);
    updated
}

/// Stops refreshing. The last downloaded file stays so the page keeps working.
#[tauri::command]
pub fn remove_data_source(db: State<'_, Db>, id: i64) -> Result<(), String> {
    db.conn().execute("DELETE FROM data_sources WHERE id = ?1", [id]).map(|_| ()).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn google_sheet_links_become_csv_exports() {
        assert_eq!(
            normalize_url("https://docs.google.com/spreadsheets/d/abc123/edit#gid=42").unwrap(),
            "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=42"
        );
        assert_eq!(
            normalize_url("https://docs.google.com/spreadsheets/d/abc123/edit").unwrap(),
            "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0"
        );
        let published = "https://docs.google.com/spreadsheets/d/e/2PACX/pub?output=csv";
        assert_eq!(normalize_url(published).unwrap(), published);
        assert!(normalize_url("http://example.com/x.csv").is_err());
        assert!(normalize_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn names_stay_inside_the_data_folder() {
        assert_eq!(validate_name(" sales.csv ").unwrap(), "sales.csv");
        for bad in ["../x.csv", ".env", "a/b.csv", "x.html", "x", ""] {
            assert!(validate_name(bad).is_err(), "{bad} should be rejected");
        }
    }
}

#[cfg(test)]
mod network {
    /// Downloads a real public CSV: `cargo test live_download -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn live_download() {
        let res = super::http()
            .get("https://raw.githubusercontent.com/plotly/datasets/master/2014_apple_stock.csv")
            .send()
            .await
            .unwrap();
        assert!(res.status().is_success());
        let body = res.text().await.unwrap();
        assert!(body.starts_with("AAPL_x,AAPL_y"), "{}", &body[..40.min(body.len())]);
    }
}
