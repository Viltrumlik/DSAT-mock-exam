//! macOS — the MacBook app's lockdown, through AppKit (Objective-C runtime calls, no crates).
//!
//! The same contract as the Windows module, in macOS terms:
//!   * pre-check: one display, not a virtual machine, no blocked program (matched by bundle id);
//!     the STRICT (midterm) pre-check also lists every other regular app that is running — one
//!     window, one app. Close asks the app to quit (it may ask to save first).
//!   * engage: full screen without a Space of its own — the window loses its title bar and
//!     buttons (no close / minimise / zoom / green full screen) and covers the whole display,
//!     the Dock and the menu bar are hidden and Cmd+Tab is off; it is excluded from screenshots
//!     and screen sharing, and the display stays awake. A window that was in macOS full screen
//!     leaves it first (another Space could be swiped to). Strict also turns off Force Quit,
//!     the Apple menu, logging out and hiding the app, puts the window on every Space, and runs
//!     a foreground guard: any other app that comes to the front (Spotlight, a notification) is
//!     hidden at once and the exam comes back; an app opened during the midterm is asked to quit.
//!     A maintenance tick re-applies all of it, so whatever undid a part is undone at once.
//!   * release: everything back as it was.
//!
//! Only inside the app itself: a process without an NSApplication (`cargo test`) behaves like the
//! portable stub, so the C-ABI tests stay deterministic. AppKit is touched only on the main thread
//! (Flutter on macOS runs Dart there; a release from the watchdog thread is sent to it).

use super::{BatteryStatus, BlockedApp, PrecheckReport};
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, Once};

type Id = *mut c_void;
type Sel = *const c_void;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> Id;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_msgSend();
    #[cfg(target_arch = "x86_64")]
    fn objc_msgSend_stret();
    fn objc_autoreleasePoolPush() -> *mut c_void;
    fn objc_autoreleasePoolPop(pool: *mut c_void);
}

#[link(name = "AppKit", kind = "framework")]
extern "C" {
    static NSApp: Id;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGMainDisplayID() -> u32;
    fn CGDisplayBounds(display: u32) -> Rect;
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(alloc: *const c_void, s: *const c_char, encoding: u32) -> *const c_void;
    fn CFRelease(cf: *const c_void);
}

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOPMAssertionCreateWithName(kind: *const c_void, level: u32, name: *const c_void, id: *mut u32) -> i32;
    fn IOPMAssertionRelease(id: u32) -> i32;
}

extern "C" {
    fn getpid() -> i32;
    fn pthread_main_np() -> i32;
    fn sysctlbyname(name: *const c_char, oldp: *mut c_void, oldlenp: *mut usize, newp: *mut c_void, newlen: usize)
        -> i32;
    static _dispatch_main_q: c_void;
    static _dispatch_source_type_timer: c_void;
    fn dispatch_async_f(queue: *const c_void, context: *mut c_void, work: extern "C" fn(*mut c_void));
    fn dispatch_source_create(kind: *const c_void, handle: usize, mask: usize, queue: *const c_void) -> *mut c_void;
    fn dispatch_source_set_timer(source: *mut c_void, start: u64, interval: u64, leeway: u64);
    fn dispatch_source_set_event_handler_f(source: *mut c_void, handler: extern "C" fn(*mut c_void));
    fn dispatch_resume(object: *mut c_void);
    fn dispatch_time(when: u64, delta: i64) -> u64;
}

