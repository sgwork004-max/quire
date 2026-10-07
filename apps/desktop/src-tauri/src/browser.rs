//! "Open in Browser". Opening a .html file normally goes to the default app for
//! .html, which may be Quire itself, so on macOS we look up the default *web
//! browser* (the http handler) and open the file with that explicitly.

use std::path::Path;

pub fn open(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        match default_browser_bundle_id() {
            Some(id) => cmd.args(["-b", &id]),
            None => cmd.args(["-a", "Safari"]),
        };
        let status = cmd.arg(path).status().map_err(|e| e.to_string())?;
        return if status.success() { Ok(()) } else { Err("could not open browser".into()) };
    }
    #[cfg(not(target_os = "macos"))]
    {
        let url = format!("file://{}", path.to_string_lossy());
        tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "macos")]
fn default_browser_bundle_id() -> Option<String> {
    let out = std::process::Command::new("defaults")
        .args(["read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    // The plist prints one dictionary per handler; find the one for https.
    for entry in text.split('}') {
        if entry.contains("LSHandlerURLScheme = https;") {
            let line = entry.lines().find(|l| l.contains("LSHandlerRoleAll"))?;
            let id = line.split('=').nth(1)?.trim().trim_end_matches(';').trim_matches('"');
            if !id.is_empty() && id != "-" {
                return Some(id.to_string());
            }
        }
    }
    None
}
