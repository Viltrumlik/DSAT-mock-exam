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

// ───────────────────────────────── Windows ─────────────────────────────────

#[cfg(windows)]
mod imp {
    use super::{is_ok, BatteryStatus, BlockedApp, PrecheckReport, BLOCKED};
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Once;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
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
        GetCurrentProcessId, OpenProcess, TerminateProcess, PROCESS_TERMINATE,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetForegroundWindow, GetMessageW, GetSystemMetrics, GetWindowThreadProcessId,
        SetWindowDisplayAffinity, SetWindowsHookExW, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, MSG,
        SM_CMONITORS, SM_REMOTESESSION, WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WH_KEYBOARD_LL,
    };

    /// Set while a lockdown is active; the keyboard hook swallows keys only when this is true, so
    /// the hook can be installed once for the app's whole life and never touched again.
    static SWALLOW: AtomicBool = AtomicBool::new(false);
    static HOOK_ONCE: Once = Once::new();

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
            let block = match kb.vkCode {
                0x5B | 0x5C | 0x5D => true, // Left/Right Windows key, Menu key
                0x09 => alt,                // Alt+Tab
                0x1B => alt || ctrl_down(), // Alt+Esc / Ctrl+Esc (Start menu)
                0x73 => alt,                // Alt+F4
                _ => false,
            };
            if block {
                return LRESULT(1);
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    /// Install the hook on a dedicated thread with its own message pump (a low-level hook needs
    /// one). Idempotent; call once at startup.
    pub fn init_keyboard_guard() {
        HOOK_ONCE.call_once(|| {
            std::thread::spawn(|| unsafe {
                let hmod = match GetModuleHandleW(PCWSTR::null()) {
                    Ok(m) => m,
                    Err(_) => return,
                };
                if SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), HINSTANCE(hmod.0), 0)
                    .is_err()
                {
                    return;
                }
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
            });
        });
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

    pub fn close_app(exe: &str) -> Result<(), String> {
        let target = exe.to_ascii_lowercase();
        if !BLOCKED.iter().any(|(e, _, closable)| *e == target && *closable) {
            return Err("That program is not one the app may close.".into());
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
        SWALLOW.store(true, Ordering::Relaxed);
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED);
            let _ = SetWindowDisplayAffinity(hwnd_from(hwnd_raw), WDA_EXCLUDEFROMCAPTURE);
        }
    }

    pub fn release(hwnd_raw: isize) {
        SWALLOW.store(false, Ordering::Relaxed);
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
    pub fn release(_hwnd_raw: isize) {}

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
