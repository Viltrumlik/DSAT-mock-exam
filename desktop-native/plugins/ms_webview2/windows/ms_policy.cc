// MasterSAT patch (not in upstream webview_flutter_windows). See ms_policy.h.
#include "ms_policy.h"

namespace ms_policy {

std::wstring AsciiLower(std::wstring_view s) {
  std::wstring out(s);
  for (auto& c : out) {
    if (c >= L'A' && c <= L'Z') {
      c = static_cast<wchar_t>(c - L'A' + L'a');
    }
  }
  return out;
}

std::wstring SchemeOf(std::wstring_view uri) {
  const auto colon = uri.find(L':');
  if (colon == std::wstring_view::npos || colon == 0) {
    return {};
  }
  // RFC 3986: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
  for (size_t i = 0; i < colon; ++i) {
    const wchar_t c = uri[i];
    const bool alpha = (c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z');
    const bool digit = c >= L'0' && c <= L'9';
    if (!(alpha || (i > 0 && (digit || c == L'+' || c == L'-' || c == L'.')))) {
      return {};
    }
  }
  return AsciiLower(uri.substr(0, colon));
}

std::wstring HostOf(std::wstring_view uri) {
  const auto scheme = SchemeOf(uri);
  if (scheme.empty()) {
    return {};
  }
  const auto rest = uri.substr(scheme.size() + 1);
  if (rest.size() < 2 || rest[0] != L'/' || rest[1] != L'/') {
    return {};
  }
  const auto authority_start = rest.substr(2);
  const auto end = authority_start.find_first_of(L"/?#\\");
  const auto authority = authority_start.substr(0, end);
  if (authority.empty() || authority.find(L'@') != std::wstring_view::npos) {
    return {};
  }
  // IPv6 literals are never allowed hosts; treat them as malformed.
  if (authority[0] == L'[') {
    return {};
  }
  const auto colon = authority.find(L':');
  const auto host = authority.substr(0, colon);
  if (host.empty()) {
    return {};
  }
  return AsciiLower(host);
}

bool HostMatches(std::wstring_view host, std::wstring_view pattern) {
  if (host.empty() || pattern.empty()) {
    return false;
  }
  const auto h = AsciiLower(host);
  const auto p = AsciiLower(pattern);
  if (p.size() > 2 && p[0] == L'*' && p[1] == L'.') {
    const std::wstring_view suffix = std::wstring_view(p).substr(1);  // ".desmos.com"
    return h.size() > suffix.size() &&
           std::wstring_view(h).substr(h.size() - suffix.size()) == suffix;
  }
  return h == p;
}

namespace {

bool IsIslandHttps(std::wstring_view uri) {
  return SchemeOf(uri) == L"https" && HostOf(uri) == kIslandHost;
}

// "https://island.mastersat.example/..." with nothing between the host and the
// first '/' (no port, no user info).
bool StartsWithIslandOrigin(std::wstring_view uri) {
  if (uri.size() < kIslandOrigin.size()) {
    return false;
  }
  return AsciiLower(uri.substr(0, kIslandOrigin.size())) == kIslandOrigin;
}

}  // namespace

bool IsAllowedNavigation(std::wstring_view uri) {
  return StartsWithIslandOrigin(uri) && IsIslandHttps(uri);
}

bool IsAllowedFrameNavigation(std::wstring_view uri) {
  if (IsAllowedNavigation(uri)) {
    return true;
  }
  const auto lower = AsciiLower(uri);
  return lower == L"about:blank" || lower == L"about:srcdoc";
}

bool IsAllowedResource(std::wstring_view uri,
                       const std::vector<std::wstring>& extra_hosts) {
  const auto scheme = SchemeOf(uri);
  if (scheme == L"blob" || scheme == L"data" || scheme == L"about") {
    return true;
  }
  if (scheme != L"https") {
    return false;
  }
  const auto host = HostOf(uri);
  if (host.empty()) {
    return false;
  }
  if (host == kIslandHost) {
    return true;
  }
  for (const auto& pattern : extra_hosts) {
    if (HostMatches(host, pattern)) {
      return true;
    }
  }
  return false;
}

}  // namespace ms_policy
