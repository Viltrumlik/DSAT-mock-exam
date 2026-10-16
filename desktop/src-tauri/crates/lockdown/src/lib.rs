//! What the shell can do that a web page cannot — the "native" half of the lockdown.
//!
//! The real work is Windows-only (midterms are sat on school laptops). Everything Win32 lives in
//! the `#[cfg(windows)]` block; a portable stub keeps the crate compiling — and the proof tests
//! running — on a developer's Mac. The server treats the pre-check as *evidence*, not a verdict:
//! the shell simply refuses to lock down a machine that fails it.
//!
//! What a pre-check looks for, and why:
//!   * more than one display  — a second screen can mirror the exam to someone else;
//!   * a Remote Desktop session — someone else is driving the machine;
//!   * a virtual machine       — the "locked" desktop is a window on an un-locked host;
//!   * a blocked program       — a messenger or screen-share that can leak the questions.
//!
//! When locked, the shell also: swallows Alt+Tab / the Windows key / Alt+F4 / Ctrl+Esc so the
//! student cannot slip to another window, keeps the machine awake, and asks Windows to exclude
//! the window from screen capture. It cannot block Ctrl+Alt+Del (the secure attention sequence is
//! reserved by the OS) — that is what the server's three-strike off-screen rule is for.
//!
//! The STRICT lock (a midterm: one window, one app) adds:
//!   * a pre-check that also lists every other app with a window a student could switch to
//!     (the Alt+Tab list), each closed politely with WM_CLOSE — never killed, it may hold work;
//!   * a foreground guard: whatever takes the foreground (a touchpad gesture, a notification,
//!     a pop-up, an app opened from the taskbar) is minimised and the exam takes the foreground
//!     back at once, and stays on top of every other topmost window;
//!   * a few more keys: Alt+Space (the window menu), PrintScreen, the browser/mail/app keys.
//! A past paper keeps the plain lock.

use serde::Serialize;

/// A program that must be closed before a midterm. `closable` is false for one that runs as a
/// Windows service (we can name it, but the student has to stop it themselves).
#[derive(Debug, Clone, Serialize)]
pub struct BlockedApp {
    pub exe: String,
    pub name: String,
    pub closable: bool,
}

/// The machine, as the shell finds it. `ok` is the single gate `lockdown_enter` reads.
#[derive(Debug, Clone, Serialize)]
pub struct PrecheckReport {
    pub ok: bool,
    pub displays: i32,
    pub remote: bool,
    pub vm: bool,
    pub apps: Vec<BlockedApp>,
}

/// 0–100, or `null` when Windows does not know; `has_battery` is false on a desktop PC.
#[derive(Debug, Clone, Serialize)]
pub struct BatteryStatus {
    pub percent: Option<u8>,
    pub charging: bool,
    pub has_battery: bool,
}

/// Programs that could show answers or share the screen. Matched case-insensitively against the
/// running process image names. Extend by adding a row; the display name is what the pre-check
/// screen shows, and `closable` is whether the shell offers to close it.
const BLOCKED: &[(&str, &str, bool)] = &[
    ("telegram.exe", "Telegram", true),
    ("discord.exe", "Discord", true),
    ("slack.exe", "Slack", true),
    ("skype.exe", "Skype", true),
    ("zoom.exe", "Zoom", true),
    ("ms-teams.exe", "Microsoft Teams", true),
    ("teams.exe", "Microsoft Teams", true),
    ("anydesk.exe", "AnyDesk", true),
    ("teamviewer.exe", "TeamViewer", true),
    ("parsecd.exe", "Parsec", true),
    ("obs64.exe", "OBS Studio", true),
    ("obs32.exe", "OBS Studio", true),
    ("obs.exe", "OBS Studio", true),
    ("sharex.exe", "ShareX", true),
    ("snagiteditor.exe", "Snagit", true),
    ("snagit32.exe", "Snagit", true),
    ("camtasia.exe", "Camtasia", true),
];

