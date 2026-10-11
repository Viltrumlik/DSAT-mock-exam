//! What only Windows can run: DPAPI through the C ABI, the DPAPI-wrapped data key, WinHTTP's
//! proxy answer, the borderless-fullscreen geometry and its restore, the mastersat:// registry
//! key, and the real pre-check / battery / away readings. `cargo test` on windows-latest (the
//! desktop-native workflow) runs these; on any other host this file compiles to nothing.
//!
//! Its own test binary (own process): it points MASTERSAT_DATA_DIR at a temporary folder before
//! the data key is first loaded, and never calls ms_init (the window tests drive `window::`
//! directly on a window this test thread owns).
#![cfg(windows)]

use std::ffi::{c_char, CStr, CString};
use std::ptr::null_mut;
use std::sync::Once;

use mastersat_native::crypto::{KeyWrap, PlatformWrap};
use mastersat_native::*;

static DATA_DIR: Once = Once::new();

fn data_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("mastersat-native-win-{}", std::process::id()));
    DATA_DIR.call_once(|| std::env::set_var("MASTERSAT_DATA_DIR", &dir));
    dir
}

fn out_str(f: impl FnOnce(*mut *mut c_char) -> i32) -> (i32, Option<String>) {
    let mut out: *mut c_char = null_mut();
    let code = f(&mut out);
    if out.is_null() {
        return (code, None);
    }
    let s = unsafe { CStr::from_ptr(out) }.to_str().unwrap().to_owned();
    unsafe { ms_free(out) };
    (code, Some(s))
}

fn out_bytes(
    f: unsafe extern "C" fn(*const u8, usize, *mut *mut u8, *mut usize) -> i32,
    input: &[u8],
) -> (i32, Option<Vec<u8>>) {
    let mut out: *mut u8 = null_mut();
    let mut len = 0usize;
    let code = unsafe { f(input.as_ptr(), input.len(), &mut out, &mut len) };
    if out.is_null() {
        return (code, None);
    }
    let v = unsafe { std::slice::from_raw_parts(out, len) }.to_vec();
    unsafe { ms_free_bytes(out, len) };
    (code, Some(v))
}

#[test]
fn dpapi_round_trips_through_the_c_abi() {
    let token = b"refresh-token-0123456789";
    let (code, blob) = out_bytes(ms_protect, token);
    assert_eq!(code, 0);
    let blob = blob.unwrap();
    assert!(blob.len() > token.len(), "a DPAPI blob, not the plaintext");
    assert!(
        !blob.windows(token.len()).any(|w| w == token),
        "the token is not visible in the blob"
    );
    assert_eq!(out_bytes(ms_unprotect, &blob), (0, Some(token.to_vec())));

    let mut bad = blob.clone();
    let mid = bad.len() / 2;
    bad[mid] ^= 0x55;
    assert_eq!(
        out_bytes(ms_unprotect, &bad),
        (-5, None),
        "an altered blob is MS_ERR_CRYPTO"
    );
    assert_eq!(out_bytes(ms_unprotect, b"not a blob"), (-5, None));
}

#[test]
fn the_data_key_is_a_dpapi_blob_that_only_the_key_wrapping_opens() {
    let dir = data_dir();
    let (code, sealed) = out_bytes(ms_seal, b"journal entry");
    assert_eq!(code, 0);
    assert_eq!(
        out_bytes(ms_open, &sealed.unwrap()),
        (0, Some(b"journal entry".to_vec()))
    );

    let blob = std::fs::read(dir.join("key.bin")).expect("key.bin created on first seal");
    assert_ne!(blob.len(), 32, "never the raw key on Windows");
    let key = PlatformWrap.unwrap(&blob).expect("the key wrapping opens it");
    assert_eq!(key.len(), 32);
    // A token blob (ms_protect, no entropy) and the key blob (its own entropy) never swap.
    assert_eq!(out_bytes(ms_unprotect, &blob), (-5, None));
}

#[test]
fn the_proxy_answer_is_in_find_proxy_format_and_cached() {
    let url = CString::new("https://mastersat.uz/api/desktop/v1/home").unwrap();
    let (code, first) = out_str(|o| unsafe { ms_proxy_for(url.as_ptr(), o) });
    assert_eq!(code, 0);
    let first = first.unwrap();
    let parts: Vec<&str> = first.split("; ").collect();
    assert_eq!(*parts.last().unwrap(), "DIRECT", "{first}");
    for p in &parts[..parts.len() - 1] {
        assert!(p.starts_with("PROXY ") && p.len() > 6, "{first}");
    }
    let started = std::time::Instant::now();
    let (_, again) = out_str(|o| unsafe { ms_proxy_for(url.as_ptr(), o) });
    assert_eq!(again.as_deref(), Some(first.as_str()));
    assert!(
        started.elapsed() < std::time::Duration::from_millis(200),
        "the second lookup is cached"
    );
}

