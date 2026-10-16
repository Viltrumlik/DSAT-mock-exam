//! The macOS half of the MasterSAT lockdown (the native rewrite ships on Apple Silicon and
//! Intel). It is the AppKit / CoreGraphics / IOKit counterpart of the Win32 block in `lib.rs`,
//! and exposes exactly the same functions: `init_keyboard_guard`, `precheck`, `close_app`,
//! `engage`, `release`, `battery`, `monitor_count`, `is_remote`, `foreground_is_ours`.
//!
//! One for one with Windows:
//!   * `monitor_count`  — `CGGetActiveDisplayList` (a second screen can mirror the exam);
//!   * `is_remote`      — the GUI session is not on the console (screen shared / switched away);
//!   * `is_virtual_machine` — `kern.hv_vmm_present`, or an Apple/VMware/Parallels `hw.model`;
//!   * blocked apps     — `NSWorkspace.runningApplications`, matched by bundle id;
//!   * `close_app`      — `NSRunningApplication.forceTerminate` on a blocked app;
//!   * `battery`        — `IOPSCopyPowerSourcesInfo`;
//!   * `engage`/`release` — AppKit kiosk presentation options (no Dock, no menu bar, no
//!     Cmd-Tab, no force-quit, no log-out), the exam window excluded from screen capture
//!     (`NSWindow.sharingType = .none`), and an IOKit assertion keeping the display awake — the
//!     same guarantees as `SetWindowDisplayAffinity` + the keyboard hook + `SetThreadExecutionState`.
//!
//! The presentation options turn Cmd-Tab, the Dock, the menu bar, force-quit and log-out off at
//! the OS, so there is no separate low-level keyboard hook to install (`init_keyboard_guard` is a
//! no-op). What macOS reserves (Ctrl-Cmd-power) is the counterpart of Windows' Ctrl-Alt-Del, and
//! the server's three-strike off-screen rule covers it.

#![allow(non_upper_case_globals)]

use std::ffi::{c_char, c_int, c_void, CStr};
use std::sync::Mutex;

use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSApplication, NSApplicationPresentationOptions, NSWindow, NSWindowSharingType, NSWorkspace,
};

use super::{is_ok, BatteryStatus, BlockedApp, PrecheckReport};

// ── Programs that can show answers or share the screen, by macOS bundle id ──────────────────
// Matched case-insensitively against each running app's bundleIdentifier. `closable` is always
// true on macOS (every one is a normal app, not a service), so the pre-check offers to quit it.
const BLOCKED: &[(&str, &str)] = &[
    ("org.telegram.desktop", "Telegram"),
    ("ru.keepcoder.telegram", "Telegram"),
    ("com.hnc.discord", "Discord"),
    ("com.tinyspeck.slackmacgap", "Slack"),
    ("com.skype.skype", "Skype"),
    ("us.zoom.xos", "Zoom"),
    ("com.microsoft.teams", "Microsoft Teams"),
    ("com.microsoft.teams2", "Microsoft Teams"),
    ("com.anydesk.anydesk", "AnyDesk"),
    ("com.philandro.anydesk", "AnyDesk"),
    ("com.teamviewer.teamviewer", "TeamViewer"),
    ("com.parsecgaming.parsec", "Parsec"),
    ("com.obsproject.obs-studio", "OBS Studio"),
    ("com.getcloudapp.shotwin", "CloudApp"),
];

// ── Objective-C object APIs (objc2: arch-correct message sends) ─────────────────────────────

pub fn init_keyboard_guard() {
    // Nothing to install: the kiosk presentation options set in `engage` disable Cmd-Tab, the
    // Dock, the menu bar, force-quit and log-out while the exam is on screen.
}

pub fn foreground_is_ours() -> bool {
    // NSApplication must be touched on the main thread; `ms_away_now` is polled from the UI
    // isolate, which runs on the main thread (merged platform/UI threads). Off the main thread
    // we cannot read it, so assume ours rather than falsely report the student "away".
    match MainThreadMarker::new() {
        Some(mtm) => NSApplication::sharedApplication(mtm).isActive(),
        None => true,
    }
}

