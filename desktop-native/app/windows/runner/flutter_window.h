#ifndef RUNNER_FLUTTER_WINDOW_H_
#define RUNNER_FLUTTER_WINDOW_H_

#include <flutter/dart_project.h>
#include <flutter/encodable_value.h>
#include <flutter/flutter_view_controller.h>
#include <flutter/method_channel.h>

#include <deque>
#include <memory>
#include <optional>
#include <string>

#include "win32_window.h"

// A window that hosts the Flutter view, plus MasterSAT's two runner channels:
//
//  * MethodChannel("mastersat/launch")
//      native -> Dart  "open"     {"url": String}   a mastersat:// link (from a
//                                                    second launch, after Dart
//                                                    called takePending)
//                      "activate" null               a second launch without a
//                                                    link
//      Dart -> native  "takePending" -> List<String> links that arrived before
//                                                    Dart was listening (incl.
//                                                    the one this process was
//                                                    started with); marks Dart
//                                                    as ready
//                      "focusWindow" -> bool         restore + foreground
//  * MethodChannel("mastersat/power")
//      native -> Dart, the method is the event:
//        "suspending"     WM_POWERBROADCAST / PBT_APMSUSPEND
//        "resumed"        PBT_APMRESUMEAUTOMATIC (every resume; act on this)
//        "resumedByUser"  PBT_APMRESUMESUSPEND (after "resumed", user woke it)
//        "powerStatus"    PBT_APMPOWERSTATUSCHANGE (AC/battery changed)
//        "timeChanged"    WM_TIMECHANGE (the wall clock moved)
//        "displayChanged" WM_DISPLAYCHANGE (+ "width", "height")
//      arguments: {"event": <same name>, "wallClockMs": int, "tickMs": int}
//      (GetTickCount64 counts through sleep; receivers may ignore them).
//
// Only links (launch_policy::IsLaunchUrl) cross the channel; Dart decides what
// they mean (architecture §6: only mastersat://auth?code= is acted on, and
// during lockdown links are queued).
class FlutterWindow : public Win32Window {
 public:
  // Creates a new FlutterWindow hosting a Flutter view running |project|.
  // |initial_url| is the mastersat:// link this process was started with.
  FlutterWindow(const flutter::DartProject& project,
                std::optional<std::string> initial_url = std::nullopt);
  virtual ~FlutterWindow();

 protected:
  // Win32Window:
  bool OnCreate() override;
  void OnDestroy() override;
  LRESULT MessageHandler(HWND window, UINT const message, WPARAM const wparam,
                         LPARAM const lparam) noexcept override;

 private:
  using Channel = flutter::MethodChannel<flutter::EncodableValue>;

  void SetUpChannels();
  void DeliverLaunchUrl(const std::string& url);
  void SendPowerEvent(const char* event, std::optional<int> width = std::nullopt,
                      std::optional<int> height = std::nullopt);

  // The project to run.
  flutter::DartProject project_;

  // The Flutter instance hosted by this window.
  std::unique_ptr<flutter::FlutterViewController> flutter_controller_;

  std::unique_ptr<Channel> launch_channel_;
  std::unique_ptr<Channel> power_channel_;

  // Links that arrived before Dart called takePending (bounded).
  std::deque<std::string> pending_urls_;
  bool dart_listening_ = false;
};

#endif  // RUNNER_FLUTTER_WINDOW_H_
