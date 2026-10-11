//! The library before `ms_init` — its own test binary, so its own process: c_abi.rs initialises
//! the (process-wide) state once, and nothing here may ever see that.
//!
//! The header: ms_lock_enter "Requires ms_init (MS_ERR_NOT_INIT)"; everything that does not need
//! the window (prove's refusal, exit, heartbeat, pkce, precheck) still answers sensibly.

use std::ffi::{c_char, CStr, CString};
use std::ptr::null_mut;

use mastersat_native::*;

fn last_error() -> Option<String> {
    let p = ms_last_error();
    if p.is_null() {
        return None;
    }
    let s = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
    unsafe { ms_free(p) };
    Some(s)
}

fn out_str(f: impl FnOnce(*mut *mut c_char) -> i32) -> (i32, Option<String>) {
    let mut out: *mut c_char = 0x1 as *mut c_char; // garbage: the library must overwrite it
    let code = f(&mut out);
    let s = if out.is_null() {
        None
    } else {
        let s = unsafe { CStr::from_ptr(out) }.to_str().unwrap().to_owned();
        unsafe { ms_free(out) };
        Some(s)
    };
    (code, s)
}

/// One test function: the steps share the process's never-initialised state and must not race.
#[test]
fn before_ms_init() {
    // Locking needs the window: MS_ERR_NOT_INIT, nothing returned, the reason recorded.
    let (code, out) = out_str(|o| unsafe { ms_lock_enter(o) });
    assert_eq!((code, out), (-2, None));
    let e = last_error().expect("an error was recorded");
    assert!(e.starts_with("ms_lock_enter: "), "{e}");
    assert!(e.contains("ms_init"), "{e}");

    // Never locked: heartbeat says so, prove refuses as not locked, exit is a no-op.
    assert_eq!(ms_heartbeat(), 0);
    let nonce = CString::new("nonce-abc").unwrap();
    let (code, out) = out_str(|o| unsafe { ms_prove(42, nonce.as_ptr(), o) });
    assert_eq!((code, out), (-3, None));
    assert_eq!(ms_lock_exit(), 0);
    assert_eq!(ms_heartbeat(), 0);

    // The window-free calls work without ms_init.
    let (code, json) = out_str(|o| unsafe { ms_precheck_json(o) });
    assert_eq!(code, 0, "{:?}", last_error());
    let report: serde_json::Value = serde_json::from_str(&json.unwrap()).unwrap();
    assert!(report["ok"].is_boolean() && report["apps"].is_array());

    let mut v = null_mut();
    let mut c = null_mut();
    assert_eq!(unsafe { ms_pkce_new(&mut v, &mut c) }, 0);
    unsafe {
        ms_free(v);
        ms_free(c);
    }
    assert_eq!(ms_update_progress(), -1);
}
