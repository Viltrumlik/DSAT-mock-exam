//! `mastersat://` registration (`ms_register_protocol`, the Velopack hooks in `ms_startup`) and
//! the move off the 0.1.x Tauri/NSIS install (`ms_uninstall_legacy`). Architecture §6.
//!
//! The scheme lives in HKCU\Software\Classes\mastersat — per user, no UAC — exactly where the
//! Tauri deep-link plugin put it, so either app can own it. The new app rewrites it on every
//! launch (self-repair), writes it in the install/update hooks and removes it before uninstall.

use serde::Serialize;

use crate::ffi::{MsError, MsResult};

/// HKCU-relative key of the URL scheme.
pub const SCHEME_KEY: &str = r"Software\Classes\mastersat";
/// HKCU-relative parent of the per-user uninstall entries (where Tauri's NSIS wrote 0.1.x's).
pub const UNINSTALL_ROOT: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
/// The 0.1.x installer's DisplayName (tauri.conf.json productName).
pub const LEGACY_DISPLAY_NAME: &str = "MasterSAT";
/// The 0.1.x app's executable (Tauri names it after productName). Its NSIS uninstaller, even with
/// /S, first KILLS every running process of this name for the current user
/// (nsis_tauri_utils::KillProcessCurrentUser in Tauri's CheckIfAppIsRunning macro).
pub const LEGACY_EXE_NAME: &str = "MasterSAT.exe";
/// How long `ms_uninstall_legacy` waits for the old uninstaller.
pub const LEGACY_TIMEOUT_SECS: u64 = 60;

/// `shell\open\command`'s default value: the exe, quoted, then the URL as one quoted argument.
pub fn open_command(exe_path: &str) -> String {
    format!("\"{exe_path}\" \"%1\"")
}

fn check_exe_path(exe_path: &str) -> MsResult<&str> {
    let exe = exe_path.trim();
    if exe.is_empty() {
        return Err(MsError::arg("exe_path is empty"));
    }
    if exe.contains('"') {
        return Err(MsError::arg("exe_path contains a quote"));
    }
    Ok(exe)
}

/// One HKCU uninstall entry, as read from the registry.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UninstallEntry {
    pub key: String,
    pub display_name: String,
    pub uninstall_string: String,
    pub quiet_uninstall_string: String,
}

/// The legacy uninstaller to run: the NSIS `uninstall.exe` and the folder it uninstalls.
/// Windows paths as strings — the selection is pure string work, so it is tested on any host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyTarget {
    pub uninstaller: String,
    pub install_dir: String,
}

/// The executable path at the start of an uninstall command line (`"C:\x\uninstall.exe" /S`).
fn command_exe(command: &str) -> Option<String> {
    let c = command.trim();
    if let Some(rest) = c.strip_prefix('"') {
        let end = rest.find('"')?;
        return Some(rest[..end].to_string()).filter(|s| !s.is_empty());
    }
    // Unquoted: up to ".exe" (paths may contain spaces), else up to the first space.
    let lower = c.to_ascii_lowercase();
    if let Some(i) = lower.find(".exe") {
        return Some(c[..i + 4].to_string());
    }
    c.split_whitespace().next().map(str::to_string)
}

/// `(folder, file name)` of a Windows path (either separator).
fn split_path(path: &str) -> (&str, &str) {
    match path.rfind(['\\', '/']) {
        Some(i) => (&path[..i], &path[i + 1..]),
        None => ("", path),
    }
}

/// Pick the 0.1.x install among the uninstall entries. Only an NSIS `uninstall.exe` whose
/// DisplayName is "MasterSAT" qualifies, and NEVER one that lives where the running app lives —
/// the Velopack install has its own HKCU entry (possibly with the same display name) whose
/// uninstaller is `Update.exe`, and running it would uninstall the app that is asking.
pub fn pick_legacy(entries: &[UninstallEntry], current_exe: Option<&str>) -> Option<LegacyTarget> {
    let current_dir = current_exe.map(|p| split_path(p).0.to_ascii_lowercase().replace('/', "\\"));
    entries.iter().find_map(|e| {
        if !e.display_name.trim().eq_ignore_ascii_case(LEGACY_DISPLAY_NAME) {
            return None;
        }
        let command = if e.uninstall_string.trim().is_empty() {
            &e.quiet_uninstall_string
        } else {
            &e.uninstall_string
        };
        let uninstaller = command_exe(command)?;
        let (dir, file) = split_path(&uninstaller);
        if !file.eq_ignore_ascii_case("uninstall.exe") || dir.is_empty() {
            return None;
        }
        if let Some(cur) = &current_dir {
            let d = dir.to_ascii_lowercase().replace('/', "\\");
            let d = d.trim_end_matches('\\');
            if cur == d || cur.starts_with(&format!("{d}\\")) {
                return None;
            }
        }
        Some(LegacyTarget {
            install_dir: dir.to_string(),
            uninstaller,
        })
    })
}

