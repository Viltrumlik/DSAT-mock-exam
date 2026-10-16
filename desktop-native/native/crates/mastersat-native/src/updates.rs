//! Velopack: the install/update/uninstall hooks run by `ms_startup`, and `ms_update_*`.
//! Architecture §6. Behind the `updates` cargo feature (on by default); without it the hooks are
//! skipped and the update calls answer MS_ERR_UNSUPPORTED.
//!
//! Flow (Dart, Home only): `ms_update_check(feed, channel)` remembers what it found →
//! `ms_update_download()` (blocking, on a background isolate; `ms_update_progress()` polled from
//! the UI) → `ms_update_apply_restart()`, refused while a lockdown is engaged.
//!
//! Velopack's HTTP client (ureq) reads only the *_PROXY environment variables, never the Windows
//! proxy settings a school configures. So before each network call the system proxy for the feed
//! (`ms_proxy_for`, PAC/WPAD included) is exported as HTTPS_PROXY/HTTP_PROXY — unless the user set
//! those variables themselves.

use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

use serde::Serialize;

use crate::ffi::{MsError, MsResult};

/// `ms_update_progress` while idle.
pub const IDLE: i32 = -1;

static PROGRESS: AtomicI32 = AtomicI32::new(IDLE);
static DOWNLOADING: AtomicBool = AtomicBool::new(false);

/// The `ms_update_check` JSON.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CheckOutcome {
    pub available: bool,
    pub version: Option<String>,
    pub is_delta: bool,
    pub bytes: Option<u64>,
}

impl CheckOutcome {
    pub fn none() -> Self {
        CheckOutcome {
            available: false,
            version: None,
            is_delta: false,
            bytes: None,
        }
    }
}

pub fn progress() -> i32 {
    PROGRESS.load(Ordering::SeqCst)
}

/// Resets the download flags however the download ends (error or panic included).
struct DownloadGuard;

impl DownloadGuard {
    fn acquire() -> MsResult<DownloadGuard> {
        if DOWNLOADING.swap(true, Ordering::SeqCst) {
            return Err(MsError::new(
                crate::ffi::MS_ERR_BUSY,
                "an update download is already running",
            ));
        }
        PROGRESS.store(0, Ordering::SeqCst);
        Ok(DownloadGuard)
    }
}

impl Drop for DownloadGuard {
    fn drop(&mut self) {
        PROGRESS.store(IDLE, Ordering::SeqCst);
        DOWNLOADING.store(false, Ordering::SeqCst);
    }
}

fn check_inputs(feed_url: &str, channel: &str) -> MsResult<()> {
    let url = url::Url::parse(feed_url).map_err(|e| MsError::arg(format!("feed_url is not a URL ({e})")))?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(MsError::arg("feed_url must be http(s)"));
    }
    let ch = channel.trim();
    if ch.is_empty() || !ch.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(MsError::arg(format!("channel {channel:?} is not a channel name")));
    }
    Ok(())
}

pub use imp::{apply_restart, check, download, startup};

#[cfg(feature = "updates")]
mod imp {
    use super::*;
    use std::sync::Mutex;

    use velopack::sources::HttpSource;
    use velopack::{UpdateCheck, UpdateInfo, UpdateManager, UpdateOptions};

    struct Found {
        manager: UpdateManager,
        info: UpdateInfo,
        downloaded: bool,
    }

    static FOUND: Mutex<Option<Found>> = Mutex::new(None);

    fn map_err(e: velopack::Error) -> MsError {
        match e {
            velopack::Error::NotInstalled(why) => MsError::new(
                crate::ffi::MS_ERR_UNSUPPORTED,
                format!("this copy was not installed by the MasterSAT installer ({why})"),
            ),
            velopack::Error::NotSupported(why) => MsError::new(crate::ffi::MS_ERR_UNSUPPORTED, why),
            other => MsError::os(other.to_string()),
        }
    }

    /// `ms_startup`'s Velopack part. Install/update hooks (re)write the URL scheme, the uninstall
    /// hook removes it; Velopack then EXITS the process. Otherwise it returns and startup goes on
    /// (applying an already-downloaded update first, Velopack's default, before any window).
    /// Velopack ships on Windows and macOS (the two platforms the app runs on); on macOS the URL
    /// scheme is Info.plist's, so register_current is a harmless no-op there.
    #[cfg(any(windows, target_os = "macos"))]
    pub fn startup(args: Vec<String>) {
        use velopack::VelopackApp;
        fn register_current() {
            if let Ok(exe) = std::env::current_exe() {
                let _ = crate::protocol::register(&exe.to_string_lossy());
            }
        }
        VelopackApp::build()
            .set_args(args)
            .on_after_install_fast_callback(|_| register_current())
            .on_after_update_fast_callback(|_| register_current())
            .on_before_uninstall_fast_callback(|_| {
                let _ = crate::protocol::unregister();
            })
            .run();
    }