fn running_blocked_apps() -> Vec<BlockedApp> {
    let mut out: Vec<BlockedApp> = Vec::new();
    #[allow(unused_unsafe)]
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let apps = workspace.runningApplications();
        for i in 0..apps.count() {
            let app = apps.objectAtIndex(i);
            let bundle = match app.bundleIdentifier() {
                Some(id) => id.to_string().to_ascii_lowercase(),
                None => continue,
            };
            if let Some((id, display)) = BLOCKED.iter().find(|(id, _)| *id == bundle) {
                if !out.iter().any(|a| a.name == *display) {
                    out.push(BlockedApp {
                        exe: (*id).to_string(),
                        name: (*display).to_string(),
                        closable: true,
                    });
                }
            }
        }
    }
    out
}

pub fn close_app(exe: &str) -> Result<(), String> {
    let target = exe.to_ascii_lowercase();
    if !BLOCKED.iter().any(|(id, _)| *id == target) {
        return Err("That program is not one the app may close.".into());
    }
    #[allow(unused_unsafe)]
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let apps = workspace.runningApplications();
        for i in 0..apps.count() {
            let app = apps.objectAtIndex(i);
            let bundle = app
                .bundleIdentifier()
                .map(|id| id.to_string().to_ascii_lowercase())
                .unwrap_or_default();
            if bundle == target {
                // forceTerminate, like the NSIS uninstaller kills a running MasterSAT.exe: the
                // student only needs it gone before the exam, not asked politely.
                let _ = app.forceTerminate();
            }
        }
    }
    // Already gone is success too (same as the Windows path).
    Ok(())
}

/// Hide the Dock and menu bar, take over Cmd-Tab / force-quit / log-out, exclude the window from
/// screen capture, and keep the display awake — the kiosk the lockdown needs.
pub fn engage(hwnd_raw: isize) {
    keep_display_awake(true);
    #[allow(unused_unsafe)]
    unsafe {
        if let Some(mtm) = MainThreadMarker::new() {
            NSApplication::sharedApplication(mtm)
                .setPresentationOptions(NSApplicationPresentationOptions::from_bits_retain(KIOSK));
        }
        if let Some(window) = window_ref(hwnd_raw) {
            window.setSharingType(NSWindowSharingType(0)); // NSWindowSharingNone
        }
    }
}

pub fn release(hwnd_raw: isize) {
    #[allow(unused_unsafe)]
    unsafe {
        if let Some(mtm) = MainThreadMarker::new() {
            NSApplication::sharedApplication(mtm)
                .setPresentationOptions(NSApplicationPresentationOptions::empty());
        }
        if let Some(window) = window_ref(hwnd_raw) {
            window.setSharingType(NSWindowSharingType(1)); // NSWindowSharingReadOnly (the default)
        }
    }
    keep_display_awake(false);
}

/// NSApplicationPresentationOptions kiosk mask: HideDock | HideMenuBar | DisableAppleMenu |
/// DisableProcessSwitching | DisableForceQuit | DisableSessionTermination | DisableHideApplication.
///
/// DisableAppleMenu is `1 << 4` (16). It must NOT be `1 << 2` (4, AutoHideMenuBar): AppKit forbids
/// AutoHideMenuBar together with HideMenuBar (`1 << 3`) and `setPresentationOptions:` then raises
/// NSInvalidArgumentException, which aborts the process across the FFI boundary. (Not caught by the
/// tests: off the main thread `MainThreadMarker::new()` is `None`, so `engage` skips this call.)
const KIOSK: usize = (1 << 1) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8);

// Compile-time guard for the constraint the tests cannot reach (they run off the main thread).
// AutoHideMenuBar (1<<2) with HideMenuBar (1<<3) is rejected by AppKit at runtime; HideMenuBar
// requires HideDock (1<<1). Break either rule and the macOS build fails here instead of aborting
// the exam app the moment the lockdown engages.
const _: () = assert!(KIOSK & (1 << 2) == 0, "KIOSK must not set AutoHideMenuBar with HideMenuBar");
const _: () = assert!(KIOSK & (1 << 1) != 0, "KIOSK sets HideMenuBar, which requires HideDock");

#[allow(clippy::not_unsafe_ptr_arg_deref)]
unsafe fn window_ref<'a>(hwnd_raw: isize) -> Option<&'a NSWindow> {
    if hwnd_raw == 0 {
        None
    } else {
        Some(&*(hwnd_raw as *const NSWindow))
    }
}

// ── Plain C frameworks (CoreGraphics / CoreFoundation / IOKit / sysctl) ─────────────────────

