//! Data at rest: AES-256-GCM with a per-user data key (`ms_seal` / `ms_open`).
//!
//! Sealed format (header): `12-byte nonce || ciphertext || 16-byte tag`, a fresh random nonce per
//! seal. The data key is 32 random bytes, created on first use and kept in
//! `<data dir>/key.bin` WRAPPED — with DPAPI (current-user scope) on Windows, so another Windows
//! account or another machine cannot unwrap it. Once loaded it stays in memory for the process.
//!
//! A `key.bin` that exists but cannot be unwrapped is an error (MS_ERR_CRYPTO), never silently
//! replaced: replacing it would orphan every sealed journal entry (unsent answers) for good, while
//! a transient DPAPI failure (a roaming profile not yet loaded) would have recovered.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};

use crate::ffi::{MsError, MsResult};

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;
pub const TAG_LEN: usize = 16;
pub const KEY_FILE: &str = "key.bin";

/// Environment override for the data folder (tests, portable dev runs). Unset in production.
pub const DATA_DIR_ENV: &str = "MASTERSAT_DATA_DIR";

pub type DataKey = [u8; KEY_LEN];

pub fn random_bytes<const N: usize>() -> MsResult<[u8; N]> {
    let mut buf = [0u8; N];
    getrandom::getrandom(&mut buf).map_err(|e| MsError::os(format!("the OS random generator failed: {e}")))?;
    Ok(buf)
}

/// `nonce || ciphertext || tag` of `plain` under `key`.
pub fn seal_with(key: &DataKey, plain: &[u8]) -> MsResult<Vec<u8>> {
    let cipher = Aes256Gcm::new(key.into());
    let nonce_bytes: [u8; NONCE_LEN] = random_bytes()?;
    let sealed = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plain)
        .map_err(|_| MsError::crypto("AES-GCM encryption failed"))?;
    let mut out = Vec::with_capacity(NONCE_LEN + sealed.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// The plaintext of a [`seal_with`] blob, or MS_ERR_CRYPTO if it was not sealed under `key`
/// or was altered in any way.
pub fn open_with(key: &DataKey, sealed: &[u8]) -> MsResult<Vec<u8>> {
    if sealed.len() < NONCE_LEN + TAG_LEN {
        return Err(MsError::crypto(format!(
            "sealed data is {} bytes, shorter than nonce + tag ({})",
            sealed.len(),
            NONCE_LEN + TAG_LEN
        )));
    }
    let (nonce, body) = sealed.split_at(NONCE_LEN);
    Aes256Gcm::new(key.into())
        .decrypt(Nonce::from_slice(nonce), body)
        .map_err(|_| MsError::crypto("sealed data failed authentication (wrong key or altered)"))
}

/// How the data key is protected inside `key.bin`.
pub trait KeyWrap {
    fn wrap(&self, key: &[u8]) -> MsResult<Vec<u8>>;
    fn unwrap(&self, blob: &[u8]) -> MsResult<Vec<u8>>;
}

/// The data key in `dir/key.bin`, created (and wrapped) on first use.
pub fn load_or_create(dir: &Path, wrap: &dyn KeyWrap) -> MsResult<DataKey> {
    let path = dir.join(KEY_FILE);
    match fs::read(&path) {
        Ok(blob) => unwrap_key(&blob, wrap),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => create_key(dir, &path, wrap),
        Err(e) => Err(MsError::os(format!("cannot read {}: {e}", path.display()))),
    }
}

fn unwrap_key(blob: &[u8], wrap: &dyn KeyWrap) -> MsResult<DataKey> {
    let key = wrap.unwrap(blob)?;
    key.as_slice()
        .try_into()
        .map_err(|_| MsError::crypto(format!("{KEY_FILE} holds a {}-byte key, expected {KEY_LEN}", key.len())))
}

fn create_key(dir: &Path, path: &Path, wrap: &dyn KeyWrap) -> MsResult<DataKey> {
    fs::create_dir_all(dir).map_err(|e| MsError::os(format!("cannot create {}: {e}", dir.display())))?;
    let key: DataKey = random_bytes()?;
    let blob = wrap.wrap(&key)?;

    // Write a temp file, then publish it with a hard link: the link fails if key.bin appeared
    // meanwhile (another process won the race), so a key that may already seal data is never
    // overwritten, and a crash mid-write never leaves a truncated key.bin behind.
    let tmp = dir.join(format!("{KEY_FILE}.{}.tmp", std::process::id()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| MsError::os(format!("cannot create {}: {e}", tmp.display())))?;
        restrict_permissions(&f);
        f.write_all(&blob)?;
        f.sync_all()?;
    }
    let published = match fs::hard_link(&tmp, path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        // A file system without hard links: fall back to a rename when nothing is there yet.
        Err(_) if !path.exists() => fs::rename(&tmp, path).map(|_| true),
        Err(_) => Ok(false),
    };
    let _ = fs::remove_file(&tmp);
    match published {
        Ok(true) => Ok(key),
        // Someone else created it first: theirs is the key.
        Ok(false) => unwrap_key(&fs::read(path)?, wrap),
        Err(e) => Err(MsError::os(format!("cannot write {}: {e}", path.display()))),
    }
}

#[cfg(unix)]
fn restrict_permissions(f: &fs::File) {
    use std::os::unix::fs::PermissionsExt;
    let _ = f.set_permissions(fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_f: &fs::File) {}

/// `%LOCALAPPDATA%\MasterSAT` on Windows (outside the Velopack install folder, so an update or an
/// uninstall never deletes it); the app-support folder on a developer's Mac. `MASTERSAT_DATA_DIR`
/// overrides both.
pub fn data_dir() -> MsResult<PathBuf> {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV).filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    platform_data_dir()
}

#[cfg(windows)]
fn platform_data_dir() -> MsResult<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .filter(|v| !v.is_empty())
        .map(|base| PathBuf::from(base).join("MasterSAT"))
        .ok_or_else(|| MsError::os("%LOCALAPPDATA% is not set"))
}

