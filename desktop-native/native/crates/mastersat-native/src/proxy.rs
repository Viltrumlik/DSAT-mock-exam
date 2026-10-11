//! `ms_proxy_for`: the system proxy for a URL, in dart:io `HttpClient.findProxy` format.
//!
//! Schools put students behind proxies configured the Windows way — a fixed proxy in the
//! Internet Options, or a PAC script (explicit URL or discovered by WPAD). dart:io sees none of
//! that, so the app asks here. On Windows: `WinHttpGetIEProxyConfigForCurrentUser` for the user's
//! settings, `WinHttpGetProxyForUrl` to run auto-detect / the PAC script, and the fixed proxy (with
//! its bypass list) when there is no auto-config or it fails — Microsoft's documented order.
//!
//! Results are cached per scheme://host:port for 5 minutes (also a DIRECT that came from a failed
//! WPAD discovery, so a school without WPAD pays the discovery timeout once, not per request).
//! Other hosts: always "DIRECT" (header: macOS stub).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::ffi::{MsError, MsResult};

pub const CACHE_TTL: Duration = Duration::from_secs(5 * 60);
pub const DIRECT: &str = "DIRECT";

/// The part of a URL a proxy decision depends on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub scheme: String,
    pub host: String,
    pub port: u16,
}

impl Target {
    pub fn parse(raw: &str) -> MsResult<Target> {
        let url = url::Url::parse(raw).map_err(|e| MsError::arg(format!("not a URL ({e})")))?;
        let scheme = url.scheme().to_ascii_lowercase();
        if scheme != "http" && scheme != "https" && scheme != "ws" && scheme != "wss" {
            return Err(MsError::arg(format!("unsupported URL scheme {scheme:?}")));
        }
        let host = url
            .host_str()
            .filter(|h| !h.is_empty())
            .ok_or_else(|| MsError::arg("the URL has no host"))?
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_ascii_lowercase();
        let port = url
            .port_or_known_default()
            .ok_or_else(|| MsError::arg("the URL has no port"))?;
        Ok(Target { scheme, host, port })
    }

    fn cache_key(&self) -> String {
        format!("{}://{}:{}", self.scheme, self.host, self.port)
    }

    /// The scheme a WinHTTP `scheme=proxy` entry would be keyed by (WebSockets ride http/https).
    fn proxy_scheme(&self) -> &str {
        match self.scheme.as_str() {
            "ws" => "http",
            "wss" => "https",
            s => s,
        }
    }
}

/// One proxy from a WinHTTP proxy list, normalised to `host:port`.
fn normalise_entry(entry: &str) -> Option<String> {
    let mut e = entry.trim();
    if e.is_empty() {
        return None;
    }
    if e.eq_ignore_ascii_case(DIRECT) {
        return Some(DIRECT.to_string());
    }
    // "http://host:port" / "https://host:port" → host:port (dart:io's PROXY speaks HTTP CONNECT).
    if let Some(i) = e.find("://") {
        let scheme = e[..i].to_ascii_lowercase();
        if scheme.starts_with("socks") {
            return None; // dart:io cannot use a SOCKS proxy
        }
        e = &e[i + 3..];
    }
    let e = e.trim_end_matches('/');
    if e.is_empty() {
        return None;
    }
    // Already host:port (or [v6]:port)?
    let has_port = match e.rfind(':') {
        Some(i) => !e.ends_with(']') && e[i + 1..].chars().all(|c| c.is_ascii_digit()) && i + 1 < e.len(),
        None => false,
    };
    Some(if has_port { e.to_string() } else { format!("{e}:80") })
}

/// A WinHTTP proxy list ("p:8080", "p1:80;p2:80", "http=p1:80;https=p2:443;socks=s:1080", entries
/// separated by ';' or whitespace) → the proxies that apply to `target`, in order.
pub fn proxies_for_list(list: &str, target: &Target) -> Vec<String> {
    let entries: Vec<&str> = list
        .split(|c: char| c == ';' || c.is_whitespace())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    let keyed = entries.iter().any(|e| e.contains('=') && !e.contains("://"));
    let mut out: Vec<String> = Vec::new();
    for entry in entries {
        let value = if keyed {
            match entry.split_once('=') {
                Some((scheme, value)) if scheme.trim().eq_ignore_ascii_case(target.proxy_scheme()) => value,
                // An unkeyed entry in a keyed list applies to every scheme.
                None => entry,
                Some(_) => continue,
            }
        } else {
            entry
        };
        if let Some(p) = normalise_entry(value) {
            if !out.contains(&p) {
                out.push(p);
            }
        }
    }
    out
}