#[allow(non_camel_case_types)]
type CFTypeRef = *const c_void;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGGetActiveDisplayList(max_displays: u32, active: *mut u32, display_count: *mut u32) -> i32;
    fn CGSessionCopyCurrentDictionary() -> CFTypeRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: CFTypeRef);
    fn CFStringCreateWithCString(alloc: CFTypeRef, c_str: *const c_char, encoding: u32) -> CFTypeRef;
    fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    fn CFBooleanGetValue(b: CFTypeRef) -> u8;
    fn CFNumberGetValue(num: CFTypeRef, the_type: isize, value_ptr: *mut c_void) -> u8;
    fn CFArrayGetCount(a: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(a: CFTypeRef, idx: isize) -> CFTypeRef;
    fn CFEqual(a: CFTypeRef, b: CFTypeRef) -> u8;
}

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOPSCopyPowerSourcesInfo() -> CFTypeRef;
    fn IOPSCopyPowerSourcesList(blob: CFTypeRef) -> CFTypeRef;
    fn IOPSGetPowerSourceDescription(blob: CFTypeRef, ps: CFTypeRef) -> CFTypeRef;
    fn IOPMAssertionCreateWithName(
        assertion_type: CFTypeRef,
        level: u32,
        name: CFTypeRef,
        id: *mut u32,
    ) -> i32;
    fn IOPMAssertionRelease(id: u32) -> i32;
}

extern "C" {
    fn sysctlbyname(
        name: *const c_char,
        oldp: *mut c_void,
        oldlenp: *mut usize,
        newp: *mut c_void,
        newlen: usize,
    ) -> c_int;
}

const kCFStringEncodingUTF8: u32 = 0x0800_0100;
const kCFNumberSInt32Type: isize = 3;

/// A new CFString from a C string literal; NULL only if creation failed. Release with `cf_release`.
unsafe fn cfstr(s: &CStr) -> CFTypeRef {
    CFStringCreateWithCString(std::ptr::null(), s.as_ptr(), kCFStringEncodingUTF8)
}

unsafe fn cf_release(cf: CFTypeRef) {
    if !cf.is_null() {
        CFRelease(cf);
    }
}

pub fn monitor_count() -> i32 {
    let mut count: u32 = 0;
    let r = unsafe { CGGetActiveDisplayList(0, std::ptr::null_mut(), &mut count) };
    if r != 0 {
        return 1; // cannot tell: never block a real single-screen machine over it
    }
    (count as i32).max(1)
}

pub fn is_remote() -> bool {
    unsafe {
        let dict = CGSessionCopyCurrentDictionary();
        if dict.is_null() {
            return false; // no window-server session to read: benefit of the doubt
        }
        let key = cfstr(c"kCGSSessionOnConsoleKey");
        let value = if key.is_null() {
            std::ptr::null()
        } else {
            CFDictionaryGetValue(dict, key)
        };
        // On the console (a person sitting at the Mac) → not remote. Missing → assume on console.
        let on_console = value.is_null() || CFBooleanGetValue(value) != 0;
        cf_release(key);
        cf_release(dict);
        !on_console
    }
}

