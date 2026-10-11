//! The C header is the contract: `include/mastersat_native.h` and the `extern "C"` functions in
//! `src/lib.rs` must declare exactly the same functions with exactly the same C types, and the
//! MS_* status codes must match `src/ffi.rs`. A drift on either side fails here, in `cargo test`,
//! before Dart (dart:ffi) or the C++ runner ever sees a mismatched call.
//!
//! (`check_header.py` additionally diffs the header against cbindgen's own rendering of the
//! crate, and the macOS dylib's exported symbols, when cbindgen / nm are available.)

use std::collections::BTreeMap;

const HEADER: &str = include_str!("../../../include/mastersat_native.h");
const LIB_RS: &str = include_str!("../src/lib.rs");
const FFI_RS: &str = include_str!("../src/ffi.rs");

/// Remove /* … */ and // … comments.
fn strip_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let b = src.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
            i += 2;
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
            out.push(' ');
        } else if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'/' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
        } else {
            out.push(b[i] as char);
            i += 1;
        }
    }
    out
}

/// "const char* const* argv" → "const char * const *" (the parameter name dropped).
fn c_type(decl: &str, drop_name: bool) -> String {
    let spaced = decl.replace('*', " * ");
    let mut tokens: Vec<&str> = spaced.split_whitespace().collect();
    if drop_name && tokens.len() >= 2 {
        let last = *tokens.last().unwrap();
        if last != "*" && last.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            tokens.pop();
        }
    }
    tokens.join(" ")
}

type Signature = (String, Vec<String>);

fn header_functions() -> BTreeMap<String, Signature> {
    let src = strip_comments(HEADER);
    let mut out = BTreeMap::new();
    for chunk in src.split("MS_API").skip(1) {
        // The macro definitions themselves ("#define MS_API __declspec…") are not declarations.
        let Some(end) = chunk.find(';') else { continue };
        let decl = chunk[..end].trim();
        let Some(open) = decl.find('(') else { continue };
        if !decl.ends_with(')') {
            continue;
        }
        let head = decl[..open].trim();
        let name_start = head.rfind(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).map_or(0, |i| i + 1);
        let name = &head[name_start..];
        if !name.starts_with("ms_") {
            continue;
        }
        let ret = c_type(&head[..name_start], false);
        let params_src = &decl[open + 1..decl.len() - 1];
        let params: Vec<String> = if params_src.trim() == "void" || params_src.trim().is_empty() {
            Vec::new()
        } else {
            params_src.split(',').map(|p| c_type(p, true)).collect()
        };
        assert!(out.insert(name.to_string(), (ret, params)).is_none(), "{name} declared twice");
    }
    out
}

/// A Rust FFI type as the C type it must be.
fn rust_to_c(t: &str) -> String {
    let t = t.trim();
    if let Some(rest) = t.strip_prefix("*const ") {
        let inner = rust_to_c(rest);
        let inner = if inner.ends_with('*') { format!("{inner} const") } else { format!("const {inner}") };
        return format!("{inner} *");
    }
    if let Some(rest) = t.strip_prefix("*mut ") {
        return format!("{} *", rust_to_c(rest));
    }
    match t {
        "c_char" | "std::ffi::c_char" => "char",
        "u8" => "uint8_t",
        "usize" => "size_t",
        "isize" => "intptr_t",
        "i32" => "int32_t",
        "i64" => "int64_t",
        "()" | "" => "void",
        other => panic!("no C mapping for Rust type {other:?} — extend rust_to_c and the header"),
    }
    .to_string()
}

fn rust_functions() -> BTreeMap<String, Signature> {
    let src = strip_comments(LIB_RS);
    let mut out = BTreeMap::new();
    let mut rest = src.as_str();
    while let Some(i) = rest.find("extern \"C\" fn ") {
        let after = &rest[i + "extern \"C\" fn ".len()..];
        let open = after.find('(').unwrap();
        let name = after[..open].trim().to_string();
        let close = after.find(')').unwrap();
        let params_src = &after[open + 1..close];
        let tail = &after[close + 1..];
        let body = tail.find('{').unwrap();
        let ret_src = tail[..body].trim();
        let ret = match ret_src.strip_prefix("->") {
            Some(r) => rust_to_c(r),
            None => "void".to_string(),
        };
        let params: Vec<String> = params_src
            .split(',')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(|p| rust_to_c(p.split_once(':').expect("name: type").1))
            .collect();
        if name.starts_with("ms_") {
            assert!(out.insert(name.clone(), (ret, params)).is_none(), "{name} defined twice");
        }
        rest = &after[close..];
    }
    out
}

