#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <windows.h>

#include <optional>
#include <string>
#include <vector>

#include "flutter_window.h"
#include "launch_policy.h"
#include "single_instance.h"
#include "utils.h"

#if defined(MS_HAVE_NATIVE)
#include "mastersat_native.h"
#endif

int APIENTRY wWinMain(_In_ HINSTANCE instance, _In_opt_ HINSTANCE prev,
                      _In_ wchar_t *command_line, _In_ int show_command) {
  // MasterSAT, architecture §6: Velopack's install/update/uninstall hooks run
  // first, before anything else; on a hook ms_startup exits the process.
  std::vector<std::string> argv_utf8 = GetCommandLineArgumentsWithProgram();
#if defined(MS_HAVE_NATIVE)
  {
    std::vector<const char *> argv;
    argv.reserve(argv_utf8.size());
    for (const auto &arg : argv_utf8) {
      argv.push_back(arg.c_str());
    }
    ms_startup(static_cast<int32_t>(argv.size()), argv.data());
  }
#endif

  std::vector<std::string> command_line_arguments;
  if (argv_utf8.size() > 1) {
    command_line_arguments.assign(argv_utf8.begin() + 1, argv_utf8.end());
  }
  const std::optional<std::string> launch_url =
      launch_policy::FindLaunchUrl(command_line_arguments);
  const bool s1_harness = launch_policy::HasFlag(
      command_line_arguments, launch_policy::kS1HarnessFlag);

  // One app per session: a second launch hands its link to the running window
  // and exits. The S1 diagnostics harness may run beside the app.
  SingleInstance single_instance;
  if (!s1_harness && !single_instance.Acquire()) {
    SingleInstance::ForwardToRunning(launch_url);
    return EXIT_SUCCESS;
  }

  // Attach to console when present (e.g., 'flutter run') or create a
  // new console when running with a debugger.
  if (!::AttachConsole(ATTACH_PARENT_PROCESS) && ::IsDebuggerPresent()) {
    CreateAndAttachConsole();
  }

  // Initialize COM, so that it is available for use in the library and/or
  // plugins.
  ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  flutter::DartProject project(L"data");

  project.set_dart_entrypoint_arguments(command_line_arguments);

  FlutterWindow window(project, launch_url);
  Win32Window::Point origin(10, 10);
  Win32Window::Size size(launch_policy::kDefaultWidth,
                         launch_policy::kDefaultHeight);
  if (!window.Create(L"MasterSAT", origin, size)) {
    return EXIT_FAILURE;
  }
  window.SetQuitOnClose(true);

  ::MSG msg;
  while (::GetMessage(&msg, nullptr, 0, 0)) {
    ::TranslateMessage(&msg);
    ::DispatchMessage(&msg);
  }

  ::CoUninitialize();
  return EXIT_SUCCESS;
}