    /// Elsewhere (the Linux CI host) there is no installer, so nothing to run.
    #[cfg(not(any(windows, target_os = "macos")))]
    pub fn startup(_args: Vec<String>) {}

    pub fn check(feed_url: &str, channel: &str) -> MsResult<CheckOutcome> {
        check_inputs(feed_url, channel)?;
        export_system_proxy(feed_url);
        let options = UpdateOptions {
            AllowVersionDowngrade: false,
            ExplicitChannel: Some(channel.trim().to_string()),
            MaximumDeltasBeforeFallback: 0, // 0 = Velopack's default (10)
        };
        let manager = UpdateManager::new(HttpSource::new(feed_url), Some(options), None).map_err(map_err)?;
        let outcome = match manager.check_for_updates().map_err(map_err)? {
            UpdateCheck::UpdateAvailable(info) => {
                let info = *info;
                let is_delta = info.BaseRelease.is_some() && !info.DeltasToTarget.is_empty();
                let bytes = if is_delta {
                    info.DeltasToTarget.iter().map(|d| d.Size).sum()
                } else {
                    info.TargetFullRelease.Size
                };
                let outcome = CheckOutcome {
                    available: true,
                    version: Some(info.TargetFullRelease.Version.clone()),
                    is_delta,
                    bytes: Some(bytes),
                };
                *FOUND.lock().unwrap_or_else(|p| p.into_inner()) = Some(Found {
                    manager,
                    info,
                    downloaded: false,
                });
                outcome
            }
            UpdateCheck::NoUpdateAvailable | UpdateCheck::RemoteIsEmpty => {
                *FOUND.lock().unwrap_or_else(|p| p.into_inner()) = None;
                CheckOutcome::none()
            }
        };
        Ok(outcome)
    }

    pub fn download() -> MsResult<()> {
        let _guard = DownloadGuard::acquire()?;
        let (manager, info) = {
            let found = FOUND.lock().unwrap_or_else(|p| p.into_inner());
            let f = found
                .as_ref()
                .ok_or_else(|| MsError::new(crate::ffi::MS_ERR_NOT_FOUND, "ms_update_check has not found an update"))?;
            (f.manager.clone(), f.info.clone())
        };
        let (tx, rx) = std::sync::mpsc::channel::<i16>();
        let relay = std::thread::spawn(move || {
            for p in rx {
                PROGRESS.store(i32::from(p).clamp(0, 100), Ordering::SeqCst);
            }
        });
        let result = manager.download_updates(&info, Some(tx));
        let _ = relay.join(); // the sender was moved into download_updates and is dropped by now
        result.map_err(map_err)?;
        PROGRESS.store(100, Ordering::SeqCst);
        if let Some(f) = FOUND.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
            if f.info.TargetFullRelease.FileName == info.TargetFullRelease.FileName {
                f.downloaded = true;
            }
        }
        Ok(())
    }

    pub fn apply_restart() -> MsResult<()> {
        if crate::lock::is_active() {
            return Err(MsError::new(
                crate::ffi::MS_ERR_BUSY,
                "an update is never applied during a lockdown",
            ));
        }
        if DOWNLOADING.load(Ordering::SeqCst) {
            return Err(MsError::new(crate::ffi::MS_ERR_BUSY, "the update is still downloading"));
        }
        let (manager, info) = {
            let found = FOUND.lock().unwrap_or_else(|p| p.into_inner());
            match found.as_ref() {
                Some(f) if f.downloaded => (f.manager.clone(), f.info.clone()),
                _ => {
                    return Err(MsError::new(
                        crate::ffi::MS_ERR_NOT_FOUND,
                        "no downloaded update to apply (ms_update_download first)",
                    ))
                }
            }
        };
        // Exits the process on success (Velopack's updater applies it and relaunches the app).
        manager.apply_updates_and_restart(&info).map_err(map_err)
    }

    /// See the module comment. Windows and macOS (both read the system proxy natively); other
    /// hosts keep their environment as it is.
    #[cfg(any(windows, target_os = "macos"))]
    fn export_system_proxy(feed_url: &str) {
        use std::sync::OnceLock;
        const VARS: [&str; 2] = ["HTTPS_PROXY", "HTTP_PROXY"];
        // Whether the user had set the variables before this process touched them (then theirs win).
        static USER_SET: OnceLock<bool> = OnceLock::new();
        let user_set = *USER_SET.get_or_init(|| VARS.iter().any(|v| std::env::var_os(v).is_some()));
        if user_set {
            return;
        }
        let decision = crate::proxy::proxy_for(feed_url).unwrap_or_else(|_| "DIRECT".into());
        match first_proxy(&decision) {
            Some(hostport) => {
                for v in VARS {
                    std::env::set_var(v, format!("http://{hostport}"));
                }
            }
            None => {
                for v in VARS {
                    std::env::remove_var(v);
                }
            }
        }
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    fn export_system_proxy(_feed_url: &str) {}
}

