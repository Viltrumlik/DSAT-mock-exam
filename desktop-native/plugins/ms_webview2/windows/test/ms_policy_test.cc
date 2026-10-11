// MasterSAT patch: unit tests for the island security policy (ms_policy.h).
#include "../ms_policy.h"

#include <gtest/gtest.h>

using namespace ms_policy;

TEST(MsPolicy, SchemeOf) {
  EXPECT_EQ(SchemeOf(L"https://island.mastersat.example/content.html"), L"https");
  EXPECT_EQ(SchemeOf(L"HTTPS://x/"), L"https");
  EXPECT_EQ(SchemeOf(L"about:blank"), L"about");
  EXPECT_EQ(SchemeOf(L"blob:https://island.mastersat.example/uuid"), L"blob");
  EXPECT_EQ(SchemeOf(L""), L"");
  EXPECT_EQ(SchemeOf(L":nope"), L"");
  EXPECT_EQ(SchemeOf(L"1http://x/"), L"");
  EXPECT_EQ(SchemeOf(L"no-colon"), L"");
}

TEST(MsPolicy, HostOf) {
  EXPECT_EQ(HostOf(L"https://island.mastersat.example/content.html"),
            L"island.mastersat.example");
  EXPECT_EQ(HostOf(L"https://ISLAND.MasterSAT.example/x"), L"island.mastersat.example");
  EXPECT_EQ(HostOf(L"https://www.desmos.com:443/api/v1.11/calculator.js"), L"www.desmos.com");
  EXPECT_EQ(HostOf(L"https://island.mastersat.example?x"), L"island.mastersat.example");
  EXPECT_EQ(HostOf(L"https://user@island.mastersat.example/"), L"");
  EXPECT_EQ(HostOf(L"https://[::1]/"), L"");
  EXPECT_EQ(HostOf(L"about:blank"), L"");
  EXPECT_EQ(HostOf(L"https:/island.mastersat.example/"), L"");
  EXPECT_EQ(HostOf(L"https://"), L"");
}

TEST(MsPolicy, HostMatches) {
  EXPECT_TRUE(HostMatches(L"www.desmos.com", L"www.desmos.com"));
  EXPECT_TRUE(HostMatches(L"WWW.Desmos.com", L"www.desmos.com"));
  EXPECT_TRUE(HostMatches(L"saved-work.desmos.com", L"*.desmos.com"));
  EXPECT_FALSE(HostMatches(L"desmos.com", L"*.desmos.com"));
  EXPECT_FALSE(HostMatches(L"evildesmos.com", L"*.desmos.com"));
  EXPECT_FALSE(HostMatches(L"desmos.com.evil.net", L"*.desmos.com"));
  EXPECT_FALSE(HostMatches(L"", L"*.desmos.com"));
  EXPECT_FALSE(HostMatches(L"a.b", L""));
}

TEST(MsPolicy, Navigation) {
  EXPECT_TRUE(IsAllowedNavigation(L"https://island.mastersat.example/content.html"));
  EXPECT_TRUE(IsAllowedNavigation(L"https://island.mastersat.example/desmos.html?x=1#y"));
  EXPECT_TRUE(IsAllowedNavigation(L"HTTPS://ISLAND.MASTERSAT.EXAMPLE/content.html"));
  EXPECT_FALSE(IsAllowedNavigation(L"https://island.mastersat.example"));  // no path
  EXPECT_FALSE(IsAllowedNavigation(L"http://island.mastersat.example/content.html"));
  EXPECT_FALSE(IsAllowedNavigation(L"https://island.mastersat.example.evil.com/"));
  EXPECT_FALSE(IsAllowedNavigation(L"https://island.mastersat.example@evil.com/"));
  EXPECT_FALSE(IsAllowedNavigation(L"https://island.mastersat.example:8443/"));
  EXPECT_FALSE(IsAllowedNavigation(L"https://mastersat.uz/"));
  EXPECT_FALSE(IsAllowedNavigation(L"about:blank"));
  EXPECT_FALSE(IsAllowedNavigation(L"file:///C:/Windows/win.ini"));
  EXPECT_FALSE(IsAllowedNavigation(L"javascript:alert(1)"));
  EXPECT_FALSE(IsAllowedNavigation(L"mailto:x@y.z"));
  EXPECT_FALSE(IsAllowedNavigation(L"data:text/html,hi"));
  EXPECT_FALSE(IsAllowedNavigation(L""));
}

TEST(MsPolicy, FrameNavigation) {
  EXPECT_TRUE(IsAllowedFrameNavigation(L"about:blank"));
  EXPECT_TRUE(IsAllowedFrameNavigation(L"about:srcdoc"));
  EXPECT_TRUE(IsAllowedFrameNavigation(L"https://island.mastersat.example/x.html"));
  EXPECT_FALSE(IsAllowedFrameNavigation(L"https://www.desmos.com/"));
  EXPECT_FALSE(IsAllowedFrameNavigation(L"about:settings"));
}

TEST(MsPolicy, Resources) {
  const std::vector<std::wstring> none;
  const std::vector<std::wstring> desmos = {L"www.desmos.com", L"*.desmos.com"};
  EXPECT_TRUE(IsAllowedResource(L"https://island.mastersat.example/assets/a.js", none));
  EXPECT_TRUE(IsAllowedResource(L"blob:https://island.mastersat.example/1-2-3", none));
  EXPECT_TRUE(IsAllowedResource(L"data:image/png;base64,AAAA", none));
  EXPECT_TRUE(IsAllowedResource(L"about:blank", none));
  EXPECT_FALSE(IsAllowedResource(L"https://www.desmos.com/api/v1.11/calculator.js", none));
  EXPECT_TRUE(IsAllowedResource(L"https://www.desmos.com/api/v1.11/calculator.js", desmos));
  EXPECT_TRUE(IsAllowedResource(L"https://fonts.desmos.com/x.woff2", desmos));
  EXPECT_FALSE(IsAllowedResource(L"http://www.desmos.com/api/v1.11/calculator.js", desmos));
  EXPECT_FALSE(IsAllowedResource(L"https://mastersat.uz/api/desktop/v1/home/", desmos));
  EXPECT_FALSE(IsAllowedResource(L"https://evil.com/?https://island.mastersat.example/", none));
  EXPECT_FALSE(IsAllowedResource(L"wss://www.desmos.com/", desmos));
  EXPECT_FALSE(IsAllowedResource(L"file:///C:/x", none));
  EXPECT_FALSE(IsAllowedResource(L"", none));
}