// NSApplicationPresentationOptions
const HIDE_DOCK: u64 = 1 << 1;
const HIDE_MENU_BAR: u64 = 1 << 3;
const DISABLE_APPLE_MENU: u64 = 1 << 4;
const DISABLE_PROCESS_SWITCHING: u64 = 1 << 5;
const DISABLE_FORCE_QUIT: u64 = 1 << 6;
const DISABLE_SESSION_TERMINATION: u64 = 1 << 7;
const DISABLE_HIDE_APPLICATION: u64 = 1 << 8;
// NSWindowStyleMask
const STYLE_BORDERLESS: u64 = 0;
const STYLE_CLOSABLE: u64 = 1 << 1;
const STYLE_MINIATURIZABLE: u64 = 1 << 2;
const STYLE_RESIZABLE: u64 = 1 << 3;
const STYLE_FULL_SCREEN: u64 = 1 << 14;
/// NSApplicationPresentationFullScreen: set while a window is in (or animating out of) macOS
/// full screen — the kiosk options are invalid then (AppKit throws).
const OPTION_FULL_SCREEN: u64 = 1 << 10;
/// NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton.
const WINDOW_BUTTONS: [u64; 3] = [0, 1, 2];
/// NSStatusWindowLevel: above every app window and floating panel (pop-up menus, the IME and
/// the system's own alerts still draw above it).
const LOCK_LEVEL: i64 = 25;
// NSWindowCollectionBehavior
const ON_ALL_SPACES: u64 = 1 << 0;
const STATIONARY: u64 = 1 << 4;
const IGNORES_CYCLE: u64 = 1 << 6;
const FULL_SCREEN_NONE: u64 = 1 << 9;
/// NSWindowSharingNone: left out of screenshots, recordings and screen sharing.
const SHARING_NONE: u64 = 0;
/// NSApplicationActivateAllWindows | NSApplicationActivateIgnoringOtherApps
const ACTIVATE_FRONT: u64 = 1 | 2;
const UTF8: u32 = 0x0800_0100;
const GUARD_TICK_NS: u64 = 100_000_000;

/// Programs that could show answers or share the screen, by bundle id (the Windows list's
/// macOS names), plus the system's own Screen Sharing.
const BLOCKED: &[(&str, &str)] = &[
    ("ru.keepcoder.Telegram", "Telegram"),
    ("org.telegram.desktop", "Telegram"),
    ("com.hnc.Discord", "Discord"),
    ("com.tinyspeck.slackmacgap", "Slack"),
    ("com.skype.skype", "Skype"),
    ("us.zoom.xos", "Zoom"),
    ("com.microsoft.teams", "Microsoft Teams"),
    ("com.microsoft.teams2", "Microsoft Teams"),
    ("com.philandro.anydesk", "AnyDesk"),
    ("com.teamviewer.TeamViewer", "TeamViewer"),
    ("tv.parsec.www", "Parsec"),
    ("com.obsproject.obs-studio", "OBS Studio"),
    ("com.apple.ScreenSharing", "Screen Sharing"),
];

/// Apps that are part of macOS and never "another app" (Finder is always running).
const SYSTEM_BUNDLES: &[&str] = &["com.apple.finder", "com.apple.dock", "com.apple.loginwindow"];

static LOCKED: AtomicBool = AtomicBool::new(false);
static STRICT: AtomicBool = AtomicBool::new(false);
static RECLAIMS: AtomicU32 = AtomicU32::new(0);
static AWAKE: AtomicU32 = AtomicU32::new(0);
static KEEP_AWAKE: AtomicU32 = AtomicU32::new(0);
static GUARD_ONCE: Once = Once::new();
/// When the strict lock engaged (seconds since 1970): an app launched after it was opened
/// during the midterm.
static ENGAGED_AT: Mutex<f64> = Mutex::new(0.0);

/// What engage changed, so release can put it back.
struct Saved {
    window: usize,
    options: u64,
    style: u64,
    level: i64,
    sharing: u64,
    collection: u64,
    frame: Rect,
    /// It was in macOS full screen; release sends it back there.
    full_screen: bool,
    /// The window may go borderless (it can still become key — the Flutter window can); a
    /// window that cannot keeps a title bar with its buttons hidden instead.
    borderless: bool,
}
static SAVED: Mutex<Option<Saved>> = Mutex::new(None);
/// When the lock last asked a full-screen window to leave full screen (the animation takes about
/// a second; asking again meanwhile would send it back in).
static LEFT_FULL_SCREEN: Mutex<Option<std::time::Instant>> = Mutex::new(None);

// ── Objective-C plumbing ─────────────────────────────────────────────────────────────────

fn sel(name: &str) -> Sel {
    let c = CString::new(name).expect("selector");
    unsafe { sel_registerName(c.as_ptr()) }
}

