#pragma once

#include <flutter/event_channel.h>
#include <flutter/method_channel.h>
#include <flutter/standard_method_codec.h>
#include <flutter/texture_registrar.h>

#include <functional>
#include <memory>

#include "graphics_context.h"
#include "texture_bridge.h"
#include "webview.h"

class WebviewBridge {
 public:
  // |on_browser_process_exited| (MasterSAT patch) tells the plugin that the
  // shared environment's browser process died, so the next webview is created
  // on a fresh environment.
  WebviewBridge(flutter::BinaryMessenger* messenger,
                flutter::TextureRegistrar* texture_registrar,
                GraphicsContext* graphics_context,
                std::unique_ptr<Webview> webview,
                std::function<void()> on_browser_process_exited = nullptr);
  ~WebviewBridge();

  TextureBridge* texture_bridge() const { return texture_bridge_.get(); }

  int64_t texture_id() const { return texture_id_; }

  // Forwarded from the plugin when a top-level window moves, so WebView2 can
  // re-anchor open dialogs and popups. See Webview::NotifyParentWindowMoved.
  void NotifyParentWindowMoved() { webview_->NotifyParentWindowMoved(); }

 private:
  std::unique_ptr<flutter::TextureVariant> flutter_texture_;
  std::unique_ptr<TextureBridge> texture_bridge_;
  std::unique_ptr<Webview> webview_;
  std::unique_ptr<flutter::EventSink<flutter::EncodableValue>> event_sink_;
  std::unique_ptr<flutter::EventChannel<flutter::EncodableValue>>
      event_channel_;
  std::unique_ptr<flutter::MethodChannel<flutter::EncodableValue>>
      method_channel_;

  flutter::TextureRegistrar* texture_registrar_;
  int64_t texture_id_;
  std::function<void()> on_browser_process_exited_;
  // MasterSAT patch: setVisible(false) stopped the texture; setSize must not
  // restart it until setVisible(true).
  bool hidden_ = false;

  void HandleMethodCall(
      const flutter::MethodCall<flutter::EncodableValue>& method_call,
      std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result);
  void RegisterEventHandlers();

  template <typename T>
  void EmitEvent(const T& value) {
    if (event_sink_) {
      event_sink_->Success(value);
    }
  }

  void OnPermissionRequested(
      const std::string& url, WebviewPermissionKind permissionKind,
      bool is_user_initiated,
      Webview::WebviewPermissionRequestedCompleter completer);
};
