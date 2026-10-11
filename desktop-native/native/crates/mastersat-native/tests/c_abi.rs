//! The library through its C ABI, exactly as Dart (dart:ffi) and the C++ runner call it: raw
//! pointers in, Rust-allocated outputs freed with ms_free / ms_free_bytes, status codes,
//! ms_last_error. Runs on any host; on a developer's Mac it exercises lockdown.rs's stubs.
//!
//! This binary calls ms_init once (app version "0.1.0", the shared vectors' version). The
//! never-initialised behaviour lives in c_abi_uninit.rs (its own process).

use std::ffi::{c_char, CStr, CString};
use std::ptr::{null, null_mut};
use std::sync::{Mutex, MutexGuard, Once};
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use mastersat_native::*;
use sha2::{Digest, Sha256};

const KEY_HEX: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
/// lockdown.rs's non-Windows pre-check, serialised — what ms_lock_enter captures on a dev host.
const STUB_PRECHECK: &str = r#"{"ok":true,"displays":1,"remote":false,"vm":false,"apps":[]}"#;
/// HMAC-SHA256(KEY_HEX, "mastersat-lockdown-v1\n42\nnonce-abc\n0.1.0\n" + STUB_PRECHECK), computed
/// by the SERVER's backend/desktop/proof.py `sign(...)` and cross-checked with
///   printf 'mastersat-lockdown-v1\n42\nnonce-abc\n0.1.0\n<STUB_PRECHECK>' \
///     | openssl dgst -sha256 -mac HMAC -macopt hexkey:<KEY_HEX>
/// The same key, attempt, nonce and version as the shared vector 52b83084… in
/// backend/desktop/tests_desktop.py ProofVectorTests (whose precheck is `{"displays":1}`).
const STUB_PRECHECK_MAC: &str = "cecfe068104a80099c84ae7b2263772237603a08f672fc69337534b0899b5813";
const APP_VERSION: &str = "0.1.0";

/// The lockdown state is process-wide: tests that lock run one at a time.
static SERIAL: Mutex<()> = Mutex::new(());
static INIT: Once = Once::new();

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|p| p.into_inner())
}

fn init() {
    INIT.call_once(|| {
        // Seal/open keep their key under a throwaway folder, never the developer's real one.
        let dir = std::env::temp_dir().join(format!("mastersat-native-abi-{}", std::process::id()));
        std::env::set_var("MASTERSAT_DATA_DIR", &dir);
        assert_eq!(init_with_window(), 0, "{:?}", last_error());
    });
}

/// Development hosts have no window to manage: ms_init(0, …), as the macOS dev bridge does.
#[cfg(not(windows))]
fn init_with_window() -> i32 {
    let v = CString::new(APP_VERSION).unwrap();
    unsafe { ms_init(0, v.as_ptr()) }
}

/// Windows: a real (hidden) top-level window on its own thread with a message loop — the shape of
/// the Flutter runner — and ms_init called on that thread, as the header requires.
#[cfg(windows)]
fn init_with_window() -> i32 {
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassExW, TranslateMessage, HMENU, MSG,
        WINDOW_EX_STYLE, WNDCLASSEXW, WS_OVERLAPPEDWINDOW,
    };
    unsafe extern "system" fn proc_(h: HWND, m: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        DefWindowProcW(h, m, w, l)
    }
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || unsafe {
        let hinstance = GetModuleHandleW(None).unwrap();
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(proc_),
            hInstance: hinstance.into(),
            lpszClassName: w!("MasterSATNativeTest"),
            ..Default::default()
        };
        RegisterClassExW(&class);
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("MasterSATNativeTest"),
            w!("mastersat-native test"),
            WS_OVERLAPPEDWINDOW,
            0,
            0,
            640,
            480,
            None,
            HMENU::default(),
            hinstance,
            None,
        )
        .expect("CreateWindowExW");
        let v = CString::new(APP_VERSION).unwrap();
        tx.send(ms_init(hwnd.0 as isize, v.as_ptr())).unwrap();
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
    rx.recv().unwrap()
}

/// Lock, or — on a Windows machine that fails the pre-check (a CI virtual machine) — None after
/// checking the refusal's shape. Dev hosts always pass (lockdown.rs's stub).
fn lock_or_skip() -> Option<String> {
    let (code, captured) = out_str(|o| unsafe { ms_lock_enter(o) });
    if code == -4 {
        let report: serde_json::Value = serde_json::from_str(captured.as_deref().unwrap()).unwrap();
        assert_eq!(report["ok"], false, "MS_ERR_PRECHECK carries the failing report");
        if cfg!(not(windows)) {
            panic!("only a real machine can fail the pre-check");
        }
        eprintln!("this machine fails the pre-check ({report}); the locked path is not exercised here");
        return None;
    }
    assert_eq!(code, 0, "{:?}", last_error());
    captured
}

