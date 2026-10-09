//! The arithmetic the app and the server must agree on to the byte.
//!
//! This is the Rust half of `backend/desktop/proof.py`. The message layout, the HMAC, and the
//! PKCE challenge are identical, and the unit tests below run the *same* fixed vectors as
//! `tests_desktop.ProofVectorTests` — if either half drifts, one of these tests goes red.
//!
//! Its own crate on purpose: pure functions, no Tauri and no Windows, so the vectors compile and
//! run anywhere (`cargo test -p mastersat-proof`) in seconds without the app's GUI stack.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

/// Bumped only when the message layout changes; a build signing an old version is simply not
/// verified by a server that expects the new one. Must equal `proof.PROOF_VERSION`.
pub const PROOF_VERSION: &str = "mastersat-lockdown-v1";

/// sha256 as lowercase hex. The server hashes session tokens and nonces the same way.
pub fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

/// The exact bytes that get signed: five lines, `\n`-joined, in this order. The `precheck` line is
/// the pre-check JSON *as a string* — the very string the shell hands back as `LockdownProof.precheck`
/// and the server re-signs unchanged, so it must never be re-serialised between signing and sending.
pub fn proof_message(attempt_id: i64, nonce: &str, app_version: &str, precheck: &str) -> String {
    format!("{PROOF_VERSION}\n{attempt_id}\n{nonce}\n{app_version}\n{precheck}")
}

/// HMAC-SHA256 of the proof message under `secret_hex`, as lowercase hex. Errors only if the key
/// is not valid hex (a build/config mistake).
pub fn sign(
    secret_hex: &str,
    attempt_id: i64,
    nonce: &str,
    app_version: &str,
    precheck: &str,
) -> Result<String, String> {
    let key = hex::decode(secret_hex).map_err(|_| "proof key is not valid hex".to_string())?;
    let mut mac = HmacSha256::new_from_slice(&key).map_err(|e| e.to_string())?;
    mac.update(proof_message(attempt_id, nonce, app_version, precheck).as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

/// RFC 7636 S256: base64url(sha256(verifier)) without padding. The server computes the same from
/// the verifier it is later handed, so the two must match character for character.
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // The same key the server's ProofVectorTests uses.
    const KEY_HEX: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    #[test]
    fn hmac_matches_the_shared_vector() {
        // Cross-checked with the exact command in tests_desktop.py:
        //   printf 'mastersat-lockdown-v1\n42\nnonce-abc\n0.1.0\n{"displays":1}'
        //     | openssl dgst -sha256 -mac HMAC -macopt hexkey:<KEY_HEX>
        let mac = sign(KEY_HEX, 42, "nonce-abc", "0.1.0", r#"{"displays":1}"#).unwrap();
        assert_eq!(
            mac,
            "52b830843519923e56ce8086c59a9c20fe78e41d659bcb2d7bcf6dbd6a3ce18c"
        );
    }

    #[test]
    fn pkce_matches_rfc7636_vector() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn a_changed_field_changes_the_mac() {
        let base = sign(KEY_HEX, 42, "n", "0.1.0", "{}").unwrap();
        assert_ne!(base, sign(KEY_HEX, 43, "n", "0.1.0", "{}").unwrap());
        assert_ne!(base, sign(KEY_HEX, 42, "m", "0.1.0", "{}").unwrap());
        assert_ne!(base, sign(KEY_HEX, 42, "n", "0.1.1", "{}").unwrap());
        assert_ne!(base, sign(KEY_HEX, 42, "n", "0.1.0", r#"{"vm":true}"#).unwrap());
    }

    #[test]
    fn a_non_hex_key_is_an_error_not_a_match() {
        assert!(sign("not-hex", 1, "n", "0.1.0", "{}").is_err());
    }

    #[test]
    fn sha256_hex_is_lowercase_hex() {
        assert_eq!(
            sha256_hex(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}