fn sysctl_i32(name: &CStr) -> Option<i32> {
    let mut value: i32 = 0;
    let mut len = std::mem::size_of::<i32>();
    let r = unsafe {
        sysctlbyname(
            name.as_ptr(),
            &mut value as *mut i32 as *mut c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if r == 0 {
        Some(value)
    } else {
        None
    }
}

fn sysctl_string(name: &CStr) -> Option<String> {
    unsafe {
        let mut len = 0usize;
        if sysctlbyname(name.as_ptr(), std::ptr::null_mut(), &mut len, std::ptr::null_mut(), 0) != 0
            || len == 0
        {
            return None;
        }
        let mut buf = vec![0u8; len];
        if sysctlbyname(
            name.as_ptr(),
            buf.as_mut_ptr() as *mut c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return None;
        }
        buf.truncate(len);
        while matches!(buf.last(), Some(0)) {
            buf.pop();
        }
        String::from_utf8(buf).ok()
    }
}

fn is_virtual_machine() -> bool {
    if matches!(sysctl_i32(c"kern.hv_vmm_present"), Some(v) if v != 0) {
        return true;
    }
    if let Some(model) = sysctl_string(c"hw.model") {
        let m = model.to_ascii_lowercase();
        return ["virtualmac", "vmware", "parallels", "qemu", "virtualbox"]
            .iter()
            .any(|hint| m.contains(hint));
    }
    false
}

pub fn precheck() -> PrecheckReport {
    let displays = monitor_count();
    let remote = is_remote();
    let vm = is_virtual_machine();
    let apps = running_blocked_apps();
    PrecheckReport {
        ok: is_ok(displays, remote, vm, &apps),
        displays,
        remote,
        vm,
        apps,
    }
}

// ── battery (IOKit power sources) ────────────────────────────────────────────────────────────

unsafe fn dict_value(dict: CFTypeRef, key: &CStr) -> CFTypeRef {
    let k = cfstr(key);
    if k.is_null() {
        return std::ptr::null();
    }
    let v = CFDictionaryGetValue(dict, k); // borrowed; do not release
    cf_release(k);
    v
}

unsafe fn dict_i32(dict: CFTypeRef, key: &CStr) -> Option<i32> {
    let v = dict_value(dict, key);
    if v.is_null() {
        return None;
    }
    let mut out: i32 = 0;
    if CFNumberGetValue(v, kCFNumberSInt32Type, &mut out as *mut i32 as *mut c_void) != 0 {
        Some(out)
    } else {
        None
    }
}

unsafe fn dict_bool(dict: CFTypeRef, key: &CStr) -> Option<bool> {
    let v = dict_value(dict, key);
    if v.is_null() {
        None
    } else {
        Some(CFBooleanGetValue(v) != 0)
    }
}

unsafe fn dict_string_eq(dict: CFTypeRef, key: &CStr, expect: &CStr) -> bool {
    let v = dict_value(dict, key);
    if v.is_null() {
        return false;
    }
    let e = cfstr(expect);
    let eq = !e.is_null() && CFEqual(v, e) != 0;
    cf_release(e);
    eq
}

pub fn battery() -> Option<BatteryStatus> {
    unsafe {
        let info = IOPSCopyPowerSourcesInfo();
        if info.is_null() {
            return None;
        }
        let list = IOPSCopyPowerSourcesList(info);
        if list.is_null() {
            cf_release(info);
            return None;
        }
        let count = CFArrayGetCount(list);
        if count <= 0 {
            cf_release(list);
            cf_release(info);
            // A desktop Mac (Mac mini / Studio / Pro): no battery, always on wall power.
            return Some(BatteryStatus {
                percent: None,
                charging: true,
                has_battery: false,
            });
        }
        let source = CFArrayGetValueAtIndex(list, 0);
        let desc = IOPSGetPowerSourceDescription(info, source); // borrowed; do not release
        let result = if desc.is_null() {
            None
        } else {
            let current = dict_i32(desc, c"Current Capacity");
            let max = dict_i32(desc, c"Max Capacity");
            let is_charging = dict_bool(desc, c"Is Charging").unwrap_or(false);
            let on_ac = dict_string_eq(desc, c"Power Source State", c"AC Power");
            let percent = match (current, max) {
                (Some(c), Some(m)) if m > 0 => Some(((c * 100 + m / 2) / m).clamp(0, 100) as u8),
                _ => None,
            };
            Some(BatteryStatus {
                percent,
                charging: is_charging || on_ac,
                has_battery: true,
            })
        };
        cf_release(list);
        cf_release(info);
        result
    }
}

// ── keep awake (IOKit power assertion) ─────────────────────────────────────────────────────

static POWER_ASSERTION: Mutex<Option<u32>> = Mutex::new(None);
const kIOPMAssertionLevelOn: u32 = 255;

fn keep_display_awake(on: bool) {
    let mut slot = POWER_ASSERTION.lock().unwrap_or_else(|p| p.into_inner());
    if on {
        if slot.is_some() {
            return;
        }
        unsafe {
            let kind = cfstr(c"PreventUserIdleDisplaySleep");
            let name = cfstr(c"MasterSAT exam in progress");
            if !kind.is_null() && !name.is_null() {
                let mut id: u32 = 0;
                if IOPMAssertionCreateWithName(kind, kIOPMAssertionLevelOn, name, &mut id) == 0 {
                    *slot = Some(id);
                }
            }
            cf_release(kind);
            cf_release(name);
        }
    } else if let Some(id) = slot.take() {
        unsafe {
            IOPMAssertionRelease(id);
        }
    }
}