#[cfg(target_os = "macos")]
fn platform_data_dir() -> MsResult<PathBuf> {
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support/MasterSAT"))
        .ok_or_else(|| MsError::os("$HOME is not set"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_data_dir() -> MsResult<PathBuf> {
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(xdg).join("MasterSAT"));
    }
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join(".local/share/MasterSAT"))
        .ok_or_else(|| MsError::os("$HOME is not set"))
}

/// The platform's wrapping: DPAPI (current user, with this purpose's entropy) on Windows.
#[cfg(windows)]
pub struct PlatformWrap;

#[cfg(windows)]
impl KeyWrap for PlatformWrap {
    fn wrap(&self, key: &[u8]) -> MsResult<Vec<u8>> {
        crate::dpapi::protect(key, Some(KEY_ENTROPY))
    }
    fn unwrap(&self, blob: &[u8]) -> MsResult<Vec<u8>> {
        crate::dpapi::unprotect(blob, Some(KEY_ENTROPY))
    }
}

/// DPAPI "optional entropy" for the data key, so a token blob (ms_protect, no entropy) and the
/// key blob can never be swapped for one another.
#[cfg(windows)]
const KEY_ENTROPY: &[u8] = b"MasterSAT data key v1";

/// No DPAPI off Windows: the key file holds the raw key (0600). On the MacBook app that file is
/// inside the app's sandbox container, readable by this user only — DPAPI's boundary too.
#[cfg(not(windows))]
pub struct PlatformWrap;

#[cfg(not(windows))]
impl KeyWrap for PlatformWrap {
    fn wrap(&self, key: &[u8]) -> MsResult<Vec<u8>> {
        Ok(key.to_vec())
    }
    fn unwrap(&self, blob: &[u8]) -> MsResult<Vec<u8>> {
        Ok(blob.to_vec())
    }
}

static DATA_KEY: Mutex<Option<DataKey>> = Mutex::new(None);

/// The process's data key: loaded (or created) once, then cached. A failure is not cached, so a
/// transient problem recovers on the next call.
pub fn data_key() -> MsResult<DataKey> {
    let mut slot = DATA_KEY.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(key) = *slot {
        return Ok(key);
    }
    let key = load_or_create(&data_dir()?, &PlatformWrap)?;
    *slot = Some(key);
    Ok(key)
}

pub fn seal(plain: &[u8]) -> MsResult<Vec<u8>> {
    seal_with(&data_key()?, plain)
}