/// A reading `ok` is allowed to pass: at most one screen, not remote, not a VM, nothing blocked
/// still running. Shared by both implementations so the rule lives in one place.
fn is_ok(displays: i32, remote: bool, vm: bool, apps: &[BlockedApp]) -> bool {
    displays <= 1 && !remote && !vm && apps.is_empty()
}

/// Window classes that belong to Windows' own shell (taskbar, desktop, Start, Task View, search,
/// notification flyouts). They are never "an app" to close, and the guard never minimises them —
/// taking the foreground back is enough to dismiss them.
const SHELL_CLASSES: &[&str] = &[
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "Progman",
    "WorkerW",
    "Windows.UI.Core.CoreWindow",
    "XamlExplorerHostIslandWindow",
    "MultitaskingViewFrame",
    "TaskListThumbnailWnd",
    "ForegroundStaging",
    "NotifyIconOverflowWindow",
    "TopLevelWindowForOverflowXamlIsland",
    "Shell_InputSwitchTopLevelWindow",
    "#32768",
    "tooltips_class32",
];

/// Processes whose windows are part of Windows itself (input, Start, search, lock screen).
const SYSTEM_EXES: &[&str] = &[
    "textinputhost.exe",
    "searchhost.exe",
    "searchapp.exe",
    "startmenuexperiencehost.exe",
    "shellexperiencehost.exe",
    "lockapp.exe",
    "dwm.exe",
    "csrss.exe",
    "winlogon.exe",
    "logonui.exe",
    "consent.exe",
    "mastersat.exe",
];

/// The name the pre-check shows for a program found by its window, when its file has no
/// description: the image name without ".exe".
fn exe_stem(exe: &str) -> String {
    let stem = exe.strip_suffix(".exe").unwrap_or(exe);
    let mut c = stem.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => exe.to_string(),
    }
}

// ───────────────────────────────── Windows ─────────────────────────────────

#[cfg(windows)]
mod imp {
    use super::{is_ok, BatteryStatus, BlockedApp, PrecheckReport, BLOCKED};
    use super::{exe_stem, SHELL_CLASSES, SYSTEM_EXES};
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
    use std::sync::Once;

