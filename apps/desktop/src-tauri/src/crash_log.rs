//! Writes panics to a log file the user can send us. Release builds unwind, so a
//! panic on a background thread ends that task instead of the whole app.

use std::io::Write;
use std::path::PathBuf;

pub fn install() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(path) = log_path() {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
                let secs = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let thread = std::thread::current();
                let _ = writeln!(
                    f,
                    "[{secs}] v{} thread '{}': {info}",
                    env!("CARGO_PKG_VERSION"),
                    thread.name().unwrap_or("unnamed"),
                );
            }
        }
        default(info);
    }));
}

fn log_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Logs/Quire/crash.log"));
    #[cfg(windows)]
    return std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Quire/crash.log"));
    #[cfg(not(any(target_os = "macos", windows)))]
    return std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/state/quire/crash.log"));
}