/// Whether running the 0.1.x uninstaller would kill the app that runs it: true when this exe has
/// the legacy exe's name (see [`LEGACY_EXE_NAME`]). Then `ms_uninstall_legacy` refuses.
pub fn legacy_uninstaller_would_kill(current_exe: &str) -> bool {
    split_path(current_exe).1.eq_ignore_ascii_case(LEGACY_EXE_NAME)
}

/// The `ms_uninstall_legacy` JSON.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LegacyOutcome {
    pub found: bool,
    pub ran: bool,
    pub exit_code: Option<i32>,
}

impl LegacyOutcome {
    pub fn not_found() -> Self {
        LegacyOutcome {
            found: false,
            ran: false,
            exit_code: None,
        }
    }
}

pub use imp::{register, uninstall_legacy, unregister};

#[cfg(windows)]
mod imp {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use std::time::{Duration, Instant};

    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    /// CREATE_NO_WINDOW: the uninstaller is silent; no console flash either.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    pub fn register(exe_path: &str) -> MsResult<()> {
        let exe = check_exe_path(exe_path)?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let os = |e: std::io::Error| MsError::os(format!("cannot write HKCU\\{SCHEME_KEY}: {e}"));
        let (key, _) = hkcu.create_subkey(SCHEME_KEY).map_err(os)?;
        key.set_value("", &"URL:MasterSAT").map_err(os)?;
        key.set_value("URL Protocol", &"").map_err(os)?;
        let (icon, _) = key.create_subkey("DefaultIcon").map_err(os)?;
        icon.set_value("", &format!("\"{exe}\",0")).map_err(os)?;
        let (command, _) = key.create_subkey(r"shell\open\command").map_err(os)?;
        command.set_value("", &open_command(exe)).map_err(os)?;
        Ok(())
    }

    pub fn unregister() -> MsResult<()> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        match hkcu.delete_subkey_all(SCHEME_KEY) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(MsError::os(format!("cannot remove HKCU\\{SCHEME_KEY}: {e}"))),
        }
    }

    fn read_entries() -> Vec<UninstallEntry> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let Ok(root) = hkcu.open_subkey_with_flags(UNINSTALL_ROOT, KEY_READ) else {
            return Vec::new();
        };
        root.enum_keys()
            .filter_map(Result::ok)
            .filter_map(|name| {
                let k = root.open_subkey_with_flags(&name, KEY_READ).ok()?;
                let get = |v: &str| k.get_value::<String, _>(v).unwrap_or_default();
                Some(UninstallEntry {
                    display_name: get("DisplayName"),
                    uninstall_string: get("UninstallString"),
                    quiet_uninstall_string: get("QuietUninstallString"),
                    key: name,
                })
            })
            .collect()
    }

    pub fn uninstall_legacy() -> MsResult<LegacyOutcome> {
        let current = std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned());
        let Some(target) = pick_legacy(&read_entries(), current.as_deref()) else {
            return Ok(LegacyOutcome::not_found());
        };
        if current.as_deref().is_some_and(legacy_uninstaller_would_kill) {
            return Err(MsError::new(
                crate::ffi::MS_ERR_UNSUPPORTED,
                format!(
                    "the 0.1.x uninstaller closes every running {LEGACY_EXE_NAME}, and this app has \
                     that name; package the new app under a different exe name"
                ),
            ));
        }
        if !std::path::Path::new(&target.uninstaller).exists() {
            // A dangling entry (the folder was deleted by hand): nothing to run.
            return Ok(LegacyOutcome {
                found: true,
                ran: false,
                exit_code: None,
            });
        }
        // NSIS: /S = silent; `_?=<dir>` = run in place and BLOCK until done (without it the
        // uninstaller copies itself to %TEMP% and returns at once — then the caller would
        // re-register mastersat:// before the old uninstaller deletes it). `_?=` must be last
        // and unquoted, hence raw_arg.
        let dir = target.install_dir.trim_end_matches('\\').to_string();
        let mut child = Command::new(&target.uninstaller)
            .raw_arg("/S")
            .raw_arg(format!("_?={dir}"))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| MsError::os(format!("cannot start {}: {e}", target.uninstaller)))?;
        let deadline = Instant::now() + Duration::from_secs(LEGACY_TIMEOUT_SECS);
        let exit_code = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(200)),
                // Still running after 60 s (or unwaitable): leave it be and report no exit code.
                _ => break None,
            }
        };
        if exit_code == Some(0) {
            // In `_?=` mode NSIS cannot delete itself or its folder: tidy up, best effort.
            let _ = std::fs::remove_file(&target.uninstaller);
            let _ = std::fs::remove_dir(&target.install_dir);
        }
        Ok(LegacyOutcome {
            found: true,
            ran: true,
            exit_code,
        })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    pub fn register(exe_path: &str) -> MsResult<()> {
        check_exe_path(exe_path)?;
        Err(MsError::unsupported("ms_register_protocol"))
    }

    pub fn unregister() -> MsResult<()> {
        Err(MsError::unsupported("unregistering mastersat://"))
    }

    /// A developer's Mac never had the 0.1.x installer.
    pub fn uninstall_legacy() -> MsResult<LegacyOutcome> {
        Ok(LegacyOutcome::not_found())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, uninstall: &str) -> UninstallEntry {
        UninstallEntry {
            key: name.to_string(),
            display_name: name.to_string(),
            uninstall_string: uninstall.to_string(),
            quiet_uninstall_string: String::new(),
        }
    }

    #[test]
    fn the_open_command_quotes_both_parts() {
        assert_eq!(
            open_command(r"C:\Users\a b\AppData\Local\MasterSAT.Exam\current\MasterSAT.exe"),
            r#""C:\Users\a b\AppData\Local\MasterSAT.Exam\current\MasterSAT.exe" "%1""#
        );
    }

    #[test]
    fn exe_paths_are_validated() {
        assert!(check_exe_path("  ").is_err());
        assert!(check_exe_path(r#"C:\x".exe"#).is_err());
        assert_eq!(check_exe_path(r" C:\x\a.exe ").unwrap(), r"C:\x\a.exe");
    }

    #[test]
    fn command_exe_handles_quotes_spaces_and_args() {
        assert_eq!(
            command_exe(r#""C:\Users\a b\AppData\Local\MasterSAT\uninstall.exe" /S"#),
            Some(r"C:\Users\a b\AppData\Local\MasterSAT\uninstall.exe".to_string())
        );
        assert_eq!(
            command_exe(r"C:\Users\a b\MasterSAT\uninstall.exe /S"),
            Some(r"C:\Users\a b\MasterSAT\uninstall.exe".to_string())
        );
        assert_eq!(command_exe(r#""unterminated"#), None);
        assert_eq!(command_exe(""), None);
    }

    #[test]
    fn picks_the_nsis_install_and_never_the_running_app() {
        let tauri = entry("MasterSAT", r#""C:\Users\s\AppData\Local\MasterSAT\uninstall.exe""#);
        let velopack = entry(
            "MasterSAT",
            r#""C:\Users\s\AppData\Local\MasterSAT.Exam\Update.exe" --uninstall"#,
        );
        let other = entry("Telegram Desktop", r#""C:\T\unins000.exe""#);
        let current = r"C:\Users\s\AppData\Local\MasterSAT.Exam\current\MasterSAT.exe";

        let picked = pick_legacy(&[other.clone(), velopack.clone(), tauri.clone()], Some(current)).unwrap();
        assert_eq!(picked.uninstaller, r"C:\Users\s\AppData\Local\MasterSAT\uninstall.exe");
        assert_eq!(picked.install_dir, r"C:\Users\s\AppData\Local\MasterSAT");

        assert_eq!(pick_legacy(&[velopack, other], Some(current)), None, "Update.exe is never run");

        // An uninstall.exe in the running app's own folder (or above it) is never run either.
        let ours = entry("MasterSAT", r#""C:\Users\s\AppData\Local\MasterSAT.Exam\uninstall.exe""#);
        assert_eq!(pick_legacy(&[ours], Some(current)), None);

        // Display name match is exact (case-insensitive), not a prefix.
        let near = entry("MasterSAT Tools", r#""C:\M\uninstall.exe""#);
        assert_eq!(pick_legacy(&[near], Some(current)), None);
        let upper = entry("MASTERSAT", r#""C:\M\uninstall.exe""#);
        assert!(pick_legacy(&[upper], Some(current)).is_some());
    }

    #[test]
    fn the_legacy_uninstaller_would_kill_an_exe_of_the_same_name() {
        assert!(legacy_uninstaller_would_kill(r"C:\Users\s\AppData\Local\MasterSAT.Exam\current\MasterSAT.exe"));
        assert!(legacy_uninstaller_would_kill(r"C:\x\mastersat.EXE"));
        assert!(!legacy_uninstaller_would_kill(r"C:\x\MasterSATExam.exe"));
        assert!(!legacy_uninstaller_would_kill(r"C:\MasterSAT.exe\other.exe"));
    }

    #[test]
    fn the_quiet_string_is_a_fallback() {
        let mut e = entry("MasterSAT", "");
        e.quiet_uninstall_string = r#""C:\M\uninstall.exe" /S"#.into();
        assert_eq!(
            pick_legacy(&[e], None).unwrap().uninstaller,
            r"C:\M\uninstall.exe"
        );
    }

    #[test]
    fn the_outcome_json_matches_the_header() {
        assert_eq!(
            serde_json::to_string(&LegacyOutcome::not_found()).unwrap(),
            r#"{"found":false,"ran":false,"exit_code":null}"#
        );
        assert_eq!(
            serde_json::to_string(&LegacyOutcome {
                found: true,
                ran: true,
                exit_code: Some(0)
            })
            .unwrap(),
            r#"{"found":true,"ran":true,"exit_code":0}"#
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn other_hosts_report_no_legacy_install_and_cannot_register() {
        assert_eq!(uninstall_legacy().unwrap(), LegacyOutcome::not_found());
        assert_eq!(register("/x/MasterSAT").unwrap_err().code, crate::ffi::MS_ERR_UNSUPPORTED);
        assert_eq!(register("").unwrap_err().code, crate::ffi::MS_ERR_ARG);
    }
}