    use windows::core::{w, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{BOOL, CloseHandle, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Power::{
        GetSystemPowerStatus, SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED,
        ES_SYSTEM_REQUIRED, SYSTEM_POWER_STATUS,
    };
    use windows::Win32::System::Threading::{
        AttachThreadInput, GetCurrentProcessId, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
        TerminateProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
        VK_MENU,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, EnumWindows, GetClassNameW, GetForegroundWindow, GetMessageW, GetSystemMetrics, GetWindow,
        GetWindowLongPtrW, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
        PeekMessageW, PostMessageW, PostThreadMessageW, SetForegroundWindow, SetTimer, SetWindowDisplayAffinity,
        SetWindowPos, SetWindowsHookExW, ShowWindowAsync, UnhookWindowsHookEx, EVENT_SYSTEM_FOREGROUND,
        EVENT_SYSTEM_MINIMIZESTART, GWL_EXSTYLE, GW_OWNER, HC_ACTION, HHOOK, HWND_TOPMOST, KBDLLHOOKSTRUCT,
        LLKHF_ALTDOWN, MSG, PM_NOREMOVE, SM_CMONITORS, SM_REMOTESESSION, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_MINIMIZE, SW_RESTORE, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
        WH_KEYBOARD_LL, WINEVENT_OUTOFCONTEXT, WM_APP, WM_CLOSE, WM_TIMER, WM_USER, WS_EX_APPWINDOW,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    /// Set while a lockdown is active; the keyboard hook swallows keys only when this is true, so
    /// the hook can be installed once for the app's whole life (and re-installed at each lock).
    static SWALLOW: AtomicBool = AtomicBool::new(false);
    /// Set while a STRICT (midterm) lock is active: more keys, and the foreground guard acts.
    static STRICT: AtomicBool = AtomicBool::new(false);
    /// The exam window the guard keeps in front (0 = none).
    static GUARDED: AtomicIsize = AtomicIsize::new(0);
    /// How many times the guard took the foreground back since the app started (diagnostics).
    static RECLAIMS: AtomicU32 = AtomicU32::new(0);
    static HOOK_ONCE: Once = Once::new();
    static GUARD_ONCE: Once = Once::new();
    /// The keyboard hook's thread, so a lock can ask it to install the hook afresh.
    static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);
    const WM_REINSTALL_HOOK: u32 = WM_APP + 0x4C4B; // "LK"
    /// How often the guard looks even without a WinEvent (a window that pushed itself above).
    const GUARD_TICK_MS: u32 = 400;

    fn hwnd_from(raw: isize) -> HWND {
        HWND(raw as *mut c_void)
    }

    fn ctrl_down() -> bool {
        unsafe { (GetAsyncKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000) != 0 }
    }

    /// The low-level keyboard hook. Returning `LRESULT(1)` eats the keystroke.
    unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && SWALLOW.load(Ordering::Relaxed) {
            let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            let alt = (kb.flags.0 & LLKHF_ALTDOWN.0) != 0;
            let strict = STRICT.load(Ordering::Relaxed);
            let block = match kb.vkCode {
                0x5B | 0x5C | 0x5D => true, // Left/Right Windows key, Menu key
                0x09 => alt,                // Alt+Tab
                0x1B => alt || ctrl_down(), // Alt+Esc / Ctrl+Esc (Start menu) / Ctrl+Shift+Esc
                0x73 => alt,                // Alt+F4
                0x20 => strict && alt,      // Alt+Space: the window menu (Minimize)
                0x2C => strict,             // PrintScreen: opens the Snipping Tool
                // Browser, mail, media-select and launch-app keys open other programs.
                0xA6..=0xAC | 0xB4..=0xB7 => strict,
                _ => false,
            };
            if block {
                return LRESULT(1);
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    unsafe fn install_hook() -> Option<HHOOK> {
        let hmod = GetModuleHandleW(PCWSTR::null()).ok()?;
        SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), HINSTANCE(hmod.0), 0).ok()
    }

    /// Install the hook on a dedicated thread with its own message pump (a low-level hook needs
    /// one). Idempotent; call once at startup.
    pub fn init_keyboard_guard() {
        HOOK_ONCE.call_once(|| {
            std::thread::spawn(|| unsafe {
                let mut msg = MSG::default();
                // Create this thread's message queue before anyone posts to it.
                let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
                HOOK_THREAD.store(GetCurrentThreadId(), Ordering::SeqCst);
                let mut hook = install_hook();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    if msg.message == WM_REINSTALL_HOOK {
                        // Windows silently drops a low-level hook that once took too long (a
                        // slow laptop under load); each lock installs it afresh.
                        if let Some(h) = hook.take() {
                            let _ = UnhookWindowsHookEx(h);
                        }
                        hook = install_hook();
                    }
                }
            });
        });
    }

    fn reinstall_keyboard_hook() {
        let thread = HOOK_THREAD.load(Ordering::SeqCst);
        if thread != 0 {
            unsafe {
                let _ = PostThreadMessageW(thread, WM_REINSTALL_HOOK, WPARAM(0), LPARAM(0));
            }
        }
    }

    // ── the strict lock's foreground guard ───────────────────────────────────────────────

    fn class_name(h: HWND) -> String {
        let mut buf = [0u16; 128];
        let n = unsafe { GetClassNameW(h, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    fn is_shell_window(h: HWND) -> bool {
        let class = class_name(h);
        SHELL_CLASSES.iter().any(|c| *c == class)
    }

    fn pid_of(h: HWND) -> (u32, u32) {
        let mut pid = 0u32;
        let thread = unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        (pid, thread)
    }

    /// One Alt+Tab-style test: a window a student could switch to (visible, not cloaked, not a
    /// tool window or owned pop-up, has a title, not the shell's).
    fn is_switchable(h: HWND) -> bool {
        unsafe {
            if !IsWindowVisible(h).as_bool() || GetWindowTextLengthW(h) == 0 {
                return false;
            }
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            let app_window = ex & WS_EX_APPWINDOW.0 != 0;
            if !app_window {
                if GetWindow(h, GW_OWNER).map(|o| !o.0.is_null()).unwrap_or(false) {
                    return false;
                }
                if ex & (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) != 0 {
                    return false;
                }
            }
            let mut cloaked = 0u32;
            if DwmGetWindowAttribute(
                h,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut c_void,
                std::mem::size_of::<u32>() as u32,
            )
            .is_ok()
                && cloaked != 0
            {
                return false;
            }
        }
        !is_shell_window(h)
    }

    /// The full path of a process's image, or None when Windows will not say.
    fn image_path(pid: u32) -> Option<Vec<u16>> {
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = vec![0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(process);
            ok.ok()?;
            buf.truncate(len as usize);
            Some(buf)
        }
    }

    fn file_name_lower(path: &[u16]) -> String {
        let s = String::from_utf16_lossy(path);
        s.rsplit(['\\', '/']).next().unwrap_or(&s).to_ascii_lowercase()
    }

    /// The file's own description ("Google Chrome", "Microsoft Word"), from its version info.
    fn file_description(path: &[u16]) -> Option<String> {
        let mut z: Vec<u16> = path.to_vec();
        z.push(0);
        unsafe {
            let size = GetFileVersionInfoSizeW(PCWSTR(z.as_ptr()), None);
            if size == 0 {
                return None;
            }
            let mut data = vec![0u8; size as usize];
            GetFileVersionInfoW(PCWSTR(z.as_ptr()), 0, size, data.as_mut_ptr() as *mut c_void).ok()?;
            let mut ptr: *mut c_void = std::ptr::null_mut();
            let mut len = 0u32;
            if !VerQueryValueW(data.as_ptr() as *const c_void, w!("\\VarFileInfo\\Translation"), &mut ptr, &mut len)
                .as_bool()
                || len < 4
                || ptr.is_null()
            {
                return None;
            }
            let lang = *(ptr as *const u16);
            let codepage = *(ptr as *const u16).add(1);
            let key: Vec<u16> = format!("\\StringFileInfo\\{lang:04x}{codepage:04x}\\FileDescription")
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let mut text: *mut c_void = std::ptr::null_mut();
            let mut text_len = 0u32;
            if !VerQueryValueW(data.as_ptr() as *const c_void, PCWSTR(key.as_ptr()), &mut text, &mut text_len).as_bool()
                || text.is_null()
                || text_len <= 1
            {
                return None;
            }
            let chars = std::slice::from_raw_parts(text as *const u16, (text_len - 1) as usize);
            let d = String::from_utf16_lossy(chars).trim().to_string();
            (!d.is_empty()).then_some(d)
        }
    }

    struct Found {
        pid: u32,
        exe: String,
        name: String,
    }

    unsafe extern "system" fn collect_switchable(h: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam.0 as *mut Vec<(HWND, u32)>);
        if is_switchable(h) {
            let (pid, _) = pid_of(h);
            out.push((h, pid));
        }
        BOOL(1)
    }

    fn switchable_windows() -> Vec<(HWND, u32)> {
        let mut out: Vec<(HWND, u32)> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect_switchable), LPARAM(&mut out as *mut _ as isize));
        }
        let me = unsafe { GetCurrentProcessId() };
        out.retain(|(_, pid)| *pid != me && *pid != 0);
        out
    }

