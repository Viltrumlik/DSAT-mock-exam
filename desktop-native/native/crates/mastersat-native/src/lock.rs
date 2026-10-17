//! The lockdown session: `ms_init`, `ms_lock_enter` / `ms_lock_exit`, `ms_heartbeat`, the 1 s
//! watchdog, `ms_away_now`, `ms_prove`, `ms_keep_awake`.
//!
//! Same contract as the Tauri shell's `lockdown_*` commands (desktop/src-tauri/src/main.rs):
//!  * enter refuses a machine that fails the pre-check, and otherwise CAPTURES the pre-check JSON
//!    that every later prove signs verbatim (never re-serialised);
//!  * prove works only while locked;
//!  * the UI heartbeats; 10 s of silence and the watchdog releases the lock by itself, so a
//!    student is never trapped behind a frozen exam — the next heartbeat then answers false and
//!    the UI knows to lock again.
//!
//! The machine side (pre-check, keyboard guard, capture exclusion) is `mastersat_lockdown`,
//! unchanged; this module adds only what Tauri's window used to do (fullscreen, topmost).

use std::sync::{Mutex, MutexGuard, Once, OnceLock};
use std::time::{Duration, Instant};

use mastersat_lockdown as lockdown;
use mastersat_proof as proof;
use serde::Serialize;

use crate::ffi::{MsError, MsResult, MS_ERR_NOT_INIT, MS_ERR_NOT_LOCKED, MS_ERR_NO_KEY, MS_ERR_PRECHECK};
use crate::key;
use crate::window::{self, SavedWindow};

/// Silence after which the watchdog releases (Tauri: `last_heartbeat.elapsed() > 10s`).
pub const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(10);
/// How often the watchdog looks (Tauri: a 1 s sleep loop).
pub const WATCHDOG_TICK: Duration = Duration::from_secs(1);

pub struct Shared {
    /// The top-level window (HWND as isize); 0 until ms_init (always 0 on macOS).
    pub hwnd: isize,
    /// True between a successful enter and an exit or a watchdog release.
    pub active: bool,
    pub last_heartbeat: Instant,
    /// The pre-check JSON captured at enter; empty while not locked.
    pub precheck_json: String,
    /// The window as it was before enter, restored at exit.
    pub saved_window: Option<SavedWindow>,
    /// What the UI asked for with ms_keep_awake (re-asserted after a release clears it).
    pub keep_awake: bool,
    /// The engaged lock is the strict one (a midterm: one window, one app).
    pub strict: bool,
}

impl Shared {
    fn new() -> Self {
        Shared {
            hwnd: 0,
            active: false,
            last_heartbeat: Instant::now(),
            precheck_json: String::new(),
            saved_window: None,
            keep_awake: false,
            strict: false,
        }
    }
}

static STATE: OnceLock<Mutex<Shared>> = OnceLock::new();
/// The app version from ms_init (first call wins) — signed inside every proof.
static APP_VERSION: OnceLock<String> = OnceLock::new();
static WATCHDOG: Once = Once::new();

/// The shared state. A panic elsewhere never poisons the lockdown for good.
pub fn state() -> MutexGuard<'static, Shared> {
    STATE
        .get_or_init(|| Mutex::new(Shared::new()))
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

/// Whether a lockdown is engaged right now.
pub fn is_active() -> bool {
    state().active
}

pub fn app_version() -> Option<&'static str> {
    APP_VERSION.get().map(String::as_str)
}

// ── init ───────────────────────────────────────────────────────────────────────────────────

/// `ms_init`: remember the window and version, install the keyboard guard (idle until a lock
/// engages), create the window-thread dispatcher, start the watchdog. Idempotent: a second call
/// only updates the window handle.
pub fn init(hwnd: isize, version: &str) -> MsResult<()> {
    if version.trim().is_empty() {
        return Err(MsError::arg("app_version is empty"));
    }
    if cfg!(windows) && !window::is_window(hwnd) {
        return Err(MsError::arg(format!("hwnd {hwnd:#x} is not a window")));
    }
    let _ = APP_VERSION.set(version.to_string());
    state().hwnd = hwnd;
    window::install_dispatcher(window::window_thread(hwnd));
    lockdown::init_keyboard_guard();
    start_watchdog();
    Ok(())
}

fn require_init() -> MsResult<()> {
    if app_version().is_none() {
        return Err(MsError::new(MS_ERR_NOT_INIT, "ms_init has not run in this process"));
    }
    Ok(())
}

// ── enter / exit ───────────────────────────────────────────────────────────────────────────

