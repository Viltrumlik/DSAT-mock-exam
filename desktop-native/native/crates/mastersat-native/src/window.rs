//! The exam window: running work on the window's own thread, borderless fullscreen + topmost
//! for a midterm (replacing Tauri's `set_fullscreen` / `set_always_on_top`), keep-awake.
//!
//! Window thread. The header promises that window operations are "marshalled to the window's
//! thread internally". With Flutter 3.47's default (merged platform/UI threads) Dart's FFI calls
//! already run on the window thread, so work runs inline. From any other thread (the watchdog, a
//! background isolate) it is posted to a message-only window that `ms_init` creates on the window
//! thread; the runner's message loop dispatches it there. Same reason as Tauri, which ran these
//! commands on its main thread: `SetWindowDisplayAffinity`, window styles and the
//! `SetThreadExecutionState` flags all belong to that thread.

use std::time::Duration;

/// How long a caller on another thread waits for the window thread before giving up (the work
/// still runs when the window thread gets to it).
pub const MARSHAL_TIMEOUT: Duration = Duration::from_secs(3);

#[cfg(windows)]
pub use imp::*;
#[cfg(not(windows))]
pub use stub::*;

#[cfg(windows)]
mod imp {
    use super::MARSHAL_TIMEOUT;
    use std::ffi::c_void;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::sync::mpsc;
    use std::sync::Mutex;
    use std::time::Duration;

