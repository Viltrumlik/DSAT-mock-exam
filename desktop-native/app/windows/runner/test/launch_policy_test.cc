// MasterSAT: tests for launch_policy (no framework; runs on Windows CI and the
// developer Mac):
//   clang++ -std=c++17 -I.. launch_policy_test.cc ../launch_policy.cpp && ./a.out
//   cl /std:c++17 /EHsc /I.. launch_policy_test.cc ..\launch_policy.cpp
#include "launch_policy.h"

#include <cstdio>
#include <string>

using namespace launch_policy;

static int g_failures = 0;
static int g_checks = 0;

#define CHECK(x)                                                    \
  do {                                                              \
    ++g_checks;                                                     \
    if (!(x)) {                                                     \
      ++g_failures;                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #x);      \
    }                                                               \
  } while (0)

static void LaunchUrls() {
  CHECK(IsLaunchUrl("mastersat://auth?code=abc123"));
  CHECK(IsLaunchUrl("MasterSAT://auth?code=abc123"));
  CHECK(!IsLaunchUrl("mastersat:"));
  CHECK(!IsLaunchUrl("https://mastersat.uz/"));
  CHECK(!IsLaunchUrl("--s1-harness"));
  CHECK(!IsLaunchUrl(""));
  CHECK(!IsLaunchUrl(std::string("mastersat://auth?code=a\nb")));
  CHECK(!IsLaunchUrl(std::string("mastersat://x\x7f")));
  CHECK(IsLaunchUrl("mastersat://" + std::string(kMaxLaunchUrlBytes - 12, 'a')));
  CHECK(!IsLaunchUrl("mastersat://" + std::string(kMaxLaunchUrlBytes - 11, 'a')));

  CHECK(!FindLaunchUrl({}).has_value());
  CHECK(!FindLaunchUrl({"--s1-harness"}).has_value());
  const auto found = FindLaunchUrl({"--flag", "mastersat://auth?code=1", "mastersat://b"});
  CHECK(found.has_value() && *found == "mastersat://auth?code=1");
}

static void CopyData() {
  const std::string url = "mastersat://auth?code=xyz";
  auto ok = DecodeCopyData(kCopyDataMagic, url.data(), url.size());
  CHECK(ok.has_value() && !ok->activate_only && ok->url == url);

  const std::string with_nul = url + std::string(1, '\0');
  ok = DecodeCopyData(kCopyDataMagic, with_nul.data(), with_nul.size());
  CHECK(ok.has_value() && ok->url == url);

  ok = DecodeCopyData(kCopyDataMagic, nullptr, 0);
  CHECK(ok.has_value() && ok->activate_only && ok->url.empty());

  CHECK(!DecodeCopyData(0x1234, url.data(), url.size()).has_value());
  const std::string bad = "https://evil.example/";
  CHECK(!DecodeCopyData(kCopyDataMagic, bad.data(), bad.size()).has_value());
  CHECK(!DecodeCopyData(kCopyDataMagic, nullptr, 5).has_value());
  const std::string huge(kMaxLaunchUrlBytes + 1, 'a');
  CHECK(!DecodeCopyData(kCopyDataMagic, huge.data(), huge.size()).has_value());
}

static void Geometry() {
  CHECK(ScaleForDpi(1000, 96) == 1000);
  CHECK(ScaleForDpi(1000, 120) == 1250);
  CHECK(ScaleForDpi(640, 144) == 960);
  CHECK(ScaleForDpi(100, 0) == 100);

  const Rect work{0, 0, 1920, 1040};
  CHECK(IsRestorableRect({100, 100, 1380, 900}, work, 96));
  CHECK(!IsRestorableRect({100, 100, 900, 700}, work, 96));      // too small
  CHECK(!IsRestorableRect({100, 100, 1380, 900}, work, 192));    // too small at 200 %
  CHECK(!IsRestorableRect({3000, 100, 4280, 900}, work, 96));    // other monitor gone
  CHECK(!IsRestorableRect({100, -500, 1380, 300}, work, 96));    // title bar above
  CHECK(IsRestorableRect({1800, 100, 3080, 900}, work, 96));     // 120 px still visible

  const Rect d = DefaultRect(work, 96);
  CHECK(d.right - d.left == kDefaultWidth && d.bottom - d.top == kDefaultHeight);
  CHECK(d.left == (1920 - kDefaultWidth) / 2 && d.top == (1040 - kDefaultHeight) / 2);
  const Rect small = DefaultRect({0, 0, 1366, 728}, 120);  // 1600x1000 > area
  CHECK(small.right - small.left == 1366 && small.bottom - small.top == 728);
}

static void Flags() {
  CHECK(HasFlag({"--s1-harness"}, kS1HarnessFlag));
  CHECK(!HasFlag({"--s1-harness=1"}, kS1HarnessFlag));
  CHECK(!HasFlag({}, kS1HarnessFlag));
  CHECK(HasFlag({"--s1-harness", "--impeller"}, kImpellerFlag));
  CHECK(!HasFlag({"--s1-harness"}, kImpellerFlag));
}

int main() {
  LaunchUrls();
  CopyData();
  Geometry();
  Flags();
  std::printf("launch_policy: %d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
