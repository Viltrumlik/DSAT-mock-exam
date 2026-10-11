// MasterSAT: see window_placement.h.
#include "window_placement.h"

#include <flutter_windows.h>

#include "launch_policy.h"

namespace window_placement {

namespace {

constexpr wchar_t kKey[] = L"Software\\MasterSAT\\Exam";
constexpr wchar_t kValue[] = L"WindowPlacement";

launch_policy::Rect ToRect(const RECT& r) {
  return {r.left, r.top, r.right, r.bottom};
}

}  // namespace

std::optional<WINDOWPLACEMENT> Load() {
  WINDOWPLACEMENT placement{};
  DWORD size = sizeof(placement);
  DWORD type = 0;
  if (RegGetValueW(HKEY_CURRENT_USER, kKey, kValue, RRF_RT_REG_BINARY, &type,
                   &placement, &size) != ERROR_SUCCESS ||
      size != sizeof(placement) || placement.length != sizeof(placement)) {
    return std::nullopt;
  }
  // rcNormalPosition is in workspace coordinates; the monitor it lands on
  // decides the DPI and the work area it must still fit.
  HMONITOR monitor =
      MonitorFromRect(&placement.rcNormalPosition, MONITOR_DEFAULTTONULL);
  if (monitor == nullptr) {
    return std::nullopt;
  }
  MONITORINFO info{};
  info.cbSize = sizeof(info);
  if (!GetMonitorInfoW(monitor, &info)) {
    return std::nullopt;
  }
  // Workspace coordinates are relative to the work area of the primary
  // monitor; compare against the target monitor's work area in the same
  // frame (they coincide unless the taskbar is on the left or top).
  RECT work = info.rcWork;
  const UINT dpi = FlutterDesktopGetDpiForMonitor(monitor);
  if (!launch_policy::IsRestorableRect(ToRect(placement.rcNormalPosition),
                                       ToRect(work), dpi) &&
      !launch_policy::IsRestorableRect(ToRect(placement.rcNormalPosition),
                                       ToRect(info.rcMonitor), dpi)) {
    return std::nullopt;
  }
  placement.flags = 0;
  return placement;
}

void Save(HWND hwnd) {
  if (hwnd == nullptr || !IsWindowVisible(hwnd)) {
    return;
  }
  const LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_STYLE);
  if ((style & WS_CAPTION) != WS_CAPTION) {
    return;
  }
  WINDOWPLACEMENT placement{};
  placement.length = sizeof(placement);
  if (!GetWindowPlacement(hwnd, &placement)) {
    return;
  }
  if (placement.showCmd == SW_SHOWMINIMIZED || placement.showCmd == SW_MINIMIZE) {
    placement.showCmd = (placement.flags & WPF_RESTORETOMAXIMIZED)
                            ? SW_SHOWMAXIMIZED
                            : SW_SHOWNORMAL;
  }
  RegSetKeyValueW(HKEY_CURRENT_USER, kKey, kValue, REG_BINARY, &placement,
                  sizeof(placement));
}

}  // namespace window_placement