/// The outcome of `ms_lock_enter`: the precheck JSON is returned in BOTH cases (the failing
/// report on MS_ERR_PRECHECK).
pub enum EnterOutcome {
    Locked(String),
    Refused(String),
}

/// `ms_lock_enter` / `ms_lock_enter_ex`. Fresh pre-check; refuse if it fails; otherwise engage,
/// fullscreen + topmost, reset the heartbeat clock and capture the JSON. `strict` (a midterm)
/// pre-checks every other app with a window too, and engages the foreground guard.
pub fn enter(strict: bool) -> MsResult<EnterOutcome> {
    require_init()?;
    let report = lockdown::precheck_with(strict);
    let json = serde_json::to_string(&report).map_err(|e| MsError::os(e.to_string()))?;
    if !report.ok {
        return Ok(EnterOutcome::Refused(json));
    }

    let (hwnd, already_active) = {
        let s = state();
        (s.hwnd, s.active)
    };
    // Window work on the window's thread. Re-entering an engaged lock keeps the pre-lock
    // placement saved the first time.
    let saved = window::on_window_thread_wait(move || {
        let saved = window::enter_fullscreen(hwnd, !already_active, strict);
        lockdown::engage_with(hwnd, strict);
        saved
    });
    let saved = match saved {
        Some(Ok(saved)) => saved,
        Some(Err(e)) => {
            // Engaged (keyboard guard, capture exclusion) but the geometry failed: still a lock —
            // the server's off-screen strikes remain the enforcement. Recorded for diagnostics.
            crate::ffi::set_last_error(format!("ms_lock_enter: fullscreen failed: {e}"));
            None
        }
        None => {
            crate::ffi::set_last_error("ms_lock_enter: the window thread did not answer".into());
            None
        }
    };

    let mut s = state();
    if !s.active {
        s.saved_window = saved;
    }
    s.active = true;
    s.strict = strict;
    s.last_heartbeat = Instant::now();
    s.precheck_json = json.clone();
    Ok(EnterOutcome::Locked(json))
}

/// What a release has to undo, taken out of the state under the lock.
pub struct Release {
    pub hwnd: isize,
    pub saved: Option<SavedWindow>,
    pub keep_awake: bool,
}

fn take_release(s: &mut Shared) -> Release {
    s.active = false;
    s.strict = false;
    s.precheck_json.clear();
    Release {
        hwnd: s.hwnd,
        saved: s.saved_window.take(),
        keep_awake: s.keep_awake,
    }
}

/// Undo everything on the window thread: lockdown::release (keyboard guard off, capture
/// exclusion off, execution state back to ES_CONTINUOUS), restore the window, then re-assert the
/// UI's own keep-awake (release just cleared it).
fn release_on_window_thread(r: Release, wait: bool) {
    let job = move || {
        lockdown::release(r.hwnd);
        window::restore(r.hwnd, r.saved);
        if r.keep_awake {
            window::set_keep_awake(true);
        }
    };
    if wait {
        let _ = window::on_window_thread_wait(job);
    } else {
        let _ = window::on_window_thread(job, None);
    }
}

/// Whether `ms_lock_exit` has a lock to undo. On Windows a 0 handle means ms_init never ran, so
/// nothing was engaged (a dev host's lockdown release is a no-op anyway). The MacBook app has no
/// handle at all — it calls `ms_init(0, …)` and mac.rs finds the window through AppKit — and its
/// lock is real: skipping the release there left the machine locked after the paper was in.
fn releases_on_exit(hwnd: isize) -> bool {
    hwnd != 0 || cfg!(target_os = "macos")
}

/// `ms_lock_exit`: safe when not locked.
pub fn exit() {
    let r = take_release(&mut state());
    if !releases_on_exit(r.hwnd) {
        return;
    }
    release_on_window_thread(r, true);
}

/// `ms_heartbeat`: refresh the clock while locked; answer whether still locked.
pub fn heartbeat() -> bool {
    let mut s = state();
    if s.active {
        s.last_heartbeat = Instant::now();
    }
    s.active
}

/// One watchdog decision, pure so it is testable with synthetic clocks.
pub fn watchdog_tick(s: &mut Shared, now: Instant) -> Option<Release> {
    if s.active && now.saturating_duration_since(s.last_heartbeat) > HEARTBEAT_TIMEOUT {
        Some(take_release(s))
    } else {
        None
    }
}

