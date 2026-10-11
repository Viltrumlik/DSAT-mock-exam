//! The C boundary: status codes, the thread-local last error, panic containment, and the
//! string / byte-buffer conventions of `mastersat_native.h` ("CONVENTIONS").
//!
//! Every exported function is a thin `boundary(...)` call around safe Rust, so the rules live
//! here once: inputs are borrowed for the call only; outputs are new allocations the caller frees
//! with `ms_free` / `ms_free_bytes`; outputs are NULL (lengths 0) on any error unless a function
//! documents otherwise (`ms_lock_enter`'s failing precheck); a panic never crosses the boundary.

use std::cell::RefCell;
use std::ffi::{c_char, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};

pub const MS_OK: i32 = 0;
pub const MS_ERR_ARG: i32 = -1;
pub const MS_ERR_NOT_INIT: i32 = -2;
pub const MS_ERR_NOT_LOCKED: i32 = -3;
pub const MS_ERR_PRECHECK: i32 = -4;
pub const MS_ERR_CRYPTO: i32 = -5;
pub const MS_ERR_OS: i32 = -6;
pub const MS_ERR_UNSUPPORTED: i32 = -7;
pub const MS_ERR_NO_KEY: i32 = -8;
pub const MS_ERR_NOT_FOUND: i32 = -9;
pub const MS_ERR_BUSY: i32 = -10;
pub const MS_ERR_PANIC: i32 = -99;

/// A failed call: one of the `MS_ERR_*` codes plus the text `ms_last_error` returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MsError {
    pub code: i32,
    pub message: String,
}

impl MsError {
    pub fn new(code: i32, message: impl Into<String>) -> Self {
        MsError {
            code,
            message: message.into(),
        }
    }
    pub fn arg(message: impl Into<String>) -> Self {
        Self::new(MS_ERR_ARG, message)
    }
    pub fn os(message: impl Into<String>) -> Self {
        Self::new(MS_ERR_OS, message)
    }
    pub fn crypto(message: impl Into<String>) -> Self {
        Self::new(MS_ERR_CRYPTO, message)
    }
    pub fn unsupported(what: &str) -> Self {
        Self::new(
            MS_ERR_UNSUPPORTED,
            format!("{what} is only available on Windows"),
        )
    }
}

impl From<std::io::Error> for MsError {
    fn from(e: std::io::Error) -> Self {
        MsError::os(e.to_string())
    }
}

pub type MsResult<T> = Result<T, MsError>;

thread_local! {
    static LAST_ERROR: RefCell<Option<String>> = const { RefCell::new(None) };
}

pub fn set_last_error(message: String) {
    LAST_ERROR.with(|e| *e.borrow_mut() = Some(message));
}

pub fn clear_last_error() {
    LAST_ERROR.with(|e| *e.borrow_mut() = None);
}

/// The calling thread's last error (not cleared by reading — the next call clears it).
pub fn last_error() -> Option<String> {
    LAST_ERROR.with(|e| e.borrow().clone())
}

fn panic_text(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic".to_string()
    }
}

/// Run one exported function's body: clears the thread's last error, maps `Err` to its code
/// (recording the message as `"<function>: <message>"`), and turns a panic into MS_ERR_PANIC.
pub fn boundary<F: FnOnce() -> MsResult<()>>(function: &str, body: F) -> i32 {
    clear_last_error();
    match catch_unwind(AssertUnwindSafe(body)) {
        Ok(Ok(())) => MS_OK,
        Ok(Err(e)) => {
            set_last_error(format!("{function}: {}", e.message));
            e.code
        }
        Err(payload) => {
            set_last_error(format!("{function}: panic: {}", panic_text(payload.as_ref())));
            MS_ERR_PANIC
        }
    }
}

/// The boolean flavour (`ms_heartbeat`, `ms_away_now`): 1/0, never fails; a panic reads as 0.
pub fn boundary_bool<F: FnOnce() -> bool>(function: &str, body: F) -> i32 {
    clear_last_error();
    match catch_unwind(AssertUnwindSafe(body)) {
        Ok(true) => 1,
        Ok(false) => 0,
        Err(payload) => {
            set_last_error(format!("{function}: panic: {}", panic_text(payload.as_ref())));
            0
        }
    }
}

/// A required UTF-8 input string.
///
/// # Safety
/// `ptr` is NULL or a NUL-terminated string valid for the duration of the call.
pub unsafe fn arg_str<'a>(ptr: *const c_char, what: &str) -> MsResult<&'a str> {
    if ptr.is_null() {
        return Err(MsError::arg(format!("{what} is NULL")));
    }
    CStr::from_ptr(ptr)
        .to_str()
        .map_err(|_| MsError::arg(format!("{what} is not valid UTF-8")))
}

/// A required input byte buffer. `(NULL, 0)` is the empty buffer; `(NULL, n > 0)` is an error.
///
/// # Safety
/// `ptr` is NULL or points at `len` readable bytes for the duration of the call.
pub unsafe fn arg_bytes<'a>(ptr: *const u8, len: usize, what: &str) -> MsResult<&'a [u8]> {
    if ptr.is_null() {
        if len == 0 {
            return Ok(&[]);
        }
        return Err(MsError::arg(format!("{what} is NULL")));
    }
    Ok(std::slice::from_raw_parts(ptr, len))
}