fn class(name: &str) -> Id {
    let c = CString::new(name).expect("class");
    unsafe { objc_getClass(c.as_ptr()) }
}

fn msg_send_ptr() -> *const c_void {
    objc_msgSend as unsafe extern "C" fn() as *const c_void
}

unsafe fn msg<R>(obj: Id, name: &str) -> R {
    let f: unsafe extern "C" fn(Id, Sel) -> R = std::mem::transmute(msg_send_ptr());
    f(obj, sel(name))
}

unsafe fn msg1<A, R>(obj: Id, name: &str, a: A) -> R {
    let f: unsafe extern "C" fn(Id, Sel, A) -> R = std::mem::transmute(msg_send_ptr());
    f(obj, sel(name), a)
}

unsafe fn msg2<A, B, R>(obj: Id, name: &str, a: A, b: B) -> R {
    let f: unsafe extern "C" fn(Id, Sel, A, B) -> R = std::mem::transmute(msg_send_ptr());
    f(obj, sel(name), a, b)
}

/// `[window frame]` — a struct return: objc_msgSend_stret on Intel, objc_msgSend on Apple silicon.
unsafe fn frame_of(window: Id) -> Rect {
    #[cfg(target_arch = "x86_64")]
    {
        let f: unsafe extern "C" fn(*mut Rect, Id, Sel) =
            std::mem::transmute(objc_msgSend_stret as unsafe extern "C" fn() as *const c_void);
        let mut r = Rect::default();
        f(&mut r, window, sel("frame"));
        r
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        msg::<Rect>(window, "frame")
    }
}