/// Whether `target` matches the Internet Options bypass list ("<local>;*.lan;10.*;example.com").
pub fn bypassed(bypass: &str, target: &Target) -> bool {
    let host = target.host.as_str();
    let host_port = format!("{}:{}", target.host, target.port);
    bypass
        .split(|c: char| c == ';' || c == ',' || c.is_whitespace())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .any(|rule| {
            if rule.eq_ignore_ascii_case("<local>") {
                // Internet Explorer's rule: a host name without a dot (and the loopback names).
                return (!host.contains('.') && !host.contains(':'))
                    || host == "localhost"
                    || host == "127.0.0.1"
                    || host == "::1";
            }
            let rule = rule.to_ascii_lowercase();
            let rule = rule
                .strip_prefix("http://")
                .or_else(|| rule.strip_prefix("https://"))
                .unwrap_or(&rule);
            glob_match(rule, host) || glob_match(rule, &host_port)
        })
}

/// `*` matches any run of characters (including none); everything else literally, ASCII-case
/// already folded by the caller.
fn glob_match(pattern: &str, text: &str) -> bool {
    let (p, t) = (pattern.as_bytes(), text.as_bytes());
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star, mut mark) = (None::<usize>, 0usize);
    while ti < t.len() {
        if pi < p.len() && p[pi] != b'*' && p[pi] == t[ti] {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == b'*' {
            star = Some(pi);
            pi += 1;
            mark = ti;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == b'*' {
        pi += 1;
    }
    pi == p.len()
}

/// `HttpClient.findProxy` format: "DIRECT", or "PROXY a:1; PROXY b:2; DIRECT" (the header's shape —
/// DIRECT last, so a dead proxy does not strand a student whose network allows going direct).
pub fn find_proxy_string(proxies: &[String]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for p in proxies {
        if p == DIRECT {
            break; // a PAC "…; DIRECT" ends the list; everything after it is unreachable anyway
        }
        parts.push(format!("PROXY {p}"));
    }
    if parts.is_empty() {
        return DIRECT.to_string();
    }
    parts.push(DIRECT.to_string());
    parts.join("; ")
}

/// The decision for a fixed (non-PAC) configuration.
pub fn static_decision(proxy_list: &str, bypass: &str, target: &Target) -> String {
    if bypassed(bypass, target) {
        return DIRECT.to_string();
    }
    find_proxy_string(&proxies_for_list(proxy_list, target))
}

struct CacheEntry {
    at: Instant,
    value: String,
}

static CACHE: Mutex<Option<HashMap<String, CacheEntry>>> = Mutex::new(None);

/// `ms_proxy_for`.
pub fn proxy_for(url: &str) -> MsResult<String> {
    let target = Target::parse(url)?;
    let key = target.cache_key();
    {
        let cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(entry) = cache.as_ref().and_then(|m| m.get(&key)) {
            if entry.at.elapsed() < CACHE_TTL {
                return Ok(entry.value.clone());
            }
        }
    }
    // Looked up without the lock held: a slow WPAD discovery must not block other hosts' lookups.
    let value = imp::lookup(url, &target);
    let mut cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
    let map = cache.get_or_insert_with(HashMap::new);
    map.retain(|_, e| e.at.elapsed() < CACHE_TTL);
    map.insert(
        key,
        CacheEntry {
            at: Instant::now(),
            value: value.clone(),
        },
    );
    Ok(value)
}

#[cfg(not(windows))]
mod imp {
    use super::{Target, DIRECT};

    pub fn lookup(_url: &str, _target: &Target) -> String {
        DIRECT.to_string()
    }
}

#[cfg(windows)]
mod imp {
    use super::{find_proxy_string, proxies_for_list, static_decision, Target, DIRECT};
    use std::ffi::c_void;

    use windows::core::{w, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{GlobalFree, BOOL, HGLOBAL};
    use windows::Win32::Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpGetIEProxyConfigForCurrentUser, WinHttpGetProxyForUrl, WinHttpOpen,
        WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_NAMED_PROXY, WINHTTP_ACCESS_TYPE_NO_PROXY,
        WINHTTP_AUTOPROXY_AUTO_DETECT, WINHTTP_AUTOPROXY_CONFIG_URL, WINHTTP_AUTOPROXY_OPTIONS,
        WINHTTP_AUTO_DETECT_TYPE_DHCP, WINHTTP_AUTO_DETECT_TYPE_DNS_A,
        WINHTTP_CURRENT_USER_IE_PROXY_CONFIG, WINHTTP_PROXY_INFO,
    };

    /// Take a WinHTTP-allocated string (GlobalAlloc'd) and free it.
    unsafe fn take(p: PWSTR) -> Option<String> {
        if p.is_null() {
            return None;
        }
        let s = p.to_string().ok();
        let _ = GlobalFree(HGLOBAL(p.0 as *mut c_void));
        s.filter(|s| !s.trim().is_empty())
    }

    struct UserConfig {
        auto_detect: bool,
        auto_config_url: Option<String>,
        proxy: Option<String>,
        bypass: Option<String>,
    }

    fn user_config() -> UserConfig {
        let mut ie = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
        unsafe {
            if WinHttpGetIEProxyConfigForCurrentUser(&mut ie).is_err() {
                // No per-user settings readable: behave like a machine with "Automatically detect".
                return UserConfig {
                    auto_detect: true,
                    auto_config_url: None,
                    proxy: None,
                    bypass: None,
                };
            }
            UserConfig {
                auto_detect: ie.fAutoDetect.as_bool(),
                auto_config_url: take(ie.lpszAutoConfigUrl),
                proxy: take(ie.lpszProxy),
                bypass: take(ie.lpszProxyBypass),
            }
        }
    }

    /// Run auto-detect and/or the PAC script. None when it could not decide (no WPAD, the PAC
    /// script failed to download or run), so the caller falls back to the fixed proxy.
    fn auto_proxy(url: &str, target: &Target, cfg: &UserConfig) -> Option<String> {
        unsafe {
            let session = WinHttpOpen(
                w!("MasterSAT"),
                WINHTTP_ACCESS_TYPE_NO_PROXY,
                PCWSTR::null(),
                PCWSTR::null(),
                0,
            );
            if session.is_null() {
                return None;
            }
            // Bound a PAC download / WPAD probe (ms): resolve, connect, send, receive.
            let _ = WinHttpSetTimeouts(session, 5_000, 5_000, 5_000, 5_000);

            let config_url = cfg.auto_config_url.as_deref().map(HSTRING::from);
            let mut flags = 0u32;
            let mut detect = 0u32;
            if config_url.is_some() {
                flags |= WINHTTP_AUTOPROXY_CONFIG_URL;
            }
            if cfg.auto_detect {
                flags |= WINHTTP_AUTOPROXY_AUTO_DETECT;
                detect = WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A;
            }
            let mut options = WINHTTP_AUTOPROXY_OPTIONS {
                dwFlags: flags,
                dwAutoDetectFlags: detect,
                lpszAutoConfigUrl: config_url
                    .as_ref()
                    .map(|h| PCWSTR(h.as_ptr()))
                    .unwrap_or(PCWSTR::null()),
                lpvReserved: std::ptr::null_mut(),
                dwReserved: 0,
                fAutoLogonIfChallenged: BOOL::from(true),
            };
            let mut info = WINHTTP_PROXY_INFO::default();
            let url_w = HSTRING::from(url);
            let ok = WinHttpGetProxyForUrl(session, &url_w, &mut options, &mut info).is_ok();
            let _ = WinHttpCloseHandle(session);
            if !ok {
                return None;
            }
            let list = take(info.lpszProxy);
            let _ = take(info.lpszProxyBypass);
            if info.dwAccessType == WINHTTP_ACCESS_TYPE_NO_PROXY {
                return Some(DIRECT.to_string());
            }
            if info.dwAccessType == WINHTTP_ACCESS_TYPE_NAMED_PROXY {
                if let Some(list) = list {
                    return Some(find_proxy_string(&proxies_for_list(&list, target)));
                }
            }
            Some(DIRECT.to_string())
        }
    }

    pub fn lookup(url: &str, target: &Target) -> String {
        let cfg = user_config();
        if cfg.auto_detect || cfg.auto_config_url.is_some() {
            if let Some(decision) = auto_proxy(url, target, &cfg) {
                return decision;
            }
        }
        match cfg.proxy.as_deref() {
            Some(list) => static_decision(list, cfg.bypass.as_deref().unwrap_or(""), target),
            None => DIRECT.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffi::MS_ERR_ARG;

    fn t(url: &str) -> Target {
        Target::parse(url).unwrap()
    }

    #[test]
    fn parses_targets() {
        assert_eq!(
            t("https://MasterSAT.uz/api/desktop/v1/home"),
            Target {
                scheme: "https".into(),
                host: "mastersat.uz".into(),
                port: 443
            }
        );
        assert_eq!(t("http://10.0.0.5:8000/x").port, 8000);
        assert_eq!(t("wss://mastersat.uz/ws/").port, 443);
        assert_eq!(t("http://[::1]:3000/").host, "::1");
        assert_eq!(Target::parse("not a url").unwrap_err().code, MS_ERR_ARG);
        assert_eq!(Target::parse("ftp://x/").unwrap_err().code, MS_ERR_ARG);
        assert_eq!(Target::parse("file:///c:/x").unwrap_err().code, MS_ERR_ARG);
    }

    #[test]
    fn a_single_proxy_applies_to_every_scheme() {
        let target = t("https://mastersat.uz/");
        assert_eq!(proxies_for_list("proxy.school.lan:3128", &target), vec!["proxy.school.lan:3128"]);
        assert_eq!(proxies_for_list("http://proxy:8080/", &target), vec!["proxy:8080"]);
        assert_eq!(proxies_for_list("proxy", &target), vec!["proxy:80"], "WinHTTP's default port");
        assert_eq!(proxies_for_list("p1:80; p2:81 p1:80", &target), vec!["p1:80", "p2:81"]);
    }

    #[test]
    fn a_keyed_list_picks_the_url_scheme() {
        let list = "http=web:80;https=secure:443;ftp=f:21;socks=s:1080";
        assert_eq!(proxies_for_list(list, &t("https://a.b/")), vec!["secure:443"]);
        assert_eq!(proxies_for_list(list, &t("http://a.b/")), vec!["web:80"]);
        assert_eq!(proxies_for_list(list, &t("wss://a.b/")), vec!["secure:443"]);
        assert!(proxies_for_list("http=web:80", &t("https://a.b/")).is_empty());
        assert!(proxies_for_list("socks=s:1080", &t("https://a.b/")).is_empty());
        assert!(proxies_for_list("socks5://s:1080", &t("https://a.b/")).is_empty());
    }

    #[test]
    fn bypass_rules() {
        let b = "<local>;*.school.lan;10.*;mastersat.uz:8443";
        assert!(bypassed(b, &t("http://intranet/")));
        assert!(bypassed(b, &t("http://localhost:3000/")));
        assert!(bypassed(b, &t("https://files.school.lan/")));
        assert!(bypassed(b, &t("http://10.1.2.3/")));
        assert!(bypassed(b, &t("https://mastersat.uz:8443/")));
        assert!(!bypassed(b, &t("https://mastersat.uz/")));
        assert!(!bypassed(b, &t("https://school.lan.evil.com/")));
        assert!(!bypassed("", &t("http://intranet/")));
        assert!(bypassed("*", &t("https://anything.example/")));
        assert!(bypassed("MASTERSAT.UZ", &t("https://mastersat.uz/")));
    }

    #[test]
    fn glob() {
        assert!(glob_match("*.a.b", "x.a.b"));
        assert!(glob_match("*.a.b", "y.x.a.b"));
        assert!(!glob_match("*.a.b", "a.b"));
        assert!(glob_match("a*c", "abbbc"));
        assert!(glob_match("a*", "a"));
        assert!(!glob_match("a", "ab"));
        assert!(glob_match("**", ""));
    }

    #[test]
    fn find_proxy_format() {
        assert_eq!(find_proxy_string(&[]), "DIRECT");
        assert_eq!(find_proxy_string(&["p:1".into()]), "PROXY p:1; DIRECT");
        assert_eq!(
            find_proxy_string(&["p:1".into(), "q:2".into()]),
            "PROXY p:1; PROXY q:2; DIRECT"
        );
        assert_eq!(find_proxy_string(&["DIRECT".into(), "p:1".into()]), "DIRECT");
        assert_eq!(
            find_proxy_string(&proxies_for_list("p:1;DIRECT;q:2", &t("https://a.b/"))),
            "PROXY p:1; DIRECT"
        );
    }

    #[test]
    fn static_decisions() {
        let target = t("https://mastersat.uz/api/");
        assert_eq!(static_decision("p:3128", "", &target), "PROXY p:3128; DIRECT");
        assert_eq!(static_decision("p:3128", "*.uz", &target), "DIRECT");
        assert_eq!(static_decision("", "", &target), "DIRECT");
    }

    #[cfg(not(windows))]
    #[test]
    fn other_hosts_are_direct_and_cached() {
        assert_eq!(proxy_for("https://mastersat.uz/api/desktop/v1/home").unwrap(), "DIRECT");
        assert_eq!(proxy_for("https://mastersat.uz/other").unwrap(), "DIRECT");
        assert_eq!(proxy_for("nope").unwrap_err().code, MS_ERR_ARG);
    }
}
