// MasterSAT: remembers the window's size, position and maximised state
// between launches (architecture §6, "Size and position are remembered").
//
// Stored per user in HKCU\Software\MasterSAT\Exam, value "WindowPlacement"
// (a WINDOWPLACEMENT), so it survives Velopack updates. A remembered rectangle
// is used only while it is still at least the minimum size and still reachable
// on a connected monitor (launch_policy::IsRestorableRect).
#ifndef RUNNER_WINDOW_PLACEMENT_H_
#define RUNNER_WINDOW_PLACEMENT_H_

#include <windows.h>

#include <optional>

namespace window_placement {

// The remembered placement, or nullopt when there is none or it no longer
// fits any connected monitor.
std::optional<WINDOWPLACEMENT> Load();

// Saves |hwnd|'s placement. Skipped while the window is borderless
// (lockdown's fullscreen): that rectangle is not the student's window.
void Save(HWND hwnd);

// |hwnd|'s normal (restored) rectangle in workspace coordinates, physical
// pixels, and whether it is maximised; nullopt while borderless (lockdown) or
// minimised-and-unknown.
struct Placement {
  RECT normal{};
  bool maximized = false;
};
std::optional<Placement> Current(HWND hwnd);

// Applies a placement Dart remembered (MethodChannel 'mastersat/window'),
// with the same rule as Load: only when the rectangle is at least the minimum
// size and reachable on a connected monitor, and never while borderless.
// Returns true when applied.
bool Apply(HWND hwnd, const Placement& placement);

}  // namespace window_placement

#endif  // RUNNER_WINDOW_PLACEMENT_H_