    use windows::core::w;
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, GetWindowLongPtrW, GetWindowPlacement, GetWindowThreadProcessId, IsIconic,
        IsWindow, IsZoomed, PostMessageW, RegisterClassExW, SendMessageW, SetWindowLongPtrW, SetWindowPlacement,
        SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE, HMENU, HWND_MESSAGE, HWND_NOTOPMOST, HWND_TOPMOST,
        SC_RESTORE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_SHOWWINDOW,
        SW_RESTORE, SW_SHOWMINIMIZED, SW_SHOWNORMAL, WINDOWPLACEMENT, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP,
        WM_SYSCOMMAND, WNDCLASSEXW, WS_CAPTION, WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME, WS_EX_STATICEDGE,
        WS_EX_WINDOWEDGE, WS_THICKFRAME,
    };

    fn hwnd(raw: isize) -> HWND {
        HWND(raw as *mut c_void)
    }

    pub fn is_window(raw: isize) -> bool {
        raw != 0 && unsafe { IsWindow(hwnd(raw)).as_bool() }
    }

    /// The thread that owns the window (0 if it is not a window).
    pub fn window_thread(raw: isize) -> u32 {
        unsafe { GetWindowThreadProcessId(hwnd(raw), None) }
    }

    pub fn current_thread() -> u32 {
        unsafe { GetCurrentThreadId() }
    }

    // ── marshalling ────────────────────────────────────────────────────────────────────────

    const WM_MS_RUN: u32 = WM_APP + 0x4D53; // "MS"
    type Job = Box<dyn FnOnce() + Send + 'static>;

    #[derive(Clone, Copy)]
    struct Dispatcher {
        hwnd: isize,
        thread: u32,
    }

    static DISPATCHER: Mutex<Option<Dispatcher>> = Mutex::new(None);

    unsafe extern "system" fn dispatch_proc(h: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if msg == WM_MS_RUN && lparam.0 != 0 {
            let job: Box<Job> = Box::from_raw(lparam.0 as *mut Job);
            // A panic must not unwind through the window procedure (that aborts the process).
            let _ = catch_unwind(AssertUnwindSafe(move || (*job)()));
            return LRESULT(0);
        }
        DefWindowProcW(h, msg, wparam, lparam)
    }

    /// Create the message-only dispatch window on the CURRENT thread, if that is the window's
    /// thread (ms_init's contract). Idempotent per thread. Returns whether a dispatcher exists.
    pub fn install_dispatcher(window_thread: u32) -> bool {
        let mut slot = DISPATCHER.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(d) = *slot {
            if d.thread == window_thread {
                return true;
            }
        }
        if current_thread() != window_thread {
            // Called off the window thread: no dispatcher; window work then runs inline.
            *slot = None;
            return false;
        }
        unsafe {
            let hinstance = match GetModuleHandleW(None) {
                Ok(m) => HINSTANCE(m.0),
                Err(_) => return false,
            };
            let class = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(dispatch_proc),
                hInstance: hinstance,
                lpszClassName: w!("MasterSATNativeDispatch"),
                ..Default::default()
            };
            // 0 also means "already registered" (a second init); CreateWindowExW decides.
            let _ = RegisterClassExW(&class);
            let created = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("MasterSATNativeDispatch"),
                w!(""),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                HMENU::default(),
                hinstance,
                None,
            );
            match created {
                Ok(h) => {
                    *slot = Some(Dispatcher {
                        hwnd: h.0 as isize,
                        thread: window_thread,
                    });
                    true
                }
                Err(_) => {
                    *slot = None;
                    false
                }
            }
        }
    }

    /// Run `f` on the window's thread. Inline when already there (or when there is no
    /// dispatcher); otherwise posted, and — when `wait` is Some — waited for up to that long.
    /// Returns `None` only when the result did not arrive in time (or was not awaited).
    pub fn on_window_thread<R, F>(f: F, wait: Option<Duration>) -> Option<R>
    where
        R: Send + 'static,
        F: FnOnce() -> R + Send + 'static,
    {
        let dispatcher = *DISPATCHER.lock().unwrap_or_else(|p| p.into_inner());
        let d = match dispatcher {
            Some(d) if d.thread != current_thread() => d,
            _ => return Some(f()),
        };
        let (tx, rx) = mpsc::sync_channel::<R>(1);
        let job: Job = Box::new(move || {
            let _ = tx.send(f());
        });
        let raw = Box::into_raw(Box::new(job));
        let posted = unsafe { PostMessageW(hwnd(d.hwnd), WM_MS_RUN, WPARAM(0), LPARAM(raw as isize)) };
        if posted.is_err() {
            // The dispatcher is gone (window destroyed): run it here rather than drop it.
            let job = unsafe { Box::from_raw(raw) };
            (*job)();
            return rx.try_recv().ok();
        }
        match wait {
            Some(t) => rx.recv_timeout(t).ok(),
            None => None,
        }
    }

    /// [`on_window_thread`] with the standard timeout.
    pub fn on_window_thread_wait<R, F>(f: F) -> Option<R>
    where
        R: Send + 'static,
        F: FnOnce() -> R + Send + 'static,
    {
        on_window_thread(f, Some(MARSHAL_TIMEOUT))
    }

    // ── fullscreen ─────────────────────────────────────────────────────────────────────────

    /// What `ms_lock_enter` changed, so `ms_lock_exit` can put it back exactly.
    #[derive(Clone, Copy)]
    pub struct SavedWindow {
        style: isize,
        ex_style: isize,
        placement: WINDOWPLACEMENT,
    }

    // WINDOWPLACEMENT is plain integers (no handles), so it may cross threads.
    unsafe impl Send for SavedWindow {}

    /// Borderless fullscreen on the monitor the window is on, above every other window.
    /// `save` = capture the current placement first (false when re-entering an engaged lock, so
    /// the saved placement stays the pre-lock one).
    pub fn enter_fullscreen(raw: isize, save: bool) -> Result<Option<SavedWindow>, String> {
        let h = hwnd(raw);
        unsafe {
            let saved = if save {
                let mut placement = WINDOWPLACEMENT {
                    length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                    ..Default::default()
                };
                GetWindowPlacement(h, &mut placement).map_err(|e| e.to_string())?;
                Some(SavedWindow {
                    style: GetWindowLongPtrW(h, GWL_STYLE),
                    ex_style: GetWindowLongPtrW(h, GWL_EXSTYLE),
                    placement,
                })
            } else {
                None
            };

            // Leave the minimized / maximized state first, so the borderless rectangle below is
            // not fighting the window manager's own geometry.
            if IsIconic(h).as_bool() {
                let _ = ShowWindow(h, SW_RESTORE);
            }
            if IsZoomed(h).as_bool() {
                SendMessageW(h, WM_SYSCOMMAND, WPARAM(SC_RESTORE as usize), LPARAM(0));
            }

            let style = GetWindowLongPtrW(h, GWL_STYLE);
            SetWindowLongPtrW(h, GWL_STYLE, style & !((WS_CAPTION | WS_THICKFRAME).0 as isize));
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let frame = WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE;
            SetWindowLongPtrW(h, GWL_EXSTYLE, ex & !(frame.0 as isize));

            let monitor = MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return Err("GetMonitorInfoW failed".into());
            }
            let r = info.rcMonitor;
            SetWindowPos(
                h,
                HWND_TOPMOST,
                r.left,
                r.top,
                r.right - r.left,
                r.bottom - r.top,
                SWP_NOOWNERZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
            )
            .map_err(|e| e.to_string())?;
            Ok(saved)
        }
    }

    /// Undo [`enter_fullscreen`]: styles, then not-topmost, then the saved placement (which also
    /// restores a maximized window). Without a saved state it only drops topmost.
    pub fn restore(raw: isize, saved: Option<SavedWindow>) {
        if !is_window(raw) {
            return;
        }
        let h = hwnd(raw);
        unsafe {
            match saved {
                Some(s) => {
                    SetWindowLongPtrW(h, GWL_STYLE, s.style);
                    SetWindowLongPtrW(h, GWL_EXSTYLE, s.ex_style);
                    let _ = SetWindowPos(
                        h,
                        HWND_NOTOPMOST,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
                    );
                    let mut placement = s.placement;
                    if placement.showCmd == SW_SHOWMINIMIZED.0 as u32 {
                        placement.showCmd = SW_SHOWNORMAL.0 as u32;
                    }
                    let _ = SetWindowPlacement(h, &placement);
                }
                None => {
                    let _ = SetWindowPos(
                        h,
                        HWND_NOTOPMOST,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                    );
                }
            }
        }
    }

    // ── power ──────────────────────────────────────────────────────────────────────────────

    /// SetThreadExecutionState on the calling thread (callers marshal to the window thread).
    pub fn set_keep_awake(on: bool) {
        unsafe {
            if on {
                SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
            } else {
                SetThreadExecutionState(ES_CONTINUOUS);
            }
        }
    }
}

#[cfg(not(windows))]
mod stub {
    use std::time::Duration;

    pub fn is_window(_raw: isize) -> bool {
        true
    }
    pub fn window_thread(_raw: isize) -> u32 {
        0
    }
    pub fn current_thread() -> u32 {
        0
    }
    pub fn install_dispatcher(_window_thread: u32) -> bool {
        false
    }
    pub fn on_window_thread<R, F>(f: F, _wait: Option<Duration>) -> Option<R>
    where
        R: Send + 'static,
        F: FnOnce() -> R + Send + 'static,
    {
        Some(f())
    }
    pub fn on_window_thread_wait<R, F>(f: F) -> Option<R>
    where
        R: Send + 'static,
        F: FnOnce() -> R + Send + 'static,
    {
        Some(f())
    }

    /// No window manager to drive on a developer's Mac: the lock is state only.
    #[derive(Clone, Copy, Debug)]
    pub struct SavedWindow;

    pub fn enter_fullscreen(_raw: isize, save: bool) -> Result<Option<SavedWindow>, String> {
        Ok(save.then_some(SavedWindow))
    }
    pub fn restore(_raw: isize, _saved: Option<SavedWindow>) {}
    pub fn set_keep_awake(_on: bool) {}
}
