#pragma once

#include <WebView2.h>
#include <wil/com.h>
#include <windows.ui.composition.desktop.h>
#include <windows.ui.composition.h>
#include <winrt/base.h>

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "util/surface_geometry.h"

class WebviewHost;

enum class WebviewLoadingState { None, Loading, NavigationCompleted };

enum class WebviewPointerButton { None, Primary, Secondary, Tertiary };

enum class WebviewPointerEventKind { Activate, Down, Enter, Leave, Up, Update };

enum class WebviewDownloadEventKind {
  DownloadStarted,
  DownloadCompleted,
  DownloadProgress
};

enum class WebviewPermissionKind {
  Unknown,
  Microphone,
  Camera,
  GeoLocation,
  Notifications,
  OtherSensors,
  ClipboardRead
};

enum class WebviewPermissionState { Default, Allow, Deny };

enum class WebviewPopupWindowPolicy { Allow, Deny, ShowInSameWindow };

enum class WebviewHostResourceAccessKind { Deny, Allow, DenyCors };

struct WebviewHistoryChanged {
  BOOL can_go_back;
  BOOL can_go_forward;
};

// Mirrors ICoreWebView2Cookie. |expires| is in seconds since the UNIX epoch,
// or -1 for session cookies. |same_site| carries the
// COREWEBVIEW2_COOKIE_SAME_SITE_KIND value (None=0, Lax=1, Strict=2), which
// the Dart side decodes as an enum index.
struct WebviewCookie {
  std::string name;
  std::string value;
  std::string domain;
  std::string path;
  double expires = -1.0;
  bool is_secure = false;
  bool is_http_only = false;
  bool is_session = true;
  int same_site = 1;
};

struct WebviewDownloadEvent {
  WebviewDownloadEventKind kind;
  std::string url;
  std::string resultFilePath;
  INT64 bytesReceived;
  INT64 totalBytesToReceive;
};

struct VirtualKeyState {
 public:
  inline void set_isLeftButtonDown(bool is_down) {
    set(COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS::
            COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON,
        is_down);
  }

  inline void set_isRightButtonDown(bool is_down) {
    set(COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS::
            COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_RIGHT_BUTTON,
        is_down);
  }

  inline void set_isMiddleButtonDown(bool is_down) {
    set(COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS::
            COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_MIDDLE_BUTTON,
        is_down);
  }

  inline COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS state() const { return state_; }

 private:
  COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS state_ =
      COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS::
          COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE;

  inline void set(COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS key, bool flag) {
    if (flag) {
      state_ |= key;
    } else {
      state_ &= ~key;
    }
  }
};

struct EventRegistrations {
  EventRegistrationToken source_changed_token_{};
  EventRegistrationToken content_loading_token_{};
  EventRegistrationToken navigation_completed_token_{};
  EventRegistrationToken history_changed_token_{};
  EventRegistrationToken document_title_changed_token_{};
  EventRegistrationToken cursor_changed_token_{};
  EventRegistrationToken got_focus_token_{};
  EventRegistrationToken lost_focus_token_{};
  EventRegistrationToken move_focus_requested_token_{};
  EventRegistrationToken web_message_received_token_{};
  EventRegistrationToken permission_requested_token_{};
  EventRegistrationToken devtools_protocol_event_token_{};
  EventRegistrationToken new_windows_requested_token_{};
  EventRegistrationToken contains_fullscreen_element_changed_token_{};
  EventRegistrationToken download_starting_token_{};
  EventRegistrationToken download_bytes_received_token_{};
  EventRegistrationToken download_state_changed_token_{};
  // MasterSAT patch.
  EventRegistrationToken navigation_starting_token_{};
  EventRegistrationToken frame_navigation_starting_token_{};
  EventRegistrationToken web_resource_requested_token_{};
  EventRegistrationToken process_failed_token_{};
  EventRegistrationToken launching_external_uri_scheme_token_{};
  EventRegistrationToken script_dialog_opening_token_{};
};

class Webview {
 public:
  friend class WebviewHost;