fn last_error() -> Option<String> {
    let p = ms_last_error();
    if p.is_null() {
        return None;
    }
    let s = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
    unsafe { ms_free(p) };
    Some(s)
}

/// Take a returned string and free it with ms_free.
fn take(p: *mut c_char) -> String {
    assert!(!p.is_null());
    let s = unsafe { CStr::from_ptr(p) }.to_str().unwrap().to_owned();
    unsafe { ms_free(p) };
    s
}

/// Call a `char** out` function: (status, Some(output) when non-NULL).
fn out_str(f: impl FnOnce(*mut *mut c_char) -> i32) -> (i32, Option<String>) {
    let mut out: *mut c_char = 0x1 as *mut c_char; // garbage: the library must overwrite it
    let code = f(&mut out);
    let s = if out.is_null() { None } else { Some(take(out)) };
    (code, s)
}

/// Call a `uint8_t** out, size_t* out_len` function on `input`.
fn out_bytes(
    f: unsafe extern "C" fn(*const u8, usize, *mut *mut u8, *mut usize) -> i32,
    input: &[u8],
) -> (i32, Option<Vec<u8>>) {
    let mut out: *mut u8 = 0x1 as *mut u8;
    let mut len: usize = 99;
    let code = unsafe { f(input.as_ptr(), input.len(), &mut out, &mut len) };
    if out.is_null() {
        assert_eq!(len, 0, "a NULL output has length 0");
        return (code, None);
    }
    let v = unsafe { std::slice::from_raw_parts(out, len) }.to_vec();
    unsafe { ms_free_bytes(out, len) };
    (code, Some(v))
}