unsafe fn string(ns: Id) -> String {
    if ns.is_null() {
        return String::new();
    }
    let p: *const c_char = msg(ns, "UTF8String");
    if p.is_null() {
        String::new()
    } else {
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

/// Runs `f` inside an autorelease pool.
fn pooled<R>(f: impl FnOnce() -> R) -> R {
    unsafe {
        let pool = objc_autoreleasePoolPush();
        let r = f();
        objc_autoreleasePoolPop(pool);
        r
    }
}

/// The app has an NSApplication and this is its main thread: AppKit may be used.
fn gui() -> bool {
    unsafe { !NSApp.is_null() && pthread_main_np() != 0 }
}

/// Inside the app at all (any thread) — a test process has no NSApplication.
fn in_app() -> bool {
    unsafe { !NSApp.is_null() }
}

fn main_queue() -> *const c_void {
    unsafe { &_dispatch_main_q as *const c_void }
}

// ── running apps ─────────────────────────────────────────────────────────────────────────

struct Running {
    app: Id,
    bundle: String,
    name: String,
    regular: bool,
}

unsafe fn running_apps() -> Vec<Running> {
    let me = getpid();
    let workspace: Id = msg(class("NSWorkspace"), "sharedWorkspace");
    let list: Id = msg(workspace, "runningApplications");
    let n: usize = msg(list, "count");
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let app: Id = msg1(list, "objectAtIndex:", i);
        let pid: i32 = msg(app, "processIdentifier");
        if pid == me {
            continue;
        }
        let terminated: u8 = msg(app, "isTerminated");
        if terminated != 0 {
            continue;
        }
        let policy: isize = msg(app, "activationPolicy");
        out.push(Running {
            app,
            bundle: string(msg(app, "bundleIdentifier")),
            name: string(msg(app, "localizedName")),
            regular: policy == 0,
        });
    }
    out
}

fn listed_apps(strict: bool) -> Vec<BlockedApp> {
    if !in_app() {
        return Vec::new();
    }
    pooled(|| unsafe {
        let mut found: Vec<BlockedApp> = Vec::new();
        for r in running_apps() {
            if r.bundle.is_empty() || found.iter().any(|a| a.exe == r.bundle) {
                continue;
            }
            let blocked = BLOCKED.iter().find(|(b, _)| *b == r.bundle);
            let other = strict && r.regular && !SYSTEM_BUNDLES.contains(&r.bundle.as_str());
            if blocked.is_some() || other {
                let name = if !r.name.is_empty() {
                    r.name.clone()
                } else {
                    blocked.map(|(_, n)| n.to_string()).unwrap_or_else(|| r.bundle.clone())
                };
                found.push(BlockedApp { exe: r.bundle.clone(), name, closable: true });
            }
        }
        found
    })
}

// ── the public surface (the Windows module's) ────────────────────────────────────────────

pub fn init_keyboard_guard() {}

pub fn monitor_count() -> i32 {
    if !in_app() {
        return 1;
    }
    let mut n: u32 = 0;
    unsafe {
        if CGGetActiveDisplayList(0, std::ptr::null_mut(), &mut n) != 0 {
            return 1;
        }
    }
    (n as i32).max(1)
}

pub fn is_remote() -> bool {
    false
}

fn is_virtual_machine() -> bool {
    if !in_app() {
        return false;
    }
    let name = CString::new("kern.hv_vmm_present").expect("sysctl name");
    let mut value: i32 = 0;
    let mut len = std::mem::size_of::<i32>();
    let rc = unsafe {
        sysctlbyname(name.as_ptr(), &mut value as *mut i32 as *mut c_void, &mut len, std::ptr::null_mut(), 0)
    };
    rc == 0 && value == 1
}

pub fn precheck() -> PrecheckReport {
    precheck_with(false)
}

pub fn precheck_with(strict: bool) -> PrecheckReport {
    let displays = monitor_count();
    let remote = is_remote();
    let vm = is_virtual_machine();
    let apps = listed_apps(strict);
    PrecheckReport { ok: super::is_ok(displays, remote, vm, &apps), displays, remote, vm, apps }
}

pub fn close_app(bundle: &str) -> Result<(), String> {
    if !in_app() {
        return Ok(());
    }
    if SYSTEM_BUNDLES.contains(&bundle) {
        return Err("That program is not one the app may close.".into());
    }
    pooled(|| unsafe {
        for r in running_apps() {
            if r.bundle == bundle {
                let _: u8 = msg(r.app, "terminate");
            }
        }
    });
    // Already gone is success too — the caller only cares that it is not running now.
    Ok(())
}

/// The exam window: the one engage saved, else the app's largest visible window (the Flutter
/// window — not a menu, a tooltip or a WebView pop-up), else the main / key window.
unsafe fn the_window() -> Id {
    if let Some(s) = SAVED.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
        return s.window as Id;
    }
    let windows: Id = msg(NSApp, "windows");
    let n: usize = msg(windows, "count");
    let mut best: Id = std::ptr::null_mut();
    let mut best_area = 0.0;
    for i in 0..n {
        let w: Id = msg1(windows, "objectAtIndex:", i);
        let visible: u8 = msg(w, "isVisible");
        if visible == 0 {
            continue;
        }
        let f = frame_of(w);
        if f.w * f.h > best_area {
            best_area = f.w * f.h;
            best = w;
        }
    }
    if !best.is_null() {
        return best;
    }
    let main: Id = msg(NSApp, "mainWindow");
    if !main.is_null() {
        return main;
    }
    msg(NSApp, "keyWindow")
}

fn desired_options(strict: bool) -> u64 {
    let mut options = HIDE_DOCK | HIDE_MENU_BAR | DISABLE_PROCESS_SWITCHING;
    if strict {
        options |= DISABLE_FORCE_QUIT | DISABLE_SESSION_TERMINATION | DISABLE_HIDE_APPLICATION | DISABLE_APPLE_MENU;
    }
    options
}

/// The style the locked window wears.
fn locked_style(base: u64, strict: bool, borderless: bool) -> u64 {
    if borderless {
        return STYLE_BORDERLESS;
    }
    let mut style = base & !(STYLE_MINIATURIZABLE | STYLE_RESIZABLE | STYLE_FULL_SCREEN);
    if strict {
        style &= !STYLE_CLOSABLE;
    }
    style
}

