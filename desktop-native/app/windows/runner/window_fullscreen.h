// MasterSAT: More -> Full screen on a past paper (architecture §7 #10).
//
// Borderless full screen over the window's monitor, and back to exactly the
// placement it had (style, size, position, maximised). Driven from Dart over
// MethodChannel("mastersat/window") "setFullscreen" {on: bool} -> bool.
//
// Refused (false) while the window is already borderless: a midterm's
// lockdown (mastersat_native.dll's ms_lock_enter) owns the window then.
// window_placement never saves the borderless rectangle (it skips windows
// without a caption), so the remembered size stays the student's own.
#ifndef RUNNER_WINDOW_FULLSCREEN_H_
#define RUNNER_WINDOW_FULLSCREEN_H_

#include <windows.h>

namespace window_fullscreen {

// What Enter() changed, for Exit() to put back.
struct Saved {
  LONG_PTR style = 0;
  WINDOWPLACEMENT placement{};
};

// Makes |hwnd| borderless over its monitor. Fills |saved|. False (nothing
// changed) when the window has no caption already or a query fails.
bool Enter(HWND hwnd, Saved* saved);

// Restores what Enter() saved. False when |saved| is empty.
bool Exit(HWND hwnd, const Saved& saved);

}  // namespace window_fullscreen

#endif  // RUNNER_WINDOW_FULLSCREEN_H_
