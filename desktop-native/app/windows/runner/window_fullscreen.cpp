// MasterSAT: see window_fullscreen.h.
#include "window_fullscreen.h"

namespace window_fullscreen {

bool Enter(HWND hwnd, Saved* saved) {
  if (hwnd == nullptr || saved == nullptr) {
    return false;
  }
  const LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_STYLE);
  if ((style & WS_CAPTION) != WS_CAPTION) {
    return false;
  }
  WINDOWPLACEMENT placement{};
  placement.length = sizeof(placement);
  if (!GetWindowPlacement(hwnd, &placement)) {
    return false;
  }
  MONITORINFO monitor{};
  monitor.cbSize = sizeof(monitor);
  if (!GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST),
                       &monitor)) {
    return false;
  }
  saved->style = style;
  saved->placement = placement;
  SetWindowLongPtrW(hwnd, GWL_STYLE, style & ~WS_OVERLAPPEDWINDOW);
  const RECT& r = monitor.rcMonitor;
  SetWindowPos(hwnd, HWND_TOP, r.left, r.top, r.right - r.left,
               r.bottom - r.top, SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
  return true;
}

bool Exit(HWND hwnd, const Saved& saved) {
  if (hwnd == nullptr || saved.style == 0) {
    return false;
  }
  SetWindowLongPtrW(hwnd, GWL_STYLE, saved.style);
  WINDOWPLACEMENT placement = saved.placement;
  placement.length = sizeof(placement);
  SetWindowPlacement(hwnd, &placement);
  SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER |
                   SWP_FRAMECHANGED);
  return true;
}

}  // namespace window_fullscreen
