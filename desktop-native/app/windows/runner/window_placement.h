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

}  // namespace window_placement

#endif  // RUNNER_WINDOW_PLACEMENT_H_
