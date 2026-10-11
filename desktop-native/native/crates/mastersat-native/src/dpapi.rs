//! DPAPI, current-user scope (`ms_protect` / `ms_unprotect`, and the wrapping of the data key).
//! A blob protected here unprotects only for the same Windows account (on the same machine, or
//! with a roaming profile); nothing is stored by this module.

#![cfg(windows)]

use std::ffi::c_void;

use windows::core::w;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

use crate::ffi::{MsError, MsResult};

fn blob_of(bytes: &[u8]) -> MsResult<CRYPT_INTEGER_BLOB> {
    let len = u32::try_from(bytes.len()).map_err(|_| MsError::arg("input is larger than 4 GiB"))?;
    Ok(CRYPT_INTEGER_BLOB {
        cbData: len,
        pbData: bytes.as_ptr() as *mut u8,
    })
}

/// Copy a DPAPI output blob into a Vec and release it with LocalFree.
unsafe fn take_blob(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    if out.pbData.is_null() {
        return Vec::new();
    }
    let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
    let _ = LocalFree(HLOCAL(out.pbData as *mut c_void));
    v
}

pub fn protect(plain: &[u8], entropy: Option<&[u8]>) -> MsResult<Vec<u8>> {
    let input = blob_of(plain)?;
    let entropy_blob = entropy.map(blob_of).transpose()?;
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            w!("MasterSAT"),
            entropy_blob.as_ref().map(|b| b as *const CRYPT_INTEGER_BLOB),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        )
        .map_err(|e| MsError::crypto(format!("CryptProtectData failed: {e}")))?;
        Ok(take_blob(out))
    }
}

pub fn unprotect(blob: &[u8], entropy: Option<&[u8]>) -> MsResult<Vec<u8>> {
    let input = blob_of(blob)?;
    let entropy_blob = entropy.map(blob_of).transpose()?;
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            entropy_blob.as_ref().map(|b| b as *const CRYPT_INTEGER_BLOB),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        )
        .map_err(|e| MsError::crypto(format!("CryptUnprotectData failed: {e}")))?;
        Ok(take_blob(out))
    }
}