  typedef std::function<void(const std::string&)> UrlChangedCallback;
  typedef std::function<void(WebviewLoadingState)> LoadingStateChangedCallback;
  typedef std::function<void(COREWEBVIEW2_WEB_ERROR_STATUS)>
      OnLoadErrorCallback;
  typedef std::function<void(WebviewHistoryChanged)> HistoryChangedCallback;
  typedef std::function<void(const std::string&)> DevtoolsProtocolEventCallback;
  typedef std::function<void(const std::string&)> DocumentTitleChangedCallback;
  typedef std::function<void(size_t width, size_t height)>
      SurfaceSizeChangedCallback;
  typedef std::function<void(const HCURSOR)> CursorChangedCallback;
  typedef std::function<void(bool)> FocusChangedCallback;
  typedef std::function<void(bool, const std::string&)>
      AddScriptToExecuteOnDocumentCreatedCallback;
  typedef std::function<void(bool, const std::string&)> ScriptExecutedCallback;
  typedef std::function<void(const std::string&)> WebMessageReceivedCallback;
  typedef std::function<void(WebviewPermissionState state)>
      WebviewPermissionRequestedCompleter;
  typedef std::function<void(const std::string& url, WebviewPermissionKind kind,
                             bool is_user_initiated,
                             WebviewPermissionRequestedCompleter completer)>
      PermissionRequestedCallback;
  typedef std::function<void(bool contains_fullscreen_element)>
      ContainsFullScreenElementChangedCallback;
  typedef std::function<void(WebviewDownloadEvent)> DownloadEventCallback;
  typedef std::function<void(bool success, std::vector<WebviewCookie> cookies)>
      GetCookiesCallback;
  // MasterSAT patch.
  // |kind| is COREWEBVIEW2_PROCESS_FAILED_KIND, |reason| is
  // COREWEBVIEW2_PROCESS_FAILED_REASON (or -1), |exit_code| the process exit
  // code (or 0).
  typedef std::function<void(int kind, int reason, int exit_code)>
      ProcessFailedCallback;
  // Something the island policy refused: |what| is "navigation", "frame",
  // "resource", "newWindow", "download", "permission", "externalUri" or
  // "dialog"; |uri| what it tried to open.
  typedef std::function<void(const std::string& what, const std::string& uri)>
      BlockedCallback;
  typedef std::function<void(bool success, std::vector<uint8_t> png)>
      CapturePreviewCallback;

  ~Webview();

  ABI::Windows::UI::Composition::IVisual* const surface() {
    return surface_.get();
  }

  bool IsValid() { return is_valid_; }

  // Applies |geometry| (see util/surface_geometry.h): the composition surface
  // and rasterization scale follow its extent, the Bounds origin follows its
  // offset. A call that changes neither is a no-op, and a change of offset
  // alone only moves the bounds, so the widget can report its position every
  // frame while scrolling or animating without the texture being rebuilt.
  void SetSurfaceSize(const util::SurfaceGeometry& geometry);

  // Tells WebView2 that an ancestor window moved. Required for accessibility
  // and for dialogs and popups to stay anchored while they are open, because
  // WebView2 caches the parent window's screen position.
  void NotifyParentWindowMoved();
  void SetCursorPos(double x, double y);
  void SetPointerUpdate(int32_t pointer, WebviewPointerEventKind eventKind,
                        double x, double y, double size, double pressure);
  void SetPointerButtonState(WebviewPointerButton button, bool isDown);
  void SetScrollDelta(double delta_x, double delta_y);
  void LoadUrl(const std::string& url);
  void LoadStringContent(const std::string& content);
  bool Stop();
  bool Reload();
  bool GoBack();
  bool GoForward();
  void AddScriptToExecuteOnDocumentCreated(
      const std::string& script,
      AddScriptToExecuteOnDocumentCreatedCallback callback);
  void RemoveScriptToExecuteOnDocumentCreated(const std::string& script_id);
  void ExecuteScript(const std::string& script,
                     ScriptExecutedCallback callback);
  bool PostWebMessage(const std::string& json);
  // |uri| may be empty to request all cookies of the profile.
  void GetCookies(const std::string& uri, GetCookiesCallback callback);
  bool SetCookie(const WebviewCookie& cookie);
  // Deletes cookies named |name| under |uri| (all domains/paths when |uri|
  // is empty).
  bool DeleteCookies(const std::string& name, const std::string& uri);
  bool ClearCookies();
  bool ClearCache();
  bool SetCacheDisabled(bool disabled);
  void SetPopupWindowPolicy(WebviewPopupWindowPolicy policy);
  bool SetDefaultContextMenusEnabled(bool enabled);
  bool SetUserAgent(const std::string& user_agent);
  bool SetDevToolsEnabled(bool enabled);
  bool OpenDevTools();
  bool SetBackgroundColor(int32_t color);
  bool SetZoomControlEnabled(bool enabled);
  bool SetZoomFactor(double factor);
  bool Suspend();
  bool Resume();
  bool MoveFocus();

  // MasterSAT patch: PNG of the current page pixels (CapturePreview).
  void CapturePreview(CapturePreviewCallback callback);
  // MasterSAT patch: show/hide without destroying; a hidden island asks
  // WebView2 for MemoryUsageTargetLevel LOW (architecture §2.5).
  bool SetVisible(bool visible);
  // MasterSAT patch: make WebView2 present a fresh frame of what it shows now.
  // Windows.Graphics.Capture only delivers frames for changes made AFTER the
  // capture starts, so a page painted before TextureBridge::Start stayed blank
  // until something on it changed (review: blank until Next, 2026-10-12).
  void RequestRepaint();
  // MasterSAT patch: extra https hosts this island may load resources from
  // (exact "www.desmos.com" or "*.desmos.com"); replaces the previous list.
  void SetAllowedResourceHosts(const std::vector<std::string>& hosts);

  bool SetVirtualHostNameMapping(const std::string& hostName,
                                 const std::string& path,
                                 WebviewHostResourceAccessKind accessKind);
  bool ClearVirtualHostNameMapping(const std::string& hostName);

  void UpdateDownloadProgress(ICoreWebView2DownloadOperation* download);