/// Set a `char**` output to NULL (when the pointer itself is not NULL).
///
/// # Safety
/// `out` is NULL or valid for one pointer write.
pub unsafe fn clear_out_str(out: *mut *mut c_char) {
    if !out.is_null() {
        *out = std::ptr::null_mut();
    }
}

/// Set a `uint8_t** + size_t*` output pair to NULL / 0.
///
/// # Safety
/// Each pointer is NULL or valid for one write.
pub unsafe fn clear_out_bytes(out: *mut *mut u8, out_len: *mut usize) {
    if !out.is_null() {
        *out = std::ptr::null_mut();
    }
    if !out_len.is_null() {
        *out_len = 0;
    }
}

pub fn require_out<T>(ptr: *mut T, what: &str) -> MsResult<()> {
    if ptr.is_null() {
        Err(MsError::arg(format!("{what} is NULL")))
    } else {
        Ok(())
    }
}

/// A new NUL-terminated copy of `s` for the caller (released with `ms_free`).
pub fn into_c_string(s: String) -> MsResult<*mut c_char> {
    CString::new(s)
        .map(CString::into_raw)
        .map_err(|_| MsError::new(MS_ERR_PANIC, "output contained a NUL byte"))
}

/// Hand `s` to the caller through `out`.
///
/// # Safety
/// `out` is valid for one pointer write (checked non-NULL first).
pub unsafe fn write_str(out: *mut *mut c_char, s: String, what: &str) -> MsResult<()> {
    require_out(out, what)?;
    *out = into_c_string(s)?;
    Ok(())
}

/// Hand `bytes` to the caller through `out` / `out_len` (released with `ms_free_bytes`).
///
/// # Safety
/// Both pointers are valid for one write (checked non-NULL first).
pub unsafe fn write_bytes(out: *mut *mut u8, out_len: *mut usize, bytes: Vec<u8>) -> MsResult<()> {
    require_out(out, "out")?;
    require_out(out_len, "out_len")?;
    let boxed: Box<[u8]> = bytes.into_boxed_slice();
    let len = boxed.len();
    *out = Box::into_raw(boxed) as *mut u8;
    *out_len = len;
    Ok(())
}

/// `ms_free`.
///
/// # Safety
/// `ptr` is NULL or a string this library returned and the caller has not freed.
pub unsafe fn free_c_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(CString::from_raw(ptr));
    }
}

/// `ms_free_bytes`.
///
/// # Safety
/// `ptr` is NULL or a buffer this library returned with exactly this `len`, not yet freed.
pub unsafe fn free_bytes(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundary_maps_ok_err_and_panic() {
        assert_eq!(boundary("f", || Ok(())), MS_OK);
        assert_eq!(last_error(), None);

        assert_eq!(boundary("f", || Err(MsError::arg("bad"))), MS_ERR_ARG);
        assert_eq!(last_error().as_deref(), Some("f: bad"));

        // The next call clears it.
        assert_eq!(boundary("g", || Ok(())), MS_OK);
        assert_eq!(last_error(), None);

        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let code = boundary("p", || panic!("boom"));
        let flag = boundary_bool("q", || panic!("bang"));
        std::panic::set_hook(prev);
        assert_eq!(code, MS_ERR_PANIC);
        assert_eq!(flag, 0);
        assert_eq!(last_error().as_deref(), Some("q: panic: bang"));
    }

    #[test]
    fn strings_and_bytes_round_trip_through_the_allocator() {
        unsafe {
            let mut out: *mut c_char = std::ptr::null_mut();
            write_str(&mut out, "héllo".to_string(), "out").unwrap();
            assert_eq!(CStr::from_ptr(out).to_str().unwrap(), "héllo");
            free_c_string(out);
            free_c_string(std::ptr::null_mut());

            let mut buf: *mut u8 = std::ptr::null_mut();
            let mut len = 0usize;
            write_bytes(&mut buf, &mut len, vec![1, 2, 3]).unwrap();
            assert_eq!(std::slice::from_raw_parts(buf, len), &[1, 2, 3]);
            free_bytes(buf, len);

            // The empty buffer is legal both ways.
            write_bytes(&mut buf, &mut len, Vec::new()).unwrap();
            assert_eq!(len, 0);
            free_bytes(buf, len);
            assert_eq!(arg_bytes(std::ptr::null(), 0, "x").unwrap(), &[] as &[u8]);
            assert_eq!(arg_bytes(std::ptr::null(), 4, "x").unwrap_err().code, MS_ERR_ARG);
        }
    }

    #[test]
    fn invalid_inputs_are_arg_errors() {
        unsafe {
            assert_eq!(arg_str(std::ptr::null(), "s").unwrap_err().code, MS_ERR_ARG);
            let bad = [0xffu8, 0xfe, 0];
            assert_eq!(arg_str(bad.as_ptr() as *const c_char, "s").unwrap_err().code, MS_ERR_ARG);
            assert_eq!(
                write_str(std::ptr::null_mut(), "x".into(), "out").unwrap_err().code,
                MS_ERR_ARG
            );
        }
    }
}
