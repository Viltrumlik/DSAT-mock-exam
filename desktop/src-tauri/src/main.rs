// No console window behind the app on Windows release builds.
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

//! The MasterSAT exam app for Windows.
//!
//! A thin Tauri shell whose one window loads https://mastersat.uz/desktop — the website runs
//! inside it exactly as it does in a browser, and `frontend/src/lib/desktop/bridge.ts` reaches
//! these commands when, and only when, it is the MasterSAT site in this app (see
//! `capabilities/mastersat.json`). Everything the page cannot do for itself lives here: the
//! machine pre-check, the keyboard lock, the lockdown proof, battery, and "Sign in with browser".
//!
//! The command names and payloads below ARE the contract in bridge.ts; the proof arithmetic is
//! the contract in `backend/desktop/proof.py`. Changing either side alone breaks a real exam.

mod lockdown;
mod proof;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, Manager, State, Url, WebviewWindow};
use tauri_plugin_deep_link::DeepLinkExt;

use lockdown::{BatteryStatus, PrecheckReport};

/// The site the app is for. The window loads it, deep links only ever navigate within it, and the
/// capability grants the native commands to this origin alone.
const SITE: &str = "https://mastersat.uz";

#[derive(Debug, Clone, Serialize)]
struct AppInfo {
    version: String,
}

/// What `lockdown_prove` hands back; the web side forwards it to `desktop_session` unchanged.
#[derive(Debug, Clone, Serialize)]
struct LockdownProof {
    key_id: String,
    mac: String,
    app_version: String,
    /// The exact pre-check JSON that was signed — re-serialising it would break the HMAC.
    precheck: String,
}

struct Shared {
    /// True between a successful `lockdown_enter` and `lockdown_exit` (or a watchdog release).
    active: bool,
    /// The page proves it is alive by calling `lockdown_heartbeat`; 10s of silence releases.
    last_heartbeat: Instant,
    /// The pre-check JSON captured at `enter`, signed verbatim by every `prove`.
    precheck_json: String,
    /// The last away-state pushed to the page, so the watcher only speaks on a change.
    away: bool,
    /// The window handle, cached so the watchdog can release the lockdown without the window arg.
    hwnd: isize,
}

struct AppState {
    shared: Mutex<Shared>,
    /// The PKCE verifier of an in-flight "Sign in with browser". Taken once by the page.
    verifier: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            shared: Mutex::new(Shared {
                active: false,
                last_heartbeat: Instant::now(),
                precheck_json: String::new(),
                away: false,
                hwnd: 0,
            }),
            verifier: Mutex::new(None),
        }
    }
}

fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// The build's signing key as `(key_id, secret_hex)`. In a real release the pair is injected at
/// compile time from the `DESKTOP_PROOF_KEY` CI secret (format `key_id:hex`) and is never in the
/// repo; the server's `DESKTOP_PROOF_KEYS` must hold the same pair. The fallback is a development
/// key for local builds only — a production server would not accept a proof signed with it.
fn embedded_key() -> (String, String) {
    let raw = option_env!("DESKTOP_PROOF_KEY")
        .unwrap_or("dev1:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
    match raw.split_once(':') {
        Some((id, hex)) => (id.to_string(), hex.to_string()),
        None => ("dev1".to_string(), raw.to_string()),
    }
}

fn make_verifier() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 48]; // → 64 url-safe chars, inside RFC 7636's 43–128.
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(windows)]
fn window_hwnd(window: &WebviewWindow) -> isize {
    window.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}

#[cfg(not(windows))]
fn window_hwnd(_window: &WebviewWindow) -> isize {
    0
}

// ───────────────────────────────── commands ─────────────────────────────────

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: app_version(),
    }
}

#[tauri::command]
fn lockdown_precheck() -> PrecheckReport {
    lockdown::precheck()
}

#[tauri::command]
fn lockdown_close_app(exe: String) -> Result<(), String> {
    lockdown::close_app(&exe)
}

/// Lock the machine down — but only if the pre-check passes. On a failing machine it returns the
/// report with `ok:false` and locks nothing, which is what the pre-check screen shows.
#[tauri::command]
fn lockdown_enter(window: WebviewWindow, state: State<AppState>) -> Result<PrecheckReport, String> {
    let report = lockdown::precheck();
    if !report.ok {
        return Ok(report);
    }
    let precheck_json = serde_json::to_string(&report).map_err(|e| e.to_string())?;
    let hwnd = window_hwnd(&window);

    let _ = window.set_always_on_top(true);
    let _ = window.set_fullscreen(true);
    lockdown::engage(hwnd);

    let mut s = state.shared.lock().map_err(|_| "state poisoned")?;
    s.active = true;
    s.last_heartbeat = Instant::now();
    s.precheck_json = precheck_json;
    s.away = false;
    s.hwnd = hwnd;
    Ok(report)
}

/// Sign the server's challenge. Fails unless the lockdown is active, so a page that has not locked
/// the machine cannot mint a proof.
#[tauri::command]
fn lockdown_prove(
    state: State<AppState>,
    attempt_id: i64,
    nonce: String,
) -> Result<LockdownProof, String> {
    let s = state.shared.lock().map_err(|_| "state poisoned")?;
    if !s.active {
        return Err("The app is not locked down.".into());
    }
    let (key_id, secret_hex) = embedded_key();
    let version = app_version();
    let precheck = s.precheck_json.clone();
    let mac = proof::sign(&secret_hex, attempt_id, &nonce, &version, &precheck)?;
    Ok(LockdownProof {
        key_id,
        mac,
        app_version: version,
        precheck,
    })
}

