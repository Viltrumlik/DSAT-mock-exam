//! The build's proof-signing key.
//!
//! A release build embeds the pair from the `DESKTOP_PROOF_KEY` CI secret at compile time
//! (format `key_id:hex`, the same secret and format the Tauri shell uses); the server's
//! `DESKTOP_PROOF_KEYS` must hold the same pair. It is never in the repo.
//!
//! Without the secret:
//!  * a release build has NO key — `ms_prove` returns MS_ERR_NO_KEY (header contract), so a
//!    mis-built installer fails loudly at the first midterm instead of sending proofs a
//!    production server rejects;
//!  * a debug build (or `--features dev-key`) embeds the development pair the Tauri shell has
//!    always fallen back to, so `cargo test`, the macOS dev runner and a local server work.

/// The development key — the same pair as the Tauri shell's fallback and the server's
/// ProofVectorTests key. A production server never accepts it.
pub const DEV_KEY: &str = "dev1:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

/// `(key_id, secret_hex)` this build signs with, if any.
pub fn embedded_key() -> Option<(String, String)> {
    let raw = match option_env!("DESKTOP_PROOF_KEY") {
        Some(k) if !k.trim().is_empty() => k,
        _ if cfg!(any(debug_assertions, feature = "dev-key")) => DEV_KEY,
        _ => return None,
    };
    parse_key(raw)
}

/// `key_id:hex` → `(key_id, hex)`; a bare hex secret gets the id `dev1` (Tauri's rule).
pub fn parse_key(raw: &str) -> Option<(String, String)> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    match raw.split_once(':') {
        Some((id, hex)) if !id.trim().is_empty() && !hex.trim().is_empty() => {
            Some((id.trim().to_string(), hex.trim().to_string()))
        }
        Some(_) => None,
        None => Some(("dev1".to_string(), raw.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_secret_format() {
        assert_eq!(
            parse_key("k7:abcd"),
            Some(("k7".to_string(), "abcd".to_string()))
        );
        assert_eq!(
            parse_key(" abcd \n"),
            Some(("dev1".to_string(), "abcd".to_string()))
        );
        assert_eq!(parse_key(""), None);
        assert_eq!(parse_key("k7:"), None);
        assert_eq!(parse_key(":abcd"), None);
    }

    #[test]
    fn a_debug_build_has_a_key() {
        // Tests are debug builds: with no DESKTOP_PROOF_KEY in the environment this is DEV_KEY.
        let (id, hex) = embedded_key().expect("debug builds embed a key");
        assert!(!id.is_empty());
        assert!(hex::decode(&hex).is_ok(), "the embedded secret is hex");
        if option_env!("DESKTOP_PROOF_KEY").map_or(true, |k| k.trim().is_empty()) {
            assert_eq!((id.as_str(), hex.as_str()), ("dev1", &DEV_KEY[5..]));
        }
    }
}