/// Puts the lock on the window — idempotent, re-run by the maintenance tick, so whatever undid
/// part of it (a Space switch, a relaunched Dock, a minimise) is undone at once.
unsafe fn apply_lock(window: Id, strict: bool) {
    let style: u64 = msg(window, "styleMask");
    let current: u64 = msg(NSApp, "presentationOptions");
    if style & STYLE_FULL_SCREEN != 0 || current & OPTION_FULL_SCREEN != 0 {
        // macOS full screen (a Space of its own, which swiping leaves): out of it first; a later
        // tick, once the animation is over, locks the window.
        if style & STYLE_FULL_SCREEN != 0 {
            let mut left = LEFT_FULL_SCREEN.lock().unwrap_or_else(|p| p.into_inner());
            if left.map_or(true, |t| t.elapsed() > std::time::Duration::from_secs(2)) {
                *left = Some(std::time::Instant::now());
                let _: () = msg1(window, "toggleFullScreen:", std::ptr::null_mut::<c_void>());
            }
        }
        return;
    }
    let miniaturized: u8 = msg(window, "isMiniaturized");
    if miniaturized != 0 {
        let _: () = msg1(window, "deminiaturize:", std::ptr::null_mut::<c_void>());
    }
    if strict {
        let hidden: u8 = msg(NSApp, "isHidden");
        if hidden != 0 {
            let _: () = msg1(NSApp, "unhide:", std::ptr::null_mut::<c_void>());
        }
    }
    let options = desired_options(strict);
    if current != options {
        let _: () = msg1(NSApp, "setPresentationOptions:", options);
    }
    let saved = SAVED.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|s| (s.style, s.collection, s.borderless));
    let (base_style, base_collection, borderless) = saved.unwrap_or((style, msg(window, "collectionBehavior"), false));
    let wanted = locked_style(base_style, strict, borderless);
    if style != wanted {
        let _: () = msg1(window, "setStyleMask:", wanted);
    }
    if !borderless {
        for (button, kind) in WINDOW_BUTTONS.iter().enumerate() {
            let b: Id = msg1(window, "standardWindowButton:", *kind);
            if !b.is_null() {
                let _: () = msg1(b, "setHidden:", (button != 0 || strict) as i8);
            }
        }
    }
    // No macOS full screen of its own; a midterm's window is on every Space and stays put in
    // Mission Control, so swiping to another desktop still shows only the exam.
    let mut collection = (base_collection & !((1 << 7) | (1 << 8))) | FULL_SCREEN_NONE;
    if strict {
        collection |= ON_ALL_SPACES | STATIONARY | IGNORES_CYCLE;
    }
    let current_collection: u64 = msg(window, "collectionBehavior");
    if current_collection != collection {
        let _: () = msg1(window, "setCollectionBehavior:", collection);
    }
    let screen = CGDisplayBounds(CGMainDisplayID());
    let f = frame_of(window);
    let off = (f.x - screen.x).abs() + (f.y - screen.y).abs() + (f.w - screen.w).abs() + (f.h - screen.h).abs();
    if off > 2.0 {
        let _: () = msg2(window, "setFrame:display:", screen, 1i8);
    }
    let sharing: u64 = msg(window, "sharingType");
    if sharing != SHARING_NONE {
        let _: () = msg1(window, "setSharingType:", SHARING_NONE);
    }
    let level: i64 = msg(window, "level");
    if level != LOCK_LEVEL {
        let _: () = msg1(window, "setLevel:", LOCK_LEVEL);
    }
}

fn assertion(kind: &str, slot: &AtomicU32, on: bool) {
    unsafe {
        let old = slot.swap(0, Ordering::SeqCst);
        if old != 0 {
            let _ = IOPMAssertionRelease(old);
        }
        if !on {
            return;
        }
        let kind_c = CString::new(kind).expect("assertion kind");
        let name_c = CString::new("MasterSAT test in progress").expect("assertion name");
        let kind_cf = CFStringCreateWithCString(std::ptr::null(), kind_c.as_ptr(), UTF8);
        let name_cf = CFStringCreateWithCString(std::ptr::null(), name_c.as_ptr(), UTF8);
        let mut id: u32 = 0;
        if !kind_cf.is_null() && !name_cf.is_null() && IOPMAssertionCreateWithName(kind_cf, 255, name_cf, &mut id) == 0
        {
            slot.store(id, Ordering::SeqCst);
        }
        if !kind_cf.is_null() {
            CFRelease(kind_cf);
        }
        if !name_cf.is_null() {
            CFRelease(name_cf);
        }
    }
}