/// Release everything. Safe to call when nothing is locked.
#[tauri::command]
fn lockdown_exit(window: WebviewWindow, state: State<AppState>) {
    let hwnd = {
        let mut s = match state.shared.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        s.active = false;
        s.away = false;
        s.hwnd
    };
    lockdown::release(hwnd);
    let _ = window.set_fullscreen(false);
    let _ = window.set_always_on_top(false);
}

#[tauri::command]
fn lockdown_heartbeat(state: State<AppState>) {
    if let Ok(mut s) = state.shared.lock() {
        if s.active {
            s.last_heartbeat = Instant::now();
        }
    }
}

#[tauri::command]
fn battery_status() -> Option<BatteryStatus> {
    lockdown::battery()
}

/// Begin "Sign in with browser": make a PKCE verifier, remember it, open the student's own browser
/// at the link page carrying the challenge.
#[tauri::command]
fn auth_begin(state: State<AppState>) -> Result<(), String> {
    let verifier = make_verifier();
    let challenge = proof::pkce_challenge(&verifier);
    *state.verifier.lock().map_err(|_| "state poisoned")? = Some(verifier);
    let url = format!("{SITE}/desktop/link?challenge={challenge}");
    open::that(url).map_err(|e| e.to_string())
}

#[tauri::command]
fn auth_take_verifier(state: State<AppState>) -> Option<String> {
    state.verifier.lock().ok().and_then(|mut v| v.take())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) links open in the browser.".into());
    }
    open::that(url).map_err(|e| e.to_string())
}

// ───────────────────────────── deep links ─────────────────────────────
// The installer registers the `mastersat://` scheme. Two shapes, both of which only ever move the
// app's own window within mastersat.uz — never to another origin.
//   mastersat://auth?code=…   the browser handing back a "Sign in with browser" code
//   mastersat://open?path=…   a browser link asking the app to open a page of the site

fn only_site_path(path: &str) -> bool {
    path.starts_with('/') && !path.starts_with("//") && !path.contains('\\') && !path.contains("://")
}

fn handle_deep_link(app: &AppHandle, raw: &str) {
    let parsed = match Url::parse(raw) {
        Ok(u) => u,
        Err(_) => return,
    };
    if parsed.scheme() != "mastersat" {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match parsed.host_str().unwrap_or("") {
        "auth" => {
            if let Some((_, code)) = parsed.query_pairs().find(|(k, _)| k == "code") {
                if let Ok(mut target) = Url::parse(&format!("{SITE}/desktop/login")) {
                    target.query_pairs_mut().append_pair("code", &code);
                    let _ = window.navigate(target);
                    let _ = window.set_focus();
                }
            }
        }
        "open" => {
            if let Some((_, path)) = parsed.query_pairs().find(|(k, _)| k == "path") {
                if only_site_path(&path) {
                    if let Ok(target) = Url::parse(&format!("{SITE}{path}")) {
                        let _ = window.navigate(target);
                        let _ = window.set_focus();
                    }
                }
            }
        }
        _ => {}
    }
}

/// Drop the lockdown and undo the window changes. Used by the watchdog.
fn release_lockdown(app: &AppHandle, hwnd: isize) {
    lockdown::release(hwnd);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_fullscreen(false);
        let _ = w.set_always_on_top(false);
    }
}

fn main() {
    tauri::Builder::default()
        // single-instance must be the first plugin. Its deep-link feature forwards a second
        // launch's mastersat:// URL into the running window instead of opening a second copy.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState::default())
        .setup(|app| {
            lockdown::init_keyboard_guard();

            let dl_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle_deep_link(&dl_handle, url.as_str());
                }
            });

            // Watchdog: if the exam page goes quiet for 10s while locked (a crash, a kill), the
            // shell releases the lockdown itself so a student is never trapped.
            let wd = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                let state = wd.state::<AppState>();
                let (active, stale, hwnd) = match state.shared.lock() {
                    Ok(s) => (
                        s.active,
                        s.last_heartbeat.elapsed() > Duration::from_secs(10),
                        s.hwnd,
                    ),
                    Err(_) => continue,
                };
                if active && stale {
                    if let Ok(mut s) = state.shared.lock() {
                        s.active = false;
                        s.away = false;
                    }
                    release_lockdown(&wd, hwnd);
                }
            });

            // Away watcher: absences the page never sees as blur/visibility — focus stolen, a
            // second monitor plugged in. Report them through the DOM event the off-screen guard
            // already listens for, so the server's three-strike rule applies unchanged.
            let aw = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(1000));
                let state = aw.state::<AppState>();
                if !state.shared.lock().map(|s| s.active).unwrap_or(false) {
                    continue;
                }
                let away_now = !lockdown::foreground_is_ours() || lockdown::monitor_count() > 1;
                let changed = match state.shared.lock() {
                    Ok(mut s) => {
                        if s.away != away_now {
                            s.away = away_now;
                            true
                        } else {
                            false
                        }
                    }
                    Err(_) => false,
                };
                if changed {
                    if let Some(w) = aw.get_webview_window("main") {
                        let js = format!(
                            "window.dispatchEvent(new CustomEvent('mastersat:away',{{detail:{{away:{}}}}}));",
                            if away_now { "true" } else { "false" }
                        );
                        let _ = w.eval(&js);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            lockdown_precheck,
            lockdown_close_app,
            lockdown_enter,
            lockdown_prove,
            lockdown_exit,
            lockdown_heartbeat,
            battery_status,
            auth_begin,
            auth_take_verifier,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running the MasterSAT app");
}