    /// Every other program with a window a student could switch to, one row per program.
    fn windowed_apps() -> Vec<Found> {
        let mut found: Vec<Found> = Vec::new();
        for (_, pid) in switchable_windows() {
            if found.iter().any(|f| f.pid == pid) {
                continue;
            }
            let Some(path) = image_path(pid) else { continue };
            let exe = file_name_lower(&path);
            if SYSTEM_EXES.contains(&exe.as_str()) {
                continue;
            }
            let name = if exe == "explorer.exe" {
                "File Explorer".to_string()
            } else {
                file_description(&path).unwrap_or_else(|| exe_stem(&exe))
            };
            found.push(Found { pid, exe, name });
        }
        found
    }

    /// Ask every switchable window of programs with this image name to close (WM_CLOSE).
    /// Returns how many windows were asked.
    fn close_windows_of(exe: &str) -> usize {
        let mut asked = 0;
        for (h, pid) in switchable_windows() {
            let Some(path) = image_path(pid) else { continue };
            if file_name_lower(&path) == exe && !SYSTEM_EXES.contains(&exe) {
                unsafe {
                    if PostMessageW(h, WM_CLOSE, WPARAM(0), LPARAM(0)).is_ok() {
                        asked += 1;
                    }
                }
            }
        }
        asked
    }