/// The UI's own keep-awake (ms_keep_awake): the display stays on.
pub fn set_keep_awake(on: bool) {
    if in_app() {
        assertion("PreventUserIdleDisplaySleep", &KEEP_AWAKE, on);
    }
}

pub fn engage(hwnd_raw: isize) {
    engage_with(hwnd_raw, false);
}

pub fn engage_with(_hwnd_raw: isize, strict: bool) {
    if !gui() {
        LOCKED.store(true, Ordering::SeqCst);
        STRICT.store(strict, Ordering::SeqCst);
        return;
    }
    pooled(|| unsafe {
        let window = the_window();
        if window.is_null() {
            return;
        }
        let first = SAVED.lock().unwrap_or_else(|p| p.into_inner()).is_none();
        if first {
            let style: u64 = msg(window, "styleMask");
            let options: u64 = msg(NSApp, "presentationOptions");
            let mut saved = Saved {
                window: window as usize,
                // macOS full screen's own options are valid only in full screen (AppKit throws
                // otherwise); release puts the window back there, which sets them again.
                options: if options & OPTION_FULL_SCREEN != 0 { 0 } else { options },
                style: style & !STYLE_FULL_SCREEN,
                level: msg(window, "level"),
                sharing: msg(window, "sharingType"),
                collection: msg(window, "collectionBehavior"),
                frame: frame_of(window),
                full_screen: style & STYLE_FULL_SCREEN != 0,
                borderless: false,
            };
            if !saved.full_screen {
                // Borderless only if the window can still take the keyboard that way (the Flutter
                // window says yes; a plain NSWindow would not).
                let _: () = msg1(window, "setStyleMask:", STYLE_BORDERLESS);
                let key: u8 = msg(window, "canBecomeKeyWindow");
                saved.borderless = key != 0;
                if !saved.borderless {
                    let _: () = msg1(window, "setStyleMask:", saved.style);
                }
            } else {
                // Decided once it is out of full screen (the next ticks), from the window class.
                let key: u8 = msg(window, "canBecomeKeyWindow");
                saved.borderless = key != 0;
            }
            *SAVED.lock().unwrap_or_else(|p| p.into_inner()) = Some(saved);
        }
        if strict {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64());
            *ENGAGED_AT.lock().unwrap_or_else(|p| p.into_inner()) = now;
        }
        apply_lock(window, strict);
        let _: () = msg1(window, "makeKeyAndOrderFront:", std::ptr::null_mut::<c_void>());
        assertion("PreventUserIdleDisplaySleep", &AWAKE, true);
    });
    LOCKED.store(true, Ordering::SeqCst);
    STRICT.store(strict, Ordering::SeqCst);
    start_foreground_guard();
}

extern "C" fn release_on_main(_: *mut c_void) {
    release_now();
}

fn release_now() {
    if !gui() {
        return;
    }
    pooled(|| unsafe {
        let saved = SAVED.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(s) = saved {
            let window = s.window as Id;
            let _: () = msg1(NSApp, "setPresentationOptions:", s.options);
            let _: () = msg1(window, "setCollectionBehavior:", s.collection);
            let style: u64 = msg(window, "styleMask");
            if style & STYLE_FULL_SCREEN == 0 {
                let _: () = msg1(window, "setStyleMask:", s.style);
                let _: () = msg2(window, "setFrame:display:", s.frame, 1i8);
            }
            for kind in WINDOW_BUTTONS {
                let b: Id = msg1(window, "standardWindowButton:", kind);
                if !b.is_null() {
                    let _: () = msg1(b, "setHidden:", 0i8);
                }
            }
            let _: () = msg1(window, "setSharingType:", s.sharing);
            let _: () = msg1(window, "setLevel:", s.level);
            let _: () = msg1(window, "makeKeyAndOrderFront:", std::ptr::null_mut::<c_void>());
            if s.full_screen && style & STYLE_FULL_SCREEN == 0 {
                let _: () = msg1(window, "toggleFullScreen:", std::ptr::null_mut::<c_void>());
            }
        }
        assertion("PreventUserIdleDisplaySleep", &AWAKE, false);
    });
}

