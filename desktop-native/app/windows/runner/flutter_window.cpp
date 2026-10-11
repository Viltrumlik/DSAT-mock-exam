#include "flutter_window.h"

#include <flutter/standard_method_codec.h>

#include <chrono>
#include <cmath>
#include <optional>
#include <utility>
#include <variant>

#include "flutter/generated_plugin_registrant.h"
#include "launch_policy.h"
#include "window_placement.h"

#if defined(MS_HAVE_NATIVE)
#include "mastersat_native.h"
#endif

#ifndef MS_APP_VERSION
#define MS_APP_VERSION "0.0.0"
#endif

namespace {

// At most this many links wait for Dart; older ones are dropped first.
constexpr size_t kMaxPendingUrls = 8;

// A number from a StandardMethodCodec map (Dart ints arrive as int32/int64,
// doubles as double).
std::optional<double> NumberAt(const flutter::EncodableMap& map,
                               const char* key) {
  const auto it = map.find(flutter::EncodableValue(key));
  if (it == map.end()) {
    return std::nullopt;
  }
  const flutter::EncodableValue& v = it->second;
  if (const auto* d = std::get_if<double>(&v)) {
    return *d;
  }
  if (const auto* i = std::get_if<int32_t>(&v)) {
    return static_cast<double>(*i);
  }
  if (const auto* l = std::get_if<int64_t>(&v)) {
    return static_cast<double>(*l);
  }
  return std::nullopt;
}

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

  window_channel_ =
      std::make_unique<Channel>(messenger, "mastersat/window", &codec);
  window_channel_->SetMethodCallHandler(
      [this](const flutter::MethodCall<flutter::EncodableValue>& call,
             std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>>
                 result) {
        if (call.method_name() != "restorePlacement") {
          result->NotImplemented();
          return;
        }
        const auto* args = std::get_if<flutter::EncodableMap>(call.arguments());
        if (args == nullptr) {
          result->Error("bad_args", "expected {x, y, width, height, maximized}");
          return;
        }
        const auto x = NumberAt(*args, "x");
        const auto y = NumberAt(*args, "y");
        const auto w = NumberAt(*args, "width");
        const auto h = NumberAt(*args, "height");
        if (!x || !y || !w || !h) {
          result->Error("bad_args", "expected {x, y, width, height, maximized}");
          return;
        }
        window_placement::Placement placement;
        placement.normal.left = static_cast<LONG>(std::lround(*x));
        placement.normal.top = static_cast<LONG>(std::lround(*y));
        placement.normal.right =
            placement.normal.left + static_cast<LONG>(std::lround(*w));
        placement.normal.bottom =
            placement.normal.top + static_cast<LONG>(std::lround(*h));
        const auto maximized =
            args->find(flutter::EncodableValue("maximized"));
        placement.maximized =
            maximized != args->end() &&
            std::holds_alternative<bool>(maximized->second) &&
            std::get<bool>(maximized->second);
        result->Success(flutter::EncodableValue(
            window_placement::Apply(GetHandle(), placement)));
      });
}

void FlutterWindow::OnPlacementChanged() {
  if (!window_channel_) {
    return;
  }
  const auto placement = window_placement::Current(GetHandle());
  if (!placement.has_value()) {
    return;
  }
  const RECT& r = placement->normal;
  window_channel_->InvokeMethod(
      "placementChanged",
      std::make_unique<flutter::EncodableValue>(flutter::EncodableMap{
          {flutter::EncodableValue("x"),
           flutter::EncodableValue(static_cast<double>(r.left))},
          {flutter::EncodableValue("y"),
           flutter::EncodableValue(static_cast<double>(r.top))},
          {flutter::EncodableValue("width"),
           flutter::EncodableValue(static_cast<double>(r.right - r.left))},
          {flutter::EncodableValue("height"),
           flutter::EncodableValue(static_cast<double>(r.bottom - r.top))},
          {flutter::EncodableValue("maximized"),
           flutter::EncodableValue(placement->maximized)},
      }));
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
  // The method IS the event (exam-engine's PowerEvents switches on the method
  // name); the map carries the same name plus the clocks, for diagnostics.
  power_channel_->InvokeMethod(
      event, std::make_unique<flutter::EncodableValue>(std::move(payload)));
}

void FlutterWindow::OnDestroy() {
  launch_channel_ = nullptr;
  power_channel_ = nullptr;
  window_channel_ = nullptr;
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
          SendPowerEvent("suspending");
          break;
        case PBT_APMRESUMEAUTOMATIC:
          // Sent on EVERY resume; the one engines act on.
          SendPowerEvent("resumed");
          break;
        case PBT_APMRESUMESUSPEND:
          // Sent after "resumed" when a person woke the machine (diagnostics).
          SendPowerEvent("resumedByUser");
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
