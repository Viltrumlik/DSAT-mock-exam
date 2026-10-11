// MasterSAT: the pure rules behind single-instance launches, deep links and
// the window's size. No Windows headers, so runner/test/launch_policy_test.cc
// runs on any platform (CI and the developer Mac).
#ifndef RUNNER_LAUNCH_POLICY_H_
#define RUNNER_LAUNCH_POLICY_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace launch_policy {

// The named mutex that marks the running instance (architecture §6).
inline constexpr wchar_t kInstanceMutexName[] = L"Local\\MasterSAT.Exam";

// The top-level window class a second launch looks for.
inline constexpr wchar_t kWindowClassName[] = L"MasterSATWindow";

// COPYDATASTRUCT.dwData of a forwarded launch ("MSAT").
inline constexpr std::uintptr_t kCopyDataMagic = 0x4D534154;

// The longest forwarded URL, in bytes. An auth code link is ~100 bytes.
inline constexpr std::size_t kMaxLaunchUrlBytes = 2048;

// Minimum window size in logical pixels (architecture §6).
inline constexpr int kMinWidth = 1000;
inline constexpr int kMinHeight = 640;

// Default window size in logical pixels when nothing was remembered.
inline constexpr int kDefaultWidth = 1280;
inline constexpr int kDefaultHeight = 800;

// True for a `mastersat:` link the app may be handed: the scheme matches
// (case-insensitively), the text is at most kMaxLaunchUrlBytes and holds no
// control characters. Dart decides what the link means (only
// mastersat://auth?code= is acted on).
bool IsLaunchUrl(std::string_view text);

// The first argument that IsLaunchUrl accepts (Windows passes the link as
// "%1"), or nullopt.
std::optional<std::string> FindLaunchUrl(const std::vector<std::string>& args);

// A forwarded launch from a second instance. `activate_only` is true when the
// second launch carried no link (the student double-clicked the shortcut).
struct ForwardedLaunch {
  bool activate_only = true;
  std::string url;
};

// Decodes WM_COPYDATA: nullopt unless |magic| is kCopyDataMagic and the
// payload is empty (activate) or a UTF-8 link IsLaunchUrl accepts.
std::optional<ForwardedLaunch> DecodeCopyData(std::uintptr_t magic,
                                              const void* data,
                                              std::size_t size);

// Logical pixels -> physical pixels at |dpi| (96 = 100 %), rounded.
int ScaleForDpi(int logical, unsigned int dpi);

// A remembered window rectangle is restored only if it is at least the
// minimum size at |dpi| and overlaps the work area by at least a 100 x 50
// logical-pixel grab handle (so the title bar can be reached).
struct Rect {
  long left = 0;
  long top = 0;
  long right = 0;
  long bottom = 0;
};
bool IsRestorableRect(const Rect& window, const Rect& work_area,
                      unsigned int dpi);

// Centres a default-size window (clamped to the work area) on |work_area|.
Rect DefaultRect(const Rect& work_area, unsigned int dpi);

// Command-line flags the runner understands before Dart starts.
inline constexpr std::string_view kS1HarnessFlag = "--s1-harness";
bool HasFlag(const std::vector<std::string>& args, std::string_view flag);

}  // namespace launch_policy

#endif  // RUNNER_LAUNCH_POLICY_H_