fn hmac_hex(key_hex: &str, message: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(&hex::decode(key_hex).unwrap()).unwrap();
    mac.update(message.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

#[test]
fn version_and_last_error() {
    let v = unsafe { CStr::from_ptr(ms_version()) }.to_str().unwrap();
    assert_eq!(v, env!("CARGO_PKG_VERSION"));

    // A failing call records "<function>: <why>" on this thread; the next call clears it.
    let mut out = null_mut();
    assert_eq!(unsafe { ms_proxy_for(null(), &mut out) }, -1);
    assert!(out.is_null());
    let e = last_error().expect("an error was recorded");
    assert!(e.starts_with("ms_proxy_for: "), "{e}");
    assert_eq!(last_error().as_deref(), Some(e.as_str()), "reading does not clear it");
    let _ = ms_away_now(); // any call clears the thread's last error
    assert_eq!(last_error(), None);

    // Thread-local: another thread sees none of this thread's errors.
    let mut out = null_mut();
    assert_eq!(unsafe { ms_proxy_for(null(), &mut out) }, -1);
    let other = std::thread::spawn(last_error).join().unwrap();
    assert_eq!(other, None);

    unsafe {
        ms_free(null_mut());
        ms_free_bytes(null_mut(), 0);
    }
}

#[test]
fn init_rejects_bad_arguments_but_keeps_the_first_version() {
    init();
    assert_eq!(unsafe { ms_init(0, null()) }, -1);
    let empty = CString::new(" ").unwrap();
    assert_eq!(unsafe { ms_init(0, empty.as_ptr()) }, -1);
    let bad = [0xffu8, 0xfe, 0];
    assert_eq!(unsafe { ms_init(0, bad.as_ptr() as *const c_char) }, -1);
}

#[test]
fn proof_vector_through_the_c_abi() {
    init();
    let _s = serial();
    let nonce = CString::new("nonce-abc").unwrap();

    // Not locked → MS_ERR_NOT_LOCKED, output NULL.
    let (code, out) = out_str(|o| unsafe { ms_prove(42, nonce.as_ptr(), o) });
    assert_eq!((code, out), (-3, None));

    // Lock: the captured pre-check comes back verbatim.
    let Some(captured) = lock_or_skip() else { return };
    if cfg!(not(windows)) {
        assert_eq!(captured, STUB_PRECHECK);
    }
    assert_eq!(ms_heartbeat(), 1);

    let (code, proof) = out_str(|o| unsafe { ms_prove(42, nonce.as_ptr(), o) });
    assert_eq!(code, 0, "{:?}", last_error());
    let proof = proof.unwrap();
    let j: serde_json::Value = serde_json::from_str(&proof).unwrap();
    assert_eq!(j["key_id"], "dev1", "debug builds embed the development key");
    assert_eq!(j["app_version"], APP_VERSION);
    assert_eq!(
        j["precheck"],
        captured.as_str(),
        "signs and returns the captured pre-check"
    );
    if captured == STUB_PRECHECK {
        assert_eq!(j["mac"], STUB_PRECHECK_MAC, "the server's proof.py vector");
    }
    // …and an independent HMAC over the proof message agrees.
    let message = format!("mastersat-lockdown-v1\n42\nnonce-abc\n{APP_VERSION}\n{captured}");
    assert_eq!(j["mac"], hmac_hex(KEY_HEX, &message));
    // Exactly the four fields of the desktop_session body minus `nonce`.
    assert_eq!(j.as_object().unwrap().len(), 4);

    // The shared vector itself (proof.py / openssl / proof crate): same key, same arithmetic.
    assert_eq!(
        hmac_hex(KEY_HEX, "mastersat-lockdown-v1\n42\nnonce-abc\n0.1.0\n{\"displays\":1}"),
        "52b830843519923e56ce8086c59a9c20fe78e41d659bcb2d7bcf6dbd6a3ce18c"
    );

    // Bad nonce argument.
    let mut out = null_mut();
    assert_eq!(unsafe { ms_prove(42, null(), &mut out) }, -1);
    assert!(out.is_null());

    // Exit: unlocked, prove refused again, exit twice is fine.
    assert_eq!(ms_lock_exit(), 0);
    assert_eq!(ms_heartbeat(), 0);
    let (code, out) = out_str(|o| unsafe { ms_prove(42, nonce.as_ptr(), o) });
    assert_eq!((code, out), (-3, None));
    assert_eq!(ms_lock_exit(), 0);
}

/// The real watchdog thread (started by ms_init): 10 s without a heartbeat releases the lock, and
/// heartbeats keep it. ~12 s of wall-clock time.
#[test]
fn the_watchdog_releases_a_silent_lock() {
    init();
    let _s = serial();
    let Some(_) = lock_or_skip() else { return };
    // Heartbeats every 2 s for 6 s keep it locked.
    for _ in 0..3 {
        std::thread::sleep(Duration::from_secs(2));
        assert_eq!(ms_heartbeat(), 1);
    }
    // Then silence: released within 10 s + one 1 s tick.
    std::thread::sleep(Duration::from_millis(11_500));
    assert_eq!(ms_heartbeat(), 0, "the watchdog released the lock");
    let nonce = CString::new("n").unwrap();
    let (code, _) = out_str(|o| unsafe { ms_prove(1, nonce.as_ptr(), o) });
    assert_eq!(code, -3, "a released lock cannot prove");
    assert_eq!(ms_lock_exit(), 0);
}

#[test]
fn pkce_through_the_c_abi() {
    let mut v = null_mut();
    let mut c = null_mut();
    assert_eq!(unsafe { ms_pkce_new(&mut v, &mut c) }, 0);
    let (verifier, challenge) = (take(v), take(c));
    assert_eq!(verifier.len(), 43, "32 random bytes, base64url");
    assert!(verifier
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'));
    // S256, computed independently.
    assert_eq!(challenge, URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())));
    // And the library's S256 is RFC 7636's (appendix B vector).
    assert_eq!(
        mastersat_proof::pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );

    let mut v2 = null_mut();
    let mut c2 = null_mut();
    assert_eq!(unsafe { ms_pkce_new(&mut v2, &mut c2) }, 0);
    assert_ne!(take(v2), verifier, "fresh randomness each call");
    take(c2);

    // A NULL output → MS_ERR_ARG and no half pair.
    let mut v3: *mut c_char = 0x1 as *mut c_char;
    assert_eq!(unsafe { ms_pkce_new(&mut v3, null_mut()) }, -1);
    assert!(v3.is_null());
}

#[test]
fn seal_and_open_round_trip_through_the_c_abi() {
    init();
    for plain in [
        &b""[..],
        b"x",
        "{\"answers\":{\"101\":\"B\"},\"name\":\"Maşa\"}".as_bytes(),
        &[7u8; 70_000][..],
    ] {
        let (code, sealed) = out_bytes(ms_seal, plain);
        assert_eq!(code, 0, "{:?}", last_error());
        let sealed = sealed.unwrap();
        assert_eq!(sealed.len(), 12 + plain.len() + 16, "nonce || ciphertext || tag");
        let (code, opened) = out_bytes(ms_open, &sealed);
        assert_eq!(code, 0);
        assert_eq!(opened.unwrap(), plain);

        // Any altered byte → MS_ERR_CRYPTO and NULL output.
        let mut bad = sealed.clone();
        let last = bad.len() - 1;
        bad[last] ^= 0x80;
        assert_eq!(out_bytes(ms_open, &bad), (-5, None));
    }
    assert_eq!(out_bytes(ms_open, &[1, 2, 3]), (-5, None), "shorter than nonce + tag");

    // The data key lives in MASTERSAT_DATA_DIR/key.bin, created once.
    let dir = std::path::PathBuf::from(std::env::var_os("MASTERSAT_DATA_DIR").unwrap());
    let key = std::fs::read(dir.join("key.bin")).unwrap();
    assert_eq!(key.len(), 32, "dev hosts store the raw key (Windows: a DPAPI blob)");

    // Argument errors.
    let mut out = null_mut();
    let mut len = 0usize;
    assert_eq!(unsafe { ms_seal(null(), 5, &mut out, &mut len) }, -1);
    assert_eq!(unsafe { ms_seal(b"x".as_ptr(), 1, null_mut(), &mut len) }, -1);
    assert_eq!(unsafe { ms_seal(b"x".as_ptr(), 1, &mut out, null_mut()) }, -1);
    assert!(out.is_null());
}

#[cfg(not(windows))]
#[test]
fn development_host_stubs_behave() {
    init();
    // DPAPI is Windows-only.
    assert_eq!(out_bytes(ms_protect, b"token"), (-7, None));
    assert_eq!(out_bytes(ms_unprotect, b"blob"), (-7, None));

    // lockdown.rs's stubs, serialised.
    assert_eq!(
        out_str(|o| unsafe { ms_precheck_json(o) }),
        (0, Some(STUB_PRECHECK.to_string()))
    );
    assert_eq!(
        out_str(|o| unsafe { ms_battery_json(o) }),
        (0, Some("null".to_string()))
    );
    assert_eq!(ms_away_now(), 0);
    assert_eq!(ms_keep_awake(1), 0);
    assert_eq!(ms_keep_awake(0), 0);

    let url = CString::new("https://mastersat.uz/api/desktop/v1/home").unwrap();
    assert_eq!(
        out_str(|o| unsafe { ms_proxy_for(url.as_ptr(), o) }),
        (0, Some("DIRECT".to_string()))
    );
    let bad = CString::new("not a url").unwrap();
    assert_eq!(out_str(|o| unsafe { ms_proxy_for(bad.as_ptr(), o) }), (-1, None));

    let tg = CString::new("telegram.exe").unwrap();
    assert_eq!(unsafe { ms_close_app(tg.as_ptr()) }, -9, "nothing runs on a dev host");
    assert_eq!(unsafe { ms_close_app(null()) }, -1);

    let exe = CString::new("/Applications/MasterSAT.app").unwrap();
    assert_eq!(unsafe { ms_register_protocol(exe.as_ptr()) }, -7);
    assert_eq!(
        out_str(|o| unsafe { ms_uninstall_legacy(o) }),
        (0, Some(r#"{"found":false,"ran":false,"exit_code":null}"#.to_string()))
    );

    let argv0 = CString::new("/x/MasterSAT").unwrap();
    let argv1 = CString::new("--flag").unwrap();
    let argv = [argv0.as_ptr(), argv1.as_ptr()];
    assert_eq!(unsafe { ms_startup(2, argv.as_ptr()) }, 0);
    assert_eq!(unsafe { ms_startup(0, null()) }, 0);
}

#[test]
fn updates_outside_an_installed_copy() {
    init();
    let _s = serial();
    assert_eq!(ms_update_progress(), -1);
    let feed = CString::new("http://127.0.0.1:9/downloads/desktop/").unwrap();
    let channel = CString::new("stable").unwrap();
    let (code, out) = out_str(|o| unsafe { ms_update_check(feed.as_ptr(), channel.as_ptr(), o) });
    assert_eq!(
        (code, out),
        (-7, None),
        "not a Velopack install (or no updater): unsupported"
    );
    let evil = CString::new("../x").unwrap();
    let (code, _) = out_str(|o| unsafe { ms_update_check(feed.as_ptr(), evil.as_ptr(), o) });
    assert_eq!(code, -1);
    let code = ms_update_download();
    assert!(code == -9 || code == -7, "nothing found to download: {code}");
    assert_eq!(ms_update_progress(), -1);
    let code = ms_update_apply_restart();
    assert!(
        code == -9 || code == -7,
        "nothing to apply (and the test process lives on): {code}"
    );
}