fn start_watchdog() {
    WATCHDOG.call_once(|| {
        let spawned = std::thread::Builder::new()
            .name("mastersat-watchdog".into())
            .spawn(|| loop {
                std::thread::sleep(WATCHDOG_TICK);
                let release = watchdog_tick(&mut state(), Instant::now());
                if let Some(r) = release {
                    // Free the keyboard at once from this thread (Tauri's watchdog did exactly
                    // this), then let the window thread undo the rest without waiting on it —
                    // the window thread may be the thing that is frozen.
                    lockdown::release(r.hwnd);
                    release_on_window_thread(r, false);
                }
            });
        if let Err(e) = spawned {
            crate::ffi::set_last_error(format!("ms_init: watchdog thread failed to start: {e}"));
        }
    });
}

// ── away / prove / keep-awake ──────────────────────────────────────────────────────────────

/// `ms_away_now`: the foreground window is not this process's, or more than one monitor.
pub fn away_now() -> bool {
    !lockdown::foreground_is_ours() || lockdown::monitor_count() > 1
}

/// The `ms_prove` output: the body of `POST desktop_session/` minus `nonce`.
#[derive(Serialize)]
pub struct Proof {
    pub key_id: String,
    pub mac: String,
    pub app_version: String,
    /// The captured pre-check, verbatim.
    pub precheck: String,
}

/// `ms_prove`: sign the server's challenge over the captured pre-check, only while locked.
pub fn prove(attempt_id: i64, nonce: &str) -> MsResult<String> {
    let precheck = {
        let s = state();
        if !s.active {
            return Err(MsError::new(MS_ERR_NOT_LOCKED, "The app is not locked down."));
        }
        s.precheck_json.clone()
    };
    let version = app_version().ok_or_else(|| MsError::new(MS_ERR_NOT_INIT, "ms_init has not run in this process"))?;
    let (key_id, secret_hex) = key::embedded_key()
        .ok_or_else(|| MsError::new(MS_ERR_NO_KEY, "this build has no DESKTOP_PROOF_KEY embedded"))?;
    let mac =
        proof::sign(&secret_hex, attempt_id, nonce, version, &precheck).map_err(|e| MsError::new(MS_ERR_NO_KEY, e))?;
    serde_json::to_string(&Proof {
        key_id,
        mac,
        app_version: version.to_string(),
        precheck,
    })
    .map_err(|e| MsError::os(e.to_string()))
}

/// `ms_keep_awake`. The lock keeps the display on by itself (lockdown::engage), so turning
/// keep-awake off while locked leaves the lock's flags in place.
pub fn keep_awake(on: bool) {
    let effective = {
        let mut s = state();
        s.keep_awake = on;
        on || s.active
    };
    let _ = window::on_window_thread_wait(move || window::set_keep_awake(effective));
}

/// `ms_lock_enter`'s refusal, as an error carrying the failing report.
pub fn refused_error() -> MsError {
    MsError::new(MS_ERR_PRECHECK, "the machine fails the pre-check")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn locked_at(t: Instant) -> Shared {
        let mut s = Shared::new();
        s.active = true;
        s.last_heartbeat = t;
        s.precheck_json = "{}".into();
        s.hwnd = 42;
        s.keep_awake = true;
        s
    }

    #[test]
    fn the_watchdog_waits_ten_seconds_of_silence() {
        let t0 = Instant::now();
        let mut s = locked_at(t0);
        assert!(watchdog_tick(&mut s, t0 + Duration::from_secs(5)).is_none());
        assert!(
            watchdog_tick(&mut s, t0 + Duration::from_secs(10)).is_none(),
            "exactly 10 s is not yet stale"
        );
        assert!(s.active);

        let r = watchdog_tick(&mut s, t0 + Duration::from_millis(10_001)).expect("released");
        assert_eq!(r.hwnd, 42);
        assert!(r.keep_awake);
        assert!(!s.active);
        assert!(s.precheck_json.is_empty(), "a released lock cannot prove");
        // Once released, nothing more to do.
        assert!(watchdog_tick(&mut s, t0 + Duration::from_secs(60)).is_none());
    }

    #[test]
    fn the_watchdog_ignores_an_unlocked_app() {
        let t0 = Instant::now();
        let mut s = Shared::new();
        s.last_heartbeat = t0;
        assert!(watchdog_tick(&mut s, t0 + Duration::from_secs(3600)).is_none());
    }

    #[test]
    fn exit_releases_a_windows_lock_and_every_macbook_lock() {
        assert!(releases_on_exit(42));
        // The MacBook app calls ms_init(0, …): its 0 handle still holds a real lock.
        assert_eq!(releases_on_exit(0), cfg!(target_os = "macos"));
    }

    #[test]
    fn a_clock_that_goes_backwards_is_not_stale() {
        let t0 = Instant::now() + Duration::from_secs(100);
        let mut s = locked_at(t0);
        assert!(watchdog_tick(&mut s, Instant::now()).is_none());
    }
}
