// MasterSAT patch (not in upstream webview_flutter_windows).
//
// The island security policy: which URLs a WebView2 island may navigate to and
// which resources it may load. Kept free of Windows headers so the rules are
// unit-tested on any platform (windows/test/ms_policy_test.cc).
//
// Architecture §2.5:
//  * NavigationStarting allows only https://island.mastersat.example/...;
//    everything else is cancelled.
//  * Frames may additionally show about:blank / about:srcdoc.
//  * WebResourceRequested allows the island host, blob:, data: and about:, plus
//    the hosts the app adds for one island (the Desmos island adds
//    www.desmos.com and *.desmos.com); everything else gets a 403.
#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace ms_policy {

// The virtual host the island folder is mapped to.
inline constexpr std::wstring_view kIslandHost = L"island.mastersat.example";

// Every allowed top-level navigation starts with this (scheme + host + '/').
inline constexpr std::wstring_view kIslandOrigin =
    L"https://island.mastersat.example/";

// Lower-cases ASCII letters (URL schemes and host names are ASCII after IDNA).
std::wstring AsciiLower(std::wstring_view s);

// The lower-cased scheme of |uri| (without ':'), or "" when there is none.
std::wstring SchemeOf(std::wstring_view uri);

// The lower-cased host of a hierarchical |uri| (scheme://host[:port]/...), or ""
// when |uri| has no authority, has user info (user@host) or is malformed.
std::wstring HostOf(std::wstring_view uri);

// True when |host| matches |pattern|: an exact host ("www.desmos.com") or a
// wildcard for subdomains only ("*.desmos.com" matches "a.desmos.com", not
// "desmos.com" and not "evildesmos.com").
bool HostMatches(std::wstring_view host, std::wstring_view pattern);

// Top-level navigation: only pages under https://island.mastersat.example/.
bool IsAllowedNavigation(std::wstring_view uri);

// Frame navigation: the island origin plus about:blank and about:srcdoc.
bool IsAllowedFrameNavigation(std::wstring_view uri);

// A sub-resource request: the island host (https), blob:, data:, about:, or an
// https host matching one of |extra_hosts|.
bool IsAllowedResource(std::wstring_view uri,
                       const std::vector<std::wstring>& extra_hosts);

}  // namespace ms_policy