pub fn open(sealed: &[u8]) -> MsResult<Vec<u8>> {
    open_with(&data_key()?, sealed)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::ffi::MS_ERR_CRYPTO;
    use std::cell::Cell;

    pub(crate) fn temp_dir(tag: &str) -> PathBuf {
        let n: [u8; 8] = random_bytes().unwrap();
        let dir = std::env::temp_dir().join(format!("mastersat-native-{tag}-{}", hex::encode(n)));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const TEST_KEY: DataKey = [7u8; KEY_LEN];

    #[test]
    fn seal_then_open_round_trips() {
        for plain in [&b""[..], b"x", b"{\"answers\":{\"101\":\"B\"}}", &[0u8; 5000][..]] {
            let sealed = seal_with(&TEST_KEY, plain).unwrap();
            assert_eq!(sealed.len(), NONCE_LEN + plain.len() + TAG_LEN);
            assert_eq!(open_with(&TEST_KEY, &sealed).unwrap(), plain);
        }
    }

    #[test]
    fn every_seal_uses_a_fresh_nonce() {
        let a = seal_with(&TEST_KEY, b"same").unwrap();
        let b = seal_with(&TEST_KEY, b"same").unwrap();
        assert_ne!(a[..NONCE_LEN], b[..NONCE_LEN]);
        assert_ne!(a, b);
    }

    #[test]
    fn tampering_or_the_wrong_key_is_a_crypto_error() {
        let sealed = seal_with(&TEST_KEY, b"journal entry").unwrap();
        for i in [0, NONCE_LEN, sealed.len() - 1] {
            let mut bad = sealed.clone();
            bad[i] ^= 0x01;
            assert_eq!(open_with(&TEST_KEY, &bad).unwrap_err().code, MS_ERR_CRYPTO);
        }
        assert_eq!(open_with(&[8u8; KEY_LEN], &sealed).unwrap_err().code, MS_ERR_CRYPTO);
        assert_eq!(open_with(&TEST_KEY, &sealed[..27]).unwrap_err().code, MS_ERR_CRYPTO);
        assert_eq!(open_with(&TEST_KEY, &[]).unwrap_err().code, MS_ERR_CRYPTO);
    }

    /// A matching AES-256-GCM vector (NIST SP 800-38D test case 14: zero key, zero IV, one zero
    /// block) proves the cipher is the standard one, not merely self-consistent.
    #[test]
    fn matches_the_nist_gcm_vector() {
        let key = [0u8; 32];
        let cipher = Aes256Gcm::new((&key).into());
        let out = cipher.encrypt(Nonce::from_slice(&[0u8; 12]), &[0u8; 16][..]).unwrap();
        assert_eq!(
            hex::encode(out),
            "cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919"
        );
    }

    /// A wrapper that marks its blobs, to prove the file holds the WRAPPED key.
    struct XorWrap {
        wraps: Cell<u32>,
    }
    impl KeyWrap for XorWrap {
        fn wrap(&self, key: &[u8]) -> MsResult<Vec<u8>> {
            self.wraps.set(self.wraps.get() + 1);
            let mut v = b"W1".to_vec();
            v.extend(key.iter().map(|b| b ^ 0x5a));
            Ok(v)
        }
        fn unwrap(&self, blob: &[u8]) -> MsResult<Vec<u8>> {
            match blob.strip_prefix(b"W1") {
                Some(rest) => Ok(rest.iter().map(|b| b ^ 0x5a).collect()),
                None => Err(MsError::crypto("not a W1 blob")),
            }
        }
    }

    #[test]
    fn the_key_is_created_once_wrapped_then_reused() {
        let dir = temp_dir("keystore").join("nested");
        let wrap = XorWrap { wraps: Cell::new(0) };
        let first = load_or_create(&dir, &wrap).unwrap();
        let second = load_or_create(&dir, &wrap).unwrap();
        assert_eq!(first, second);
        assert_eq!(wrap.wraps.get(), 1, "created once");

        let on_disk = fs::read(dir.join(KEY_FILE)).unwrap();
        assert_eq!(&on_disk[..2], b"W1");
        assert_ne!(&on_disk[2..], &first[..], "the file holds the wrapped key, not the key");
        // No temp files left behind.
        let names: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from(KEY_FILE)]);
        fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[test]
    fn an_unreadable_key_file_is_an_error_and_is_never_replaced() {
        let dir = temp_dir("badkey");
        fs::write(dir.join(KEY_FILE), b"garbage").unwrap();
        let wrap = XorWrap { wraps: Cell::new(0) };
        assert_eq!(load_or_create(&dir, &wrap).unwrap_err().code, MS_ERR_CRYPTO);
        assert_eq!(fs::read(dir.join(KEY_FILE)).unwrap(), b"garbage");
        assert_eq!(wrap.wraps.get(), 0);

        fs::write(dir.join(KEY_FILE), b"W1short").unwrap();
        assert_eq!(load_or_create(&dir, &wrap).unwrap_err().code, MS_ERR_CRYPTO);
        fs::remove_dir_all(&dir).unwrap();
    }
}