#[test]
fn every_header_function_is_exported_with_the_same_c_signature() {
    let header = header_functions();
    let rust = rust_functions();
    assert!(header.len() >= 27, "parsed only {} header functions", header.len());

    let missing: Vec<_> = header.keys().filter(|k| !rust.contains_key(*k)).collect();
    let extra: Vec<_> = rust.keys().filter(|k| !header.contains_key(*k)).collect();
    assert!(missing.is_empty(), "declared in the header but not exported: {missing:?}");
    assert!(extra.is_empty(), "exported but not in the header: {extra:?}");

    for (name, (h_ret, h_params)) in &header {
        let (r_ret, r_params) = &rust[name];
        assert_eq!(h_ret, r_ret, "{name}: return type");
        assert_eq!(h_params, r_params, "{name}: parameters");
    }
}

#[test]
fn every_status_code_matches() {
    let header: BTreeMap<String, i32> = strip_comments(HEADER)
        .lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            (it.next()? == "#define").then_some(())?;
            let name = it.next()?;
            let value = it.next()?.parse().ok()?;
            name.starts_with("MS_").then(|| (name.to_string(), value))
        })
        .collect();
    let rust: BTreeMap<String, i32> = FFI_RS
        .lines()
        .filter_map(|l| {
            let l = l.trim().strip_prefix("pub const ")?;
            let (name, rest) = l.split_once(": i32 = ")?;
            Some((name.to_string(), rest.trim_end_matches(';').parse().ok()?))
        })
        .collect();
    assert_eq!(header.len(), 12, "{header:?}");
    assert_eq!(header, rust);
}

/// The same signatures, checked by the compiler: each export coerces to the C function-pointer
/// type the header declares.
#[test]
fn exports_have_the_declared_types() {
    use mastersat_native::*;
    use std::ffi::c_char;
    let _: unsafe extern "C" fn(*mut c_char) = ms_free;
    let _: unsafe extern "C" fn(*mut u8, usize) = ms_free_bytes;
    let _: extern "C" fn() -> *const c_char = ms_version;
    let _: extern "C" fn() -> *mut c_char = ms_last_error;
    let _: unsafe extern "C" fn(i32, *const *const c_char) -> i32 = ms_startup;
    let _: unsafe extern "C" fn(isize, *const c_char) -> i32 = ms_init;
    let _: unsafe extern "C" fn(*const c_char) -> i32 = ms_register_protocol;
    let _: unsafe extern "C" fn(*mut *mut c_char) -> i32 = ms_uninstall_legacy;
    let _: unsafe extern "C" fn(*mut *mut c_char) -> i32 = ms_precheck_json;
    let _: unsafe extern "C" fn(*const c_char) -> i32 = ms_close_app;
    let _: unsafe extern "C" fn(*mut *mut c_char) -> i32 = ms_lock_enter;
    let _: extern "C" fn() -> i32 = ms_lock_exit;
    let _: extern "C" fn() -> i32 = ms_heartbeat;
    let _: extern "C" fn() -> i32 = ms_away_now;
    let _: unsafe extern "C" fn(*mut *mut c_char) -> i32 = ms_battery_json;
    let _: unsafe extern "C" fn(i64, *const c_char, *mut *mut c_char) -> i32 = ms_prove;
    let _: unsafe extern "C" fn(*mut *mut c_char, *mut *mut c_char) -> i32 = ms_pkce_new;
    let _: unsafe extern "C" fn(*const u8, usize, *mut *mut u8, *mut usize) -> i32 = ms_seal;
    let _: unsafe extern "C" fn(*const u8, usize, *mut *mut u8, *mut usize) -> i32 = ms_open;
    let _: unsafe extern "C" fn(*const u8, usize, *mut *mut u8, *mut usize) -> i32 = ms_protect;
    let _: unsafe extern "C" fn(*const u8, usize, *mut *mut u8, *mut usize) -> i32 = ms_unprotect;
    let _: unsafe extern "C" fn(*const c_char, *mut *mut c_char) -> i32 = ms_proxy_for;
    let _: extern "C" fn(i32) -> i32 = ms_keep_awake;
    let _: unsafe extern "C" fn(*const c_char, *const c_char, *mut *mut c_char) -> i32 = ms_update_check;
    let _: extern "C" fn() -> i32 = ms_update_download;
    let _: extern "C" fn() -> i32 = ms_update_progress;
    let _: extern "C" fn() -> i32 = ms_update_apply_restart;
}

#[test]
fn the_type_normaliser_itself() {
    assert_eq!(c_type("const char* const* argv", true), "const char * const *");
    assert_eq!(c_type("uint8_t** out", true), "uint8_t * *");
    assert_eq!(c_type("int32_t ", false), "int32_t");
    assert_eq!(rust_to_c("*const *const c_char"), "const char * const *");
    assert_eq!(rust_to_c("*mut *mut u8"), "uint8_t * *");
    assert_eq!(rust_to_c("*mut usize"), "size_t *");
}