pub fn release(_hwnd_raw: isize) {
    LOCKED.store(false, Ordering::SeqCst);
    STRICT.store(false, Ordering::SeqCst);
    if gui() {
        release_now();
    } else if in_app() {
        // The watchdog thread: AppKit belongs to the main thread.
        unsafe { dispatch_async_f(main_queue(), std::ptr::null_mut(), release_on_main) };
    }
}

pub fn battery() -> Option<BatteryStatus> {
    None
}

pub fn foreground_is_ours() -> bool {
    if !in_app() {
        return true;
    }
    pooled(|| unsafe {
        let workspace: Id = msg(class("NSWorkspace"), "sharedWorkspace");
        let front: Id = msg(workspace, "frontmostApplication");
        if front.is_null() {
            return false;
        }
        let pid: i32 = msg(front, "processIdentifier");
        pid == getpid()
    })
}

// ── the strict lock's foreground guard ───────────────────────────────────────────────────

extern "C" fn guard_tick(_: *mut c_void) {
    if !LOCKED.load(Ordering::SeqCst) {
        return;
    }
    let strict = STRICT.load(Ordering::SeqCst);
    pooled(|| unsafe {
        let window = the_window();
        if !window.is_null() {
            apply_lock(window, strict);
        }
        if !strict {
            return;
        }
        let workspace: Id = msg(class("NSWorkspace"), "sharedWorkspace");
        let front: Id = msg(workspace, "frontmostApplication");
        if front.is_null() {
            return;
        }
        let pid: i32 = msg(front, "processIdentifier");
        if pid == getpid() {
            return;
        }
        RECLAIMS.fetch_add(1, Ordering::Relaxed);
        let _: u8 = msg(front, "hide");
        if opened_during_midterm(front) {
            let _: u8 = msg(front, "terminate");
        }
        let me: Id = msg(class("NSRunningApplication"), "currentApplication");
        let _: u8 = msg1(me, "activateWithOptions:", ACTIVATE_FRONT);
        let window = the_window();
        if !window.is_null() {
            let _: () = msg1(window, "makeKeyAndOrderFront:", std::ptr::null_mut::<c_void>());
        }
    });
}

/// A regular app (not part of macOS) launched after the strict lock engaged — the pre-check had
/// every other one closed, so this one was opened during the midterm (from Spotlight, say).
unsafe fn opened_during_midterm(app: Id) -> bool {
    let policy: isize = msg(app, "activationPolicy");
    if policy != 0 || SYSTEM_BUNDLES.contains(&string(msg(app, "bundleIdentifier")).as_str()) {
        return false;
    }
    let launched: Id = msg(app, "launchDate");
    if launched.is_null() {
        return false;
    }
    let at: f64 = msg(launched, "timeIntervalSince1970");
    let engaged = *ENGAGED_AT.lock().unwrap_or_else(|p| p.into_inner());
    engaged > 0.0 && at > engaged
}

/// A 100 ms timer on the main queue (AppKit's thread): keeps any lock in place, and for a strict
/// one brings the exam back to the front. Idle while nothing is locked.
fn start_foreground_guard() {
    GUARD_ONCE.call_once(|| unsafe {
        let source = dispatch_source_create(&_dispatch_source_type_timer as *const c_void, 0, 0, main_queue());
        if source.is_null() {
            return;
        }
        dispatch_source_set_timer(source, dispatch_time(0, 0), GUARD_TICK_NS, GUARD_TICK_NS / 5);
        dispatch_source_set_event_handler_f(source, guard_tick);
        dispatch_resume(source);
    });
}

/// How many times the strict guard took the foreground back (since the app started).
pub fn guard_reclaims() -> u32 {
    RECLAIMS.load(Ordering::Relaxed)
}