#[test]
fn readings_parse() {
    let (code, json) = out_str(|o| unsafe { ms_precheck_json(o) });
    assert_eq!(code, 0);
    let report: serde_json::Value = serde_json::from_str(&json.unwrap()).unwrap();
    assert!(report["ok"].is_boolean());
    assert!(report["displays"].as_i64().unwrap() >= 0);
    assert!(report["apps"].is_array());

    let (code, json) = out_str(|o| unsafe { ms_battery_json(o) });
    assert_eq!(code, 0);
    let battery: serde_json::Value = serde_json::from_str(&json.unwrap()).unwrap();
    assert!(battery.is_null() || battery["has_battery"].is_boolean());

    let away = ms_away_now();
    assert!(away == 0 || away == 1);
    assert_eq!(ms_keep_awake(1), 0);
    assert_eq!(ms_keep_awake(0), 0);
}

/// Borderless fullscreen on the window's monitor, topmost — then everything put back.
#[test]
fn fullscreen_covers_the_monitor_and_restore_puts_the_window_back() {
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, GetWindowLongPtrW, GetWindowRect, RegisterClassExW, ShowWindow,
        GWL_EXSTYLE, GWL_STYLE, HMENU, SW_SHOWNORMAL, WINDOW_EX_STYLE, WNDCLASSEXW, WS_CAPTION, WS_EX_TOPMOST,
        WS_OVERLAPPEDWINDOW,
    };

    unsafe extern "system" fn proc_(h: HWND, m: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        DefWindowProcW(h, m, w, l)
    }
    unsafe {
        let hinstance = GetModuleHandleW(None).unwrap();
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(proc_),
            hInstance: hinstance.into(),
            lpszClassName: w!("MasterSATFullscreenTest"),
            ..Default::default()
        };
        RegisterClassExW(&class);
        let h = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("MasterSATFullscreenTest"),
            w!("fullscreen test"),
            WS_OVERLAPPEDWINDOW,
            100,
            100,
            640,
            480,
            None,
            HMENU::default(),
            hinstance,
            None,
        )
        .expect("CreateWindowExW");
        let _ = ShowWindow(h, SW_SHOWNORMAL);
        let raw = h.0 as isize;
        let rect = |h: HWND| {
            let mut r = RECT::default();
            GetWindowRect(h, &mut r).unwrap();
            (r.left, r.top, r.right, r.bottom)
        };
        let before = rect(h);
        let style_before = GetWindowLongPtrW(h, GWL_STYLE);

        let saved = mastersat_native::window::enter_fullscreen(raw, true).expect("enter_fullscreen");
        assert!(saved.is_some(), "the pre-lock placement is saved");
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        assert!(GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mut info).as_bool());
        let m = info.rcMonitor;
        assert_eq!(rect(h), (m.left, m.top, m.right, m.bottom), "covers the whole monitor");
        assert_eq!(GetWindowLongPtrW(h, GWL_STYLE) & WS_CAPTION.0 as isize, 0, "borderless");
        assert_ne!(
            GetWindowLongPtrW(h, GWL_EXSTYLE) & WS_EX_TOPMOST.0 as isize,
            0,
            "topmost"
        );

        mastersat_native::window::restore(raw, saved);
        assert_eq!(rect(h), before, "the placement is back");
        assert_eq!(
            GetWindowLongPtrW(h, GWL_STYLE) & WS_CAPTION.0 as isize,
            style_before & WS_CAPTION.0 as isize
        );
        assert_eq!(
            GetWindowLongPtrW(h, GWL_EXSTYLE) & WS_EX_TOPMOST.0 as isize,
            0,
            "no longer topmost"
        );
        let _ = DestroyWindow(h);
    }
}

/// HKCU\Software\Classes\mastersat — only on a machine where no MasterSAT owns the scheme yet
/// (a CI runner), so a developer's real registration is never overwritten.
#[test]
fn the_scheme_is_written_and_removed() {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if hkcu.open_subkey(mastersat_native::protocol::SCHEME_KEY).is_ok() {
        eprintln!("mastersat:// is already registered on this machine; not touching it");
        return;
    }
    let exe = r"C:\Users\student\AppData\Local\MasterSAT\current\MasterSAT.exe";
    let c = CString::new(exe).unwrap();
    assert_eq!(unsafe { ms_register_protocol(c.as_ptr()) }, 0);
    let key = hkcu.open_subkey(mastersat_native::protocol::SCHEME_KEY).unwrap();
    assert_eq!(key.get_value::<String, _>("URL Protocol").unwrap(), "");
    let command = key.open_subkey(r"shell\open\command").unwrap();
    assert_eq!(command.get_value::<String, _>("").unwrap(), format!("\"{exe}\" \"%1\""));
    let quoted = CString::new("C:\\a\"b.exe").unwrap();
    assert_eq!(
        unsafe { ms_register_protocol(quoted.as_ptr()) },
        -1,
        "a quote would break the command line"
    );
    mastersat_native::protocol::unregister().unwrap();
    assert!(hkcu.open_subkey(mastersat_native::protocol::SCHEME_KEY).is_err());
}
