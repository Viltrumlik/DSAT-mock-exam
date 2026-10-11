// MasterSAT: see launch_policy.h.
#include "launch_policy.h"

#include <algorithm>
#include <cmath>

namespace launch_policy {

namespace {

constexpr std::string_view kScheme = "mastersat:";

bool StartsWithIgnoreCase(std::string_view text, std::string_view prefix) {
  if (text.size() < prefix.size()) {
    return false;
  }
  for (std::size_t i = 0; i < prefix.size(); ++i) {
    char c = text[i];
    if (c >= 'A' && c <= 'Z') {
      c = static_cast<char>(c - 'A' + 'a');
    }
    if (c != prefix[i]) {
      return false;
    }
  }
  return true;
}

}  // namespace

bool IsLaunchUrl(std::string_view text) {
  if (text.size() <= kScheme.size() || text.size() > kMaxLaunchUrlBytes) {
    return false;
  }
  if (!StartsWithIgnoreCase(text, kScheme)) {
    return false;
  }
  for (const char c : text) {
    const auto u = static_cast<unsigned char>(c);
    if (u < 0x20 || u == 0x7F) {
      return false;
    }
  }
  return true;
}

std::optional<std::string> FindLaunchUrl(const std::vector<std::string>& args) {
  for (const auto& arg : args) {
    if (IsLaunchUrl(arg)) {
      return arg;
    }
  }
  return std::nullopt;
}

std::optional<ForwardedLaunch> DecodeCopyData(std::uintptr_t magic,
                                              const void* data,
                                              std::size_t size) {
  if (magic != kCopyDataMagic || size > kMaxLaunchUrlBytes) {
    return std::nullopt;
  }
  if (size == 0) {
    return ForwardedLaunch{};
  }
  if (data == nullptr) {
    return std::nullopt;
  }
  std::string text(static_cast<const char*>(data), size);
  // Tolerate one trailing NUL from senders that include the terminator.
  if (!text.empty() && text.back() == '\0') {
    text.pop_back();
  }
  if (text.empty()) {
    return ForwardedLaunch{};
  }
  if (!IsLaunchUrl(text)) {
    return std::nullopt;
  }
  return ForwardedLaunch{false, std::move(text)};
}

int ScaleForDpi(int logical, unsigned int dpi) {
  if (dpi == 0) {
    dpi = 96;
  }
  return static_cast<int>(std::lround(static_cast<double>(logical) * dpi / 96.0));
}

bool IsRestorableRect(const Rect& window, const Rect& work_area,
                      unsigned int dpi) {
  const long width = window.right - window.left;
  const long height = window.bottom - window.top;
  if (width < ScaleForDpi(kMinWidth, dpi) ||
      height < ScaleForDpi(kMinHeight, dpi)) {
    return false;
  }
  const long overlap_w = std::min(window.right, work_area.right) -
                         std::max(window.left, work_area.left);
  const long overlap_h = std::min(window.bottom, work_area.bottom) -
                         std::max(window.top, work_area.top);
  // The title bar (top of the window) must be inside the work area too.
  const bool title_visible =
      window.top >= work_area.top && window.top < work_area.bottom;
  return title_visible && overlap_w >= ScaleForDpi(100, dpi) &&
         overlap_h >= ScaleForDpi(50, dpi);
}

Rect DefaultRect(const Rect& work_area, unsigned int dpi) {
  const long area_w = work_area.right - work_area.left;
  const long area_h = work_area.bottom - work_area.top;
  const long width = std::min<long>(ScaleForDpi(kDefaultWidth, dpi), area_w);
  const long height = std::min<long>(ScaleForDpi(kDefaultHeight, dpi), area_h);
  Rect r;
  r.left = work_area.left + (area_w - width) / 2;
  r.top = work_area.top + (area_h - height) / 2;
  r.right = r.left + width;
  r.bottom = r.top + height;
  return r;
}

bool HasFlag(const std::vector<std::string>& args, std::string_view flag) {
  return std::any_of(args.begin(), args.end(),
                     [flag](const std::string& a) { return a == flag; });
}

}  // namespace launch_policy
