//! `mastersat_native.dll` — the native half of the MasterSAT Windows exam app.
//!
//! Every `#[no_mangle] extern "C"` function below is one declaration of
//! `desktop-native/native/include/mastersat_native.h`, which is THE contract (its "CONVENTIONS"
//! block: UTF-8 strings, `ms_free` / `ms_free_bytes`, NULL outputs on error, the thread-local
//! `ms_last_error`, panics caught at the boundary). `tests/header_contract.rs` proves the two
//! never drift: every header function exists here with the same C signature, and nothing else is
//! exported.
//!
//! Each export is a thin wrapper: clear the outputs, run safe Rust inside `ffi::boundary`, write
//! the result. The work lives in the modules:
//!   lock     — ms_init, lock enter/exit, heartbeat + watchdog, away, prove, keep-awake
//!   window   — window-thread marshalling, borderless fullscreen + topmost (Windows)
//!   apps     — ms_close_app
//!   crypto   — ms_seal / ms_open (AES-256-GCM, DPAPI-wrapped data key in key.bin)
//!   dpapi    — ms_protect / ms_unprotect (Windows)
//!   proxy    — ms_proxy_for (WinHTTP, PAC/WPAD, 5-minute cache)
//!   protocol — mastersat:// registration and the 0.1.x uninstall
//!   updates  — Velopack hooks + ms_update_* (feature `updates`)
//!   key      — the embedded DESKTOP_PROOF_KEY
//!
//! The lockdown and the proof are not here: they are `mastersat-lockdown` and `mastersat-proof`
//! (desktop/src-tauri/crates), shared by path with the 0.1.x Tauri shell.

#![allow(clippy::missing_safety_doc)] // the safety contract of every export is the C header

use std::ffi::{c_char, CStr};

pub mod apps;
pub mod crypto;
#[cfg(windows)]
pub mod dpapi;
pub mod ffi;
pub mod key;
pub mod lock;
pub mod protocol;
pub mod proxy;
pub mod updates;
pub mod window;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ffi::*;

/// NUL-terminated crate version for `ms_version` (static: never freed).
static VERSION_C: &str = concat!(env!("CARGO_PKG_VERSION"), "\0");

/// A fresh PKCE pair: 32 CSPRNG bytes as base64url (43 chars), and its S256 challenge.
pub fn pkce_pair() -> MsResult<(String, String)> {
    let bytes: [u8; 32] = crypto::random_bytes()?;
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let challenge = mastersat_proof::pkce_challenge(&verifier);
    Ok((verifier, challenge))
}

// ── Memory + diagnostics ─────────────────────────────────────────────────────────────────────

#[no_mangle]
pub unsafe extern "C" fn ms_free(ptr: *mut c_char) {
    let _ = std::panic::catch_unwind(|| free_c_string(ptr));
}

#[no_mangle]
pub unsafe extern "C" fn ms_free_bytes(ptr: *mut u8, len: usize) {
    let _ = std::panic::catch_unwind(|| free_bytes(ptr, len));
}

#[no_mangle]
pub extern "C" fn ms_version() -> *const c_char {
    VERSION_C.as_ptr() as *const c_char
}

/// Not wrapped in `boundary`: reading the last error must not clear it.
#[no_mangle]
pub extern "C" fn ms_last_error() -> *mut c_char {
    std::panic::catch_unwind(|| match last_error() {
        Some(text) => into_c_string(text.replace('\0', " ")).unwrap_or(std::ptr::null_mut()),
        None => std::ptr::null_mut(),
    })
    .unwrap_or(std::ptr::null_mut())
}

// ── Process start ────────────────────────────────────────────────────────────────────────────

