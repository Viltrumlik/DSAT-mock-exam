//! `ms_close_app`: `lockdown::close_app` (its allow-list, unchanged) plus the header's
//! MS_ERR_NOT_FOUND for a program that is not running — which lockdown.rs reports as success
//! ("already gone"), so whether it was running is looked up here first.

use mastersat_lockdown as lockdown;

use crate::ffi::{MsError, MsResult, MS_ERR_NOT_FOUND};

pub fn close_app(exe: &str) -> MsResult<()> {
    let exe = exe.trim();
    if exe.is_empty() {
        return Err(MsError::arg("exe is empty"));
    }
    let was_running = is_running(exe);
    // The allow-list check lives in lockdown::close_app (Err = not a program the app may close).
    lockdown::close_app(exe).map_err(MsError::arg)?;
    if !was_running {
        return Err(MsError::new(MS_ERR_NOT_FOUND, format!("{exe} is not running")));
    }
    Ok(())
}

/// Whether a process with this image name (case-insensitive) is running.
#[cfg(windows)]
pub fn is_running(exe: &str) -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let target = exe.to_ascii_lowercase();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            // Cannot tell: assume running, so the close is attempted and reported as done.
            return true;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut found = false;
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let end = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                if String::from_utf16_lossy(&entry.szExeFile[..end]).to_ascii_lowercase() == target {
                    found = true;
                    break;
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        found
    }
}

/// A developer's Mac runs none of the blocked Windows programs.
#[cfg(not(windows))]
pub fn is_running(_exe: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffi::MS_ERR_ARG;

    #[test]
    fn an_empty_name_is_an_arg_error() {
        assert_eq!(close_app("  ").unwrap_err().code, MS_ERR_ARG);
    }

    #[cfg(not(windows))]
    #[test]
    fn on_a_development_host_nothing_is_running() {
        assert_eq!(close_app("telegram.exe").unwrap_err().code, MS_ERR_NOT_FOUND);
    }
}