  void OnUrlChanged(UrlChangedCallback callback) {
    url_changed_callback_ = std::move(callback);
  }

  void OnLoadError(OnLoadErrorCallback callback) {
    on_load_error_callback_ = std::move(callback);
  }

  void OnLoadingStateChanged(LoadingStateChangedCallback callback) {
    loading_state_changed_callback_ = std::move(callback);
  }

  void OnDownloadEvent(DownloadEventCallback callback) {
    download_event_callback_ = std::move(callback);
  }

  void OnHistoryChanged(HistoryChangedCallback callback) {
    history_changed_callback_ = std::move(callback);
  }

  void OnSurfaceSizeChanged(SurfaceSizeChangedCallback callback) {
    surface_size_changed_callback_ = std::move(callback);
  }

  void OnDocumentTitleChanged(DocumentTitleChangedCallback callback) {
    document_title_changed_callback_ = std::move(callback);
  }

  void OnCursorChanged(CursorChangedCallback callback) {
    cursor_changed_callback_ = std::move(callback);
  }

  void OnFocusChanged(FocusChangedCallback callback) {
    focus_changed_callback_ = std::move(callback);
  }

  void OnWebMessageReceived(WebMessageReceivedCallback callback) {
    web_message_received_callback_ = std::move(callback);
  }

  void OnPermissionRequested(PermissionRequestedCallback callback) {
    permission_requested_callback_ = std::move(callback);
  }

  void OnDevtoolsProtocolEvent(DevtoolsProtocolEventCallback callback) {
    devtools_protocol_event_callback_ = std::move(callback);
  }

  void OnContainsFullScreenElementChanged(
      ContainsFullScreenElementChangedCallback callback) {
    contains_fullscreen_element_changed_callback_ = std::move(callback);
  }

  // MasterSAT patch.
  void OnProcessFailed(ProcessFailedCallback callback) {
    process_failed_callback_ = std::move(callback);
  }

  void OnBlocked(BlockedCallback callback) {
    blocked_callback_ = std::move(callback);
  }

 private:
  HWND hwnd_;
  HWND flutter_view_hwnd_;
  bool owns_window_;
  bool is_valid_ = false;
  // The geometry last applied by SetSurfaceSize and the bounds derived from
  // it. Pointer coordinates are scaled by surface_geometry_.scale_factor.
  util::SurfaceGeometry surface_geometry_;
  RECT bounds_ = {};
  wil::com_ptr<ICoreWebView2CompositionController> composition_controller_;
  wil::com_ptr<ICoreWebView2Controller3> webview_controller_;
  wil::com_ptr<ICoreWebView2> webview_;
  wil::com_ptr<ICoreWebView2DevToolsProtocolEventReceiver>
      devtools_protocol_event_receiver_;
  wil::com_ptr<ICoreWebView2Settings> settings_;
  wil::com_ptr<ICoreWebView2Settings2> settings2_;
  POINT last_cursor_pos_ = {0, 0};
  VirtualKeyState virtual_keys_;
  WebviewPopupWindowPolicy popup_window_policy_ =
      WebviewPopupWindowPolicy::Allow;

  winrt::com_ptr<ABI::Windows::UI::Composition::IVisual> surface_;
  winrt::com_ptr<ABI::Windows::UI::Composition::Desktop::IDesktopWindowTarget>
      window_target_;

  WebviewHost* host_;
  EventRegistrations event_registrations_{};

  UrlChangedCallback url_changed_callback_;
  LoadingStateChangedCallback loading_state_changed_callback_;
  DownloadEventCallback download_event_callback_;
  OnLoadErrorCallback on_load_error_callback_;
  HistoryChangedCallback history_changed_callback_;
  DocumentTitleChangedCallback document_title_changed_callback_;
  SurfaceSizeChangedCallback surface_size_changed_callback_;
  CursorChangedCallback cursor_changed_callback_;
  FocusChangedCallback focus_changed_callback_;
  WebMessageReceivedCallback web_message_received_callback_;
  PermissionRequestedCallback permission_requested_callback_;
  DevtoolsProtocolEventCallback devtools_protocol_event_callback_;
  ContainsFullScreenElementChangedCallback
      contains_fullscreen_element_changed_callback_;
  // MasterSAT patch.
  ProcessFailedCallback process_failed_callback_;
  BlockedCallback blocked_callback_;
  std::vector<std::wstring> allowed_resource_hosts_;

  Webview(
      wil::com_ptr<ICoreWebView2CompositionController> composition_controller,
      WebviewHost* host, HWND hwnd, HWND flutter_view_hwnd, bool owns_window,
      bool offscreen_only);

  bool CreateSurface(
      winrt::com_ptr<ABI::Windows::UI::Composition::ICompositor> compositor,
      HWND hwnd, bool offscreen_only);
  void RegisterEventHandlers();
  // MasterSAT patch: the island lockdown (settings + blocking handlers).
  void ApplyIslandSettings();
  void MapIslandFolder();
  void RegisterIslandPolicyHandlers();
  void ReportBlocked(const char* what, LPCWSTR uri);
  void EnableSecurityUpdates();
  void SendScroll(double offset, bool horizontal);
};