/// argv strings are decoded leniently (lossy UTF-8): the runner converts them from UTF-16 itself,
/// and a stray byte must never stop the app from starting.
#[no_mangle]
pub unsafe extern "C" fn ms_startup(argc: i32, argv: *const *const c_char) -> i32 {
    boundary("ms_startup", || {
        let mut args: Vec<String> = Vec::new();
        if !argv.is_null() && argc > 0 {
            for i in 0..argc as usize {
                let p = *argv.add(i);
                if !p.is_null() {
                    args.push(CStr::from_ptr(p).to_string_lossy().into_owned());
                }
            }
        }
        // Velopack wants the arguments without argv[0].
        let rest = if args.is_empty() {
            std::env::args().skip(1).collect()
        } else {
            args.split_off(1)
        };
        updates::startup(rest);
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn ms_init(hwnd: isize, app_version: *const c_char) -> i32 {
    boundary("ms_init", || {
        let version = arg_str(app_version, "app_version")?;
        lock::init(hwnd, version)
    })
}

#[no_mangle]
pub unsafe extern "C" fn ms_register_protocol(exe_path: *const c_char) -> i32 {
    boundary("ms_register_protocol", || {
        protocol::register(arg_str(exe_path, "exe_path")?)
    })
}

#[no_mangle]
pub unsafe extern "C" fn ms_uninstall_legacy(out_json: *mut *mut c_char) -> i32 {
    clear_out_str(out_json);
    boundary("ms_uninstall_legacy", || {
        require_out(out_json, "out_json")?;
        let outcome = protocol::uninstall_legacy()?;
        let json = serde_json::to_string(&outcome).map_err(|e| MsError::os(e.to_string()))?;
        write_str(out_json, json, "out_json")
    })
}

// ── Lockdown ─────────────────────────────────────────────────────────────────────────────────

#[no_mangle]
pub unsafe extern "C" fn ms_precheck_json(out_json: *mut *mut c_char) -> i32 {
    clear_out_str(out_json);
    boundary("ms_precheck_json", || {
        require_out(out_json, "out_json")?;
        let report = mastersat_lockdown::precheck();
        let json = serde_json::to_string(&report).map_err(|e| MsError::os(e.to_string()))?;
        write_str(out_json, json, "out_json")
    })
}

#[no_mangle]
pub unsafe extern "C" fn ms_close_app(exe: *const c_char) -> i32 {
    boundary("ms_close_app", || apps::close_app(arg_str(exe, "exe")?))
}

/// On MS_ERR_PRECHECK `*out_precheck_json` is the failing report (the one documented exception to
/// "outputs are NULL on error") — still to be freed by the caller.
#[no_mangle]
pub unsafe extern "C" fn ms_lock_enter(out_precheck_json: *mut *mut c_char) -> i32 {
    clear_out_str(out_precheck_json);
    boundary("ms_lock_enter", || {
        require_out(out_precheck_json, "out_precheck_json")?;
        match lock::enter()? {
            lock::EnterOutcome::Locked(json) => write_str(out_precheck_json, json, "out_precheck_json"),
            lock::EnterOutcome::Refused(json) => {
                write_str(out_precheck_json, json, "out_precheck_json")?;
                Err(lock::refused_error())
            }
        }
    })
}

#[no_mangle]
pub extern "C" fn ms_lock_exit() -> i32 {
    boundary("ms_lock_exit", || {
        lock::exit();
        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn ms_heartbeat() -> i32 {
    boundary_bool("ms_heartbeat", lock::heartbeat)
}

#[no_mangle]
pub extern "C" fn ms_away_now() -> i32 {
    boundary_bool("ms_away_now", lock::away_now)
}

#[no_mangle]
pub unsafe extern "C" fn ms_battery_json(out_json: *mut *mut c_char) -> i32 {
    clear_out_str(out_json);
    boundary("ms_battery_json", || {
        require_out(out_json, "out_json")?;
        let battery = mastersat_lockdown::battery();
        let json = serde_json::to_string(&battery).map_err(|e| MsError::os(e.to_string()))?;
        write_str(out_json, json, "out_json")
    })
}

#[no_mangle]
pub unsafe extern "C" fn ms_prove(attempt_id: i64, nonce: *const c_char, out_proof_json: *mut *mut c_char) -> i32 {
    clear_out_str(out_proof_json);
    boundary("ms_prove", || {
        require_out(out_proof_json, "out_proof_json")?;
        let nonce = arg_str(nonce, "nonce")?;
        let json = lock::prove(attempt_id, nonce)?;
        write_str(out_proof_json, json, "out_proof_json")
    })
}

// ── Sign-in ──────────────────────────────────────────────────────────────────────────────────

#[no_mangle]
pub unsafe extern "C" fn ms_pkce_new(out_verifier: *mut *mut c_char, out_challenge: *mut *mut c_char) -> i32 {
    clear_out_str(out_verifier);
    clear_out_str(out_challenge);
    let code = boundary("ms_pkce_new", || {
        require_out(out_verifier, "out_verifier")?;
        require_out(out_challenge, "out_challenge")?;
        let (verifier, challenge) = pkce_pair()?;
        write_str(out_verifier, verifier, "out_verifier")?;
        write_str(out_challenge, challenge, "out_challenge")
    });
    if code != MS_OK {
        // Never hand back half a pair.
        if !out_verifier.is_null() {
            free_c_string(*out_verifier);
        }
        clear_out_str(out_verifier);
        clear_out_str(out_challenge);
    }
    code
}

// ── Data at rest ─────────────────────────────────────────────────────────────────────────────

unsafe fn bytes_call(
    function: &str,
    input: *const u8,
    input_len: usize,
    out: *mut *mut u8,
    out_len: *mut usize,
    op: fn(&[u8]) -> MsResult<Vec<u8>>,
) -> i32 {
    clear_out_bytes(out, out_len);
    boundary(function, || {
        require_out(out, "out")?;
        require_out(out_len, "out_len")?;
        let data = arg_bytes(input, input_len, "input")?;
        write_bytes(out, out_len, op(data)?)
    })
}

#[no_mangle]
pub unsafe extern "C" fn ms_seal(plain: *const u8, plain_len: usize, out: *mut *mut u8, out_len: *mut usize) -> i32 {
    bytes_call("ms_seal", plain, plain_len, out, out_len, crypto::seal)
}

#[no_mangle]
pub unsafe extern "C" fn ms_open(sealed: *const u8, sealed_len: usize, out: *mut *mut u8, out_len: *mut usize) -> i32 {
    bytes_call("ms_open", sealed, sealed_len, out, out_len, crypto::open)
}

#[cfg(windows)]
fn protect_op(data: &[u8]) -> MsResult<Vec<u8>> {
    dpapi::protect(data, None)
}
#[cfg(windows)]
fn unprotect_op(data: &[u8]) -> MsResult<Vec<u8>> {
    dpapi::unprotect(data, None)
}
#[cfg(not(windows))]
fn protect_op(_data: &[u8]) -> MsResult<Vec<u8>> {
    Err(MsError::unsupported("DPAPI (ms_protect)"))
}
#[cfg(not(windows))]
fn unprotect_op(_data: &[u8]) -> MsResult<Vec<u8>> {
    Err(MsError::unsupported("DPAPI (ms_unprotect)"))
}

#[no_mangle]
pub unsafe extern "C" fn ms_protect(plain: *const u8, plain_len: usize, out: *mut *mut u8, out_len: *mut usize) -> i32 {
    bytes_call("ms_protect", plain, plain_len, out, out_len, protect_op)
}

#[no_mangle]
pub unsafe extern "C" fn ms_unprotect(blob: *const u8, blob_len: usize, out: *mut *mut u8, out_len: *mut usize) -> i32 {
    bytes_call("ms_unprotect", blob, blob_len, out, out_len, unprotect_op)
}

// ── Network + power ──────────────────────────────────────────────────────────────────────────

#[no_mangle]
pub unsafe extern "C" fn ms_proxy_for(url: *const c_char, out_proxy: *mut *mut c_char) -> i32 {
    clear_out_str(out_proxy);
    boundary("ms_proxy_for", || {
        require_out(out_proxy, "out_proxy")?;
        let decision = proxy::proxy_for(arg_str(url, "url")?)?;
        write_str(out_proxy, decision, "out_proxy")
    })
}

#[no_mangle]
pub extern "C" fn ms_keep_awake(on: i32) -> i32 {
    boundary("ms_keep_awake", || {
        lock::keep_awake(on != 0);
        Ok(())
    })
}

// ── Updates ──────────────────────────────────────────────────────────────────────────────────

#[no_mangle]
pub unsafe extern "C" fn ms_update_check(feed_url: *const c_char, channel: *const c_char, out_json: *mut *mut c_char) -> i32 {
    clear_out_str(out_json);
    boundary("ms_update_check", || {
        require_out(out_json, "out_json")?;
        let outcome = updates::check(arg_str(feed_url, "feed_url")?, arg_str(channel, "channel")?)?;
        let json = serde_json::to_string(&outcome).map_err(|e| MsError::os(e.to_string()))?;
        write_str(out_json, json, "out_json")
    })
}

#[no_mangle]
pub extern "C" fn ms_update_download() -> i32 {
    boundary("ms_update_download", updates::download)
}

#[no_mangle]
pub extern "C" fn ms_update_progress() -> i32 {
    std::panic::catch_unwind(updates::progress).unwrap_or(updates::IDLE)
}

#[no_mangle]
pub extern "C" fn ms_update_apply_restart() -> i32 {
    boundary("ms_update_apply_restart", updates::apply_restart)
}

/// Serialises the tests (unit and C-ABI) that drive the process-wide lockdown / update state.
#[cfg(test)]
pub(crate) static TEST_GLOBAL_STATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
pub(crate) fn global_state_guard() -> std::sync::MutexGuard<'static, ()> {
    TEST_GLOBAL_STATE.lock().unwrap_or_else(|p| p.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_pairs_are_fresh_rfc7636_s256() {
        let (v1, c1) = pkce_pair().unwrap();
        let (v2, _) = pkce_pair().unwrap();
        assert_eq!(v1.len(), 43);
        assert!(v1.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(v1, v2);
        assert_eq!(c1, mastersat_proof::pkce_challenge(&v1));
        assert_eq!(c1.len(), 43);
    }

    #[test]
    fn the_version_is_a_static_c_string() {
        let v = unsafe { CStr::from_ptr(ms_version()) }.to_str().unwrap();
        assert_eq!(v, env!("CARGO_PKG_VERSION"));
    }
}