    /// Press-and-release Alt as injected input: Windows lets a process take the foreground while
    /// Alt is down (the documented foreground-lock exception for menus).
    unsafe fn alt_tap(up: bool) {
        let input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_MENU,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() },
                    ..Default::default()
                },
            },
        };
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }

    /// Bring the exam back: restore, on top of every topmost window, foreground. Cross-thread
    /// window calls are async so a busy exam thread never stalls the guard.
    unsafe fn take_foreground(ours: HWND, fg_thread: u32) {
        if IsIconic(ours).as_bool() {
            let _ = ShowWindowAsync(ours, SW_RESTORE);
        }
        let _ = SetWindowPos(
            ours,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS,
        );
        if SetForegroundWindow(ours).as_bool() {
            return;
        }
        let me = GetCurrentThreadId();
        let attached = fg_thread != 0 && fg_thread != me && AttachThreadInput(me, fg_thread, true).as_bool();
        let ok = SetForegroundWindow(ours).as_bool();
        if attached {
            let _ = AttachThreadInput(me, fg_thread, false);
        }
        if !ok {
            alt_tap(false);
            let _ = SetForegroundWindow(ours);
            alt_tap(true);
        }
    }

    /// One guard decision: if anything but the exam is in front, minimise it (an app's window;
    /// the shell's own UI just loses the foreground) and take the foreground back.
    fn guard() {
        if !STRICT.load(Ordering::Relaxed) {
            return;
        }
        let ours = hwnd_from(GUARDED.load(Ordering::Relaxed));
        unsafe {
            if ours.0.is_null() || !IsWindow(ours).as_bool() {
                return;
            }
            let fg = GetForegroundWindow();
            let me = GetCurrentProcessId();
            if !fg.0.is_null() {
                let (pid, thread) = pid_of(fg);
                if pid == me {
                    if IsIconic(ours).as_bool() {
                        let _ = ShowWindowAsync(ours, SW_RESTORE);
                    }
                    // Stay above any other always-on-top window.
                    let _ = SetWindowPos(
                        ours,
                        HWND_TOPMOST,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
                    );
                    return;
                }
                RECLAIMS.fetch_add(1, Ordering::Relaxed);
                if !is_shell_window(fg) {
                    let _ = ShowWindowAsync(fg, SW_MINIMIZE);
                }
                take_foreground(ours, thread);
            } else {
                take_foreground(ours, 0);
            }
        }
    }

    unsafe extern "system" fn on_win_event(
        _hook: HWINEVENTHOOK,
        _event: u32,
        _hwnd: HWND,
        id_object: i32,
        _id_child: i32,
        _thread: u32,
        _time: u32,
    ) {
        // OBJID_WINDOW: the event is about a window itself, not a caret or a scroll bar.
        if id_object == 0 {
            guard();
        }
    }

    /// The guard's own thread: WinEvent hooks for "something took the foreground" and "a window
    /// is being minimised", plus a 400 ms timer for anything that slips past them. Idle (one
    /// atomic load per event) unless a strict lock is engaged.
    fn start_foreground_guard() {
        GUARD_ONCE.call_once(|| {
            let _ = std::thread::Builder::new()
                .name("mastersat-foreground-guard".into())
                .spawn(|| unsafe {
                    let mut msg = MSG::default();
                    let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
                    let _fg = SetWinEventHook(
                        EVENT_SYSTEM_FOREGROUND,
                        EVENT_SYSTEM_FOREGROUND,
                        None,
                        Some(on_win_event),
                        0,
                        0,
                        WINEVENT_OUTOFCONTEXT,
                    );
                    let _min = SetWinEventHook(
                        EVENT_SYSTEM_MINIMIZESTART,
                        EVENT_SYSTEM_MINIMIZESTART,
                        None,
                        Some(on_win_event),
                        0,
                        0,
                        WINEVENT_OUTOFCONTEXT,
                    );
                    let _ = SetTimer(None, 0, GUARD_TICK_MS, None);
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        if msg.message == WM_TIMER {
                            guard();
                        }
                    }
                });
        });
    }

    /// How many times the strict guard took the foreground back (since the app started).
    pub fn guard_reclaims() -> u32 {
        RECLAIMS.load(Ordering::Relaxed)
    }

    fn exe_name(buf: &[u16; 260]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    fn running_blocked_apps() -> Vec<BlockedApp> {
        let mut found: Vec<BlockedApp> = Vec::new();
        unsafe {
            let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
                Ok(h) => h,
                Err(_) => return found,
            };
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    let name = exe_name(&entry.szExeFile).to_ascii_lowercase();
                    if let Some((_, display, closable)) =
                        BLOCKED.iter().find(|(exe, _, _)| *exe == name)
                    {
                        if !found.iter().any(|a| a.name == *display) {
                            found.push(BlockedApp {
                                exe: name.clone(),
                                name: (*display).to_string(),
                                closable: *closable,
                            });
                        }
                    }
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);
        }
        found
    }

    /// Best-effort virtual-machine detection from firmware strings. Evidence, not a wall.
    fn is_virtual_machine() -> bool {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        let hints = [
            "vmware",
            "virtualbox",
            "vbox",
            "qemu",
            "kvm",
            "xen",
            "hyper-v",
            "virtual machine",
            "parallels",
            "bochs",
        ];
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(bios) = hklm.open_subkey(r"HARDWARE\DESCRIPTION\System\BIOS") {
            for value in ["SystemManufacturer", "SystemProductName", "BIOSVendor"] {
                if let Ok(s) = bios.get_value::<String, _>(value) {
                    let s = s.to_ascii_lowercase();
                    if hints.iter().any(|h| s.contains(h)) {
                        return true;
                    }
                }
            }
        }
        false
    }

    pub fn monitor_count() -> i32 {
        unsafe { GetSystemMetrics(SM_CMONITORS).max(1) }
    }

    pub fn is_remote() -> bool {
        unsafe { GetSystemMetrics(SM_REMOTESESSION) != 0 }
    }

    pub fn precheck() -> PrecheckReport {
        precheck_with(false)
    }

    /// The pre-check; `strict` (a midterm) also lists every other program with a window.
    pub fn precheck_with(strict: bool) -> PrecheckReport {
        let displays = monitor_count();
        let remote = is_remote();
        let vm = is_virtual_machine();
        let mut apps = running_blocked_apps();
        if strict {
            for f in windowed_apps() {
                if !apps.iter().any(|a| a.exe == f.exe) {
                    apps.push(BlockedApp {
                        exe: f.exe,
                        name: f.name,
                        closable: true,
                    });
                }
            }
        }
        PrecheckReport {
            ok: is_ok(displays, remote, vm, &apps),
            displays,
            remote,
            vm,
            apps,
        }
    }

    pub fn close_app(exe: &str) -> Result<(), String> {
        let target = exe.to_ascii_lowercase();
        if !BLOCKED.iter().any(|(e, _, closable)| *e == target && *closable) {
            // Not a blocked program: one the strict pre-check listed for its window. Ask its
            // windows to close (WM_CLOSE) — never terminate it: it may hold the student's work,
            // and it may ask to save first.
            if SYSTEM_EXES.contains(&target.as_str()) || close_windows_of(&target) == 0 {
                return Err("That program is not one the app may close.".into());
            }
            return Ok(());
        }
        unsafe {
            let snapshot =
                CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).map_err(|e| e.to_string())?;
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    if exe_name(&entry.szExeFile).to_ascii_lowercase() == target {
                        if let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, entry.th32ProcessID)
                        {
                            let _ = TerminateProcess(handle, 1);
                            let _ = CloseHandle(handle);
                        }
                    }
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);
        }
        // Already gone is success too — the caller only cares that it is not running now.
        Ok(())
    }

    pub fn engage(hwnd_raw: isize) {
        engage_with(hwnd_raw, false);
    }

    /// Engage the lock; `strict` (a midterm) adds the extra keys and the foreground guard.
    pub fn engage_with(hwnd_raw: isize, strict: bool) {
        reinstall_keyboard_hook();
        STRICT.store(strict, Ordering::Relaxed);
        GUARDED.store(if strict { hwnd_raw } else { 0 }, Ordering::Relaxed);
        if strict {
            start_foreground_guard();
        }
        SWALLOW.store(true, Ordering::Relaxed);
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED);
            let _ = SetWindowDisplayAffinity(hwnd_from(hwnd_raw), WDA_EXCLUDEFROMCAPTURE);
        }
    }

    pub fn release(hwnd_raw: isize) {
        SWALLOW.store(false, Ordering::Relaxed);
        STRICT.store(false, Ordering::Relaxed);
        GUARDED.store(0, Ordering::Relaxed);
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS);
            let _ = SetWindowDisplayAffinity(hwnd_from(hwnd_raw), WDA_NONE);
        }
    }

    pub fn battery() -> Option<BatteryStatus> {
        let mut status = SYSTEM_POWER_STATUS::default();
        if unsafe { GetSystemPowerStatus(&mut status).is_err() } {
            return None;
        }
        // BatteryFlag bit 0x80 == "no system battery" (a desktop). 255 == unknown.
        let has_battery = status.BatteryFlag != 128 && status.BatteryFlag != 255;
        if !has_battery {
            return Some(BatteryStatus {
                percent: None,
                charging: status.ACLineStatus == 1,
                has_battery: false,
            });
        }
        let percent = if status.BatteryLifePercent <= 100 {
            Some(status.BatteryLifePercent)
        } else {
            None
        };
        Some(BatteryStatus {
            percent,
            charging: status.ACLineStatus == 1,
            has_battery: true,
        })
    }

    pub fn foreground_is_ours() -> bool {
        unsafe {
            let fg: HWND = GetForegroundWindow();
            if fg.0.is_null() {
                return false;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(fg, Some(&mut pid));
            pid == GetCurrentProcessId()
        }
    }
}