#[cfg(not(feature = "updates"))]
mod imp {
    use super::*;

    pub fn startup(_args: Vec<String>) {}

    fn off() -> MsError {
        MsError::new(
            crate::ffi::MS_ERR_UNSUPPORTED,
            "this build has no updater (built without the `updates` feature)",
        )
    }

    pub fn check(feed_url: &str, channel: &str) -> MsResult<CheckOutcome> {
        check_inputs(feed_url, channel)?;
        Err(off())
    }

    pub fn download() -> MsResult<()> {
        let _guard = DownloadGuard::acquire()?;
        Err(off())
    }

    pub fn apply_restart() -> MsResult<()> {
        Err(off())
    }
}

/// The first `PROXY host:port` of a findProxy string.
#[cfg_attr(not(all(windows, feature = "updates")), allow(dead_code))]
fn first_proxy(decision: &str) -> Option<&str> {
    decision
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix("PROXY ").map(str::trim))
        .filter(|hp| !hp.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffi::{MS_ERR_ARG, MS_ERR_BUSY, MS_ERR_NOT_FOUND, MS_ERR_UNSUPPORTED};

    #[test]
    fn inputs_are_validated() {
        assert!(check_inputs("https://mastersat.uz/downloads/desktop/", "stable").is_ok());
        assert!(check_inputs("https://mastersat.uz/downloads/desktop/", "beta").is_ok());
        assert_eq!(check_inputs("nope", "stable").unwrap_err().code, MS_ERR_ARG);
        assert_eq!(check_inputs("file:///c:/feed", "stable").unwrap_err().code, MS_ERR_ARG);
        assert_eq!(check_inputs("https://x/", "").unwrap_err().code, MS_ERR_ARG);
        assert_eq!(check_inputs("https://x/", "../evil").unwrap_err().code, MS_ERR_ARG);
    }

    #[test]
    fn the_check_json_matches_the_header() {
        assert_eq!(
            serde_json::to_string(&CheckOutcome::none()).unwrap(),
            r#"{"available":false,"version":null,"is_delta":false,"bytes":null}"#
        );
        let some = CheckOutcome {
            available: true,
            version: Some("0.3.0".into()),
            is_delta: true,
            bytes: Some(1234),
        };
        assert_eq!(
            serde_json::to_string(&some).unwrap(),
            r#"{"available":true,"version":"0.3.0","is_delta":true,"bytes":1234}"#
        );
    }

    #[test]
    fn first_proxy_reads_find_proxy_strings() {
        assert_eq!(first_proxy("PROXY p:3128; DIRECT"), Some("p:3128"));
        assert_eq!(first_proxy("PROXY a:1; PROXY b:2; DIRECT"), Some("a:1"));
        assert_eq!(first_proxy("DIRECT"), None);
    }

    /// One test drives the shared download state, so no other test races its flags.
    #[test]
    fn download_state_machine_on_a_development_host() {
        let _serial = crate::global_state_guard();
        assert_eq!(progress(), IDLE);
        // Nothing checked (or no updater): download refuses and the state is idle again after.
        let code = download().unwrap_err().code;
        assert!(code == MS_ERR_NOT_FOUND || code == MS_ERR_UNSUPPORTED, "got {code}");
        assert_eq!(progress(), IDLE);
        assert!(!DOWNLOADING.load(Ordering::SeqCst));

        // A download already running → BUSY, without disturbing the running one's state.
        let guard = DownloadGuard::acquire().unwrap();
        assert_eq!(progress(), 0);
        assert_eq!(download().unwrap_err().code, MS_ERR_BUSY);
        assert!(DOWNLOADING.load(Ordering::SeqCst));
        assert_eq!(
            apply_restart().unwrap_err().code,
            if cfg!(feature = "updates") {
                MS_ERR_BUSY
            } else {
                MS_ERR_UNSUPPORTED
            }
        );
        drop(guard);
        assert_eq!(progress(), IDLE);

        // Nothing downloaded → apply refuses (never exits the test process).
        let code = apply_restart().unwrap_err().code;
        assert!(code == MS_ERR_NOT_FOUND || code == MS_ERR_UNSUPPORTED, "got {code}");
    }

    /// A development checkout is not a Velopack install: check fails cleanly, never panics.
    #[cfg(feature = "updates")]
    #[test]
    fn check_outside_an_install_is_unsupported() {
        let e = check("http://127.0.0.1:9/feed/", "stable").unwrap_err();
        assert_eq!(e.code, MS_ERR_UNSUPPORTED, "{}", e.message);
    }
}
