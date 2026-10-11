#include "flutter_window.h"

#include <flutter/standard_method_codec.h>

#include <chrono>
#include <optional>
#include <utility>

#include "flutter/generated_plugin_registrant.h"
#include "launch_policy.h"

#if defined(MS_HAVE_NATIVE)
#include "mastersat_native.h"
#endif

#ifndef MS_APP_VERSION
#define MS_APP_VERSION "0.0.0"
#endif

namespace {

// At most this many links wait for Dart; older ones are dropped first.
constexpr size_t kMaxPendingUrls = 8;

int64_t WallClockMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

}  // namespace

FlutterWindow::FlutterWindow(const flutter::DartProject& project,
                             std::optional<std::string> initial_url)
    : project_(project) {
  if (initial_url.has_value()) {
    pending_urls_.push_back(std::move(*initial_url));
  }
}

FlutterWindow::~FlutterWindow() {}

bool FlutterWindow::OnCreate() {
  if (!Win32Window::OnCreate()) {
    return false;
  }

#if defined(MS_HAVE_NATIVE)
  // MasterSAT: hand the window to mastersat_native.dll before Dart runs
  // (keyboard guard installed idle, 1 s watchdog started; mastersat_native.h).
  ms_init(reinterpret_cast<intptr_t>(GetHandle()), MS_APP_VERSION);
#endif

  RECT frame = GetClientArea();

  // The size here must match the window dimensions to avoid unnecessary surface
  // creation / destruction in the startup path.
  flutter_controller_ = std::make_unique<flutter::FlutterViewController>(
      frame.right - frame.left, frame.bottom - frame.top, project_);
  // Ensure that basic setup of the controller was successful.
  if (!flutter_controller_->engine() || !flutter_controller_->view()) {
    return false;
  }
  RegisterPlugins(flutter_controller_->engine());
  SetUpChannels();
  SetChildContent(flutter_controller_->view()->GetNativeWindow());

  // The window stays hidden until Flutter has drawn its first frame: no empty
  // or white window (architecture §2.3).
  flutter_controller_->engine()->SetNextFrameCallback([&]() {
    this->Show();
  });

  // Flutter can complete the first frame before the "show window" callback is
  // registered. The following call ensures a frame is pending to ensure the
  // window is shown. It is a no-op if the first frame hasn't completed yet.
  flutter_controller_->ForceRedraw();

  return true;
}

void FlutterWindow::SetUpChannels() {
  auto* messenger = flutter_controller_->engine()->messenger();
  const auto& codec = flutter::StandardMethodCodec::GetInstance();

  launch_channel_ =
      std::make_unique<Channel>(messenger, "mastersat/launch", &codec);
  launch_channel_->SetMethodCallHandler(
      [this](const flutter::MethodCall<flutter::EncodableValue>& call,
             std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>>
                 result) {
        if (call.method_name() == "takePending") {
          flutter::EncodableList urls;
          for (const auto& url : pending_urls_) {
            urls.emplace_back(url);
          }
          pending_urls_.clear();
          dart_listening_ = true;
          result->Success(flutter::EncodableValue(std::move(urls)));
          return;
        }
        if (call.method_name() == "focusWindow") {
          BringToFront();
          result->Success(flutter::EncodableValue(true));
          return;
        }
        result->NotImplemented();
      });

  power_channel_ =
      std::make_unique<Channel>(messenger, "mastersat/power", &codec);
}

void FlutterWindow::DeliverLaunchUrl(const std::string& url) {
  if (dart_listening_ && launch_channel_) {
    launch_channel_->InvokeMethod(
        "open", std::make_unique<flutter::EncodableValue>(flutter::EncodableMap{
                    {flutter::EncodableValue("url"),
                     flutter::EncodableValue(url)},
                }));
    return;
  }
  if (pending_urls_.size() >= kMaxPendingUrls) {
    pending_urls_.pop_front();
  }
  pending_urls_.push_back(url);
}

void FlutterWindow::SendPowerEvent(const char* event, std::optional<int> width,
                                   std::optional<int> height) {
  if (!power_channel_) {
    return;
  }
  flutter::EncodableMap payload{
      {flutter::EncodableValue("event"), flutter::EncodableValue(event)},
      {flutter::EncodableValue("wallClockMs"),
       flutter::EncodableValue(WallClockMs())},
      {flutter::EncodableValue("tickMs"),
       flutter::EncodableValue(static_cast<int64_t>(GetTickCount64()))},
  };
  if (width.has_value() && height.has_value()) {
    payload[flutter::EncodableValue("width")] = flutter::EncodableValue(*width);
    payload[flutter::EncodableValue("height")] =
        flutter::EncodableValue(*height);
  }
  power_channel_->InvokeMethod(
      "event", std::make_unique<flutter::EncodableValue>(std::move(payload)));
}

void FlutterWindow::OnDestroy() {
  launch_channel_ = nullptr;
  power_channel_ = nullptr;
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }

  Win32Window::OnDestroy();
}

LRESULT
FlutterWindow::MessageHandler(HWND hwnd, UINT const message,
                              WPARAM const wparam,
                              LPARAM const lparam) noexcept {
  // Give Flutter, including plugins, an opportunity to handle window messages.
  if (flutter_controller_) {
    std::optional<LRESULT> result =
        flutter_controller_->HandleTopLevelWindowProc(hwnd, message, wparam,
                                                      lparam);
    if (result) {
      return *result;
    }
  }

  switch (message) {
    case WM_FONTCHANGE:
      flutter_controller_->engine()->ReloadSystemFonts();
      break;

    case WM_COPYDATA: {
      // MasterSAT: a second launch forwarding its link (single_instance.cpp).
      const auto* data = reinterpret_cast<const COPYDATASTRUCT*>(lparam);
      if (data == nullptr) {
        return FALSE;
      }
      const auto launch = launch_policy::DecodeCopyData(
          static_cast<std::uintptr_t>(data->dwData), data->lpData,
          data->cbData);
      if (!launch.has_value()) {
        return FALSE;
      }
      if (launch->activate_only) {
        if (launch_channel_ && dart_listening_) {
          launch_channel_->InvokeMethod("activate", nullptr);
        }
      } else {
        DeliverLaunchUrl(launch->url);
      }
      BringToFront();
      return TRUE;
    }

    case WM_POWERBROADCAST:
      switch (wparam) {
        case PBT_APMSUSPEND:
          SendPowerEvent("suspend");
          break;
        case PBT_APMRESUMESUSPEND:
          SendPowerEvent("resume");
          break;
        case PBT_APMRESUMEAUTOMATIC:
          SendPowerEvent("resumeAutomatic");
          break;
        case PBT_APMPOWERSTATUSCHANGE:
          SendPowerEvent("powerStatus");
          break;
      }
      return TRUE;

    case WM_TIMECHANGE:
      SendPowerEvent("timeChanged");
      return 0;

    case WM_DISPLAYCHANGE:
      SendPowerEvent("displayChanged", static_cast<int>(LOWORD(lparam)),
                     static_cast<int>(HIWORD(lparam)));
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}