// ─────────────────────────────── other hosts ───────────────────────────────
// A developer's Mac and the Linux CI job that runs `cargo test` compile these no-ops. They are
// never shipped — the installer is built on Windows — so they only need to be honest placeholders.

#[cfg(not(windows))]
mod imp {
    use super::{BatteryStatus, PrecheckReport};

    pub fn init_keyboard_guard() {}

    pub fn precheck() -> PrecheckReport {
        precheck_with(false)
    }

    pub fn precheck_with(_strict: bool) -> PrecheckReport {
        PrecheckReport {
            ok: true,
            displays: 1,
            remote: false,
            vm: false,
            apps: Vec::new(),
        }
    }

    pub fn close_app(_exe: &str) -> Result<(), String> {
        Ok(())
    }

    pub fn engage(_hwnd_raw: isize) {}
    pub fn engage_with(_hwnd_raw: isize, _strict: bool) {}
    pub fn release(_hwnd_raw: isize) {}
    pub fn guard_reclaims() -> u32 {
        0
    }

    pub fn battery() -> Option<BatteryStatus> {
        None
    }

    pub fn monitor_count() -> i32 {
        1
    }
    pub fn is_remote() -> bool {
        false
    }
    pub fn foreground_is_ours() -> bool {
        true
    }
}

pub use imp::*;
