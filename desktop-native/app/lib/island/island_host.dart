// IslandHost — the one seam between Flutter and a WebView2 island (architecture §2.6).
// Exactly two islands exist: the question card ("content") and Desmos ("desmos").
//
// Implementations (windows-host workstream unless noted):
//  * TextureIslandHost  — Windows default: WebView2 drawn into a Flutter texture, so native
//                         overlays can float over it (canDrawOverIsland = true).
//  * WindowedIslandHost — Windows fallback: a child HWND (canDrawOverIsland = false;
//                         native overlays use freeze-frame via capturePreview()).
//  * MacosIslandHost    — macOS development only (WKWebView through the same protocol).
//  * FakeIslandHost     — tests (foundation, fake_island_host.dart).
//
// Contract:
//  * post() only accepts to_web messages for this island; anything else is a programming
//    error (asserts in debug, dropped in release).
//  * events delivers ONLY schema-valid to_native messages for this island (as
//    IslandMessageEvent); invalid input is dropped and reported as IslandDroppedEvent.
//  * After IslandCrashedEvent (WebView2 ProcessFailed) the host recreates itself and emits
//    `ready` again; the owner replays init → module.load → media.put → question.show.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'protocol.dart';

export 'protocol.dart' show IslandKind;

/// Lifecycle of an island surface.
enum IslandHostState { idle, loading, ready, crashed, disposed }

/// Something the island (or its host) reports to native.
sealed class IslandEvent {
  const IslandEvent();
}

/// A schema-valid message from the page.
final class IslandMessageEvent extends IslandEvent {
  const IslandMessageEvent(this.message);
  final IslandMessage message;

  @override
  String toString() => 'IslandMessageEvent(${message.t})';
}

/// The page sent something that failed validation; it was dropped (diagnostics only).
final class IslandDroppedEvent extends IslandEvent {
  const IslandDroppedEvent({required this.raw, required this.reason});
  final String raw;
  final String reason;

  @override
  String toString() => 'IslandDroppedEvent($reason)';
}

/// The browser process died (WebView2 ProcessFailed). The host is recreating the island.
final class IslandCrashedEvent extends IslandEvent {
  const IslandCrashedEvent(this.reason);
  final String reason;

  @override
  String toString() => 'IslandCrashedEvent($reason)';
}

/// The island page (content.html / desmos.html) under the virtual host.
String islandPageUrl(IslandKind kind) =>
    'https://island.mastersat.example/${kind == IslandKind.content ? 'content' : 'desmos'}.html';

abstract class IslandHost {
  /// Which island this host shows.
  IslandKind get kind;

  /// Current lifecycle state (also as a listenable for widgets).
  IslandHostState get state => stateListenable.value;
  ValueListenable<IslandHostState> get stateListenable;

  /// Create the WebView (sharing the one CoreWebView2Environment) and load the island page.
  /// Completes when the page is loading; `ready` arrives as an event.
  Future<void> open();

  /// Native → web. Only to_web messages valid for [kind].
  void post(IslandMessage message);

  /// Web → native, schema-validated, plus host lifecycle events.
  Stream<IslandEvent> get events;

  /// Only the valid messages from [events].
  Stream<IslandMessage> get messages =>
      events.where((e) => e is IslandMessageEvent).map((e) => (e as IslandMessageEvent).message);

  /// Texture mode: true (Flutter overlays draw over the island). Windowed fallback: false.
  bool get canDrawOverIsland;

  /// Windowed mode: the island rectangle in logical px (ignored in texture mode, where
  /// [build]'s layout decides).
  void setBounds(Rect logical);

  /// The island surface. Size it with the parent's constraints; 1 CSS px = 1 logical px.
  Widget build(BuildContext context);

  /// Give keyboard focus to the page / take it back (Escape inside an island sends
  /// `focus.release`; the owner then calls [releaseFocus]).
  Future<void> focus();
  Future<void> releaseFocus();

  /// PNG of the current island pixels (WebView2 CapturePreview): windowed-mode freeze-frames
  /// and test screenshots. Null when not available.
  Future<Uint8List?> capturePreview();

  /// Hide (MemoryUsageTargetLevel=Low) or show the island without destroying it.
  Future<void> setVisible(bool visible);

  /// Destroy the WebView. The host cannot be reopened afterwards.
  Future<void> dispose();
}

/// Creates hosts; the Windows/macOS factory lives in island_host_factory.dart (windows-host).
typedef IslandHostFactory = IslandHost Function(IslandKind kind);

/// Validates an outgoing message for [kind] (shared by every implementation).
bool islandAcceptsOutgoing(IslandKind kind, IslandMessage message) =>
    message.direction == MessageDirection.toWeb && message.islands.contains(kind);

/// Decodes an incoming page message for [kind] into an [IslandEvent] (valid or dropped).
IslandEvent decodeIncoming(IslandKind kind, String raw) {
  final reason = _reason(kind, raw);
  if (reason != null) return IslandDroppedEvent(raw: raw.length > 300 ? '${raw.substring(0, 300)}…' : raw, reason: reason);
  return IslandMessageEvent(IslandMessage.tryDecode(raw, direction: MessageDirection.toNative, island: kind)!);
}

String? _reason(IslandKind kind, String raw) {
  Object? json;
  try {
    json = jsonDecode(raw);
  } on FormatException catch (e) {
    return 'not JSON: ${e.message}';
  }
  return validateIslandMessage(json, direction: MessageDirection.toNative, island: kind);
}
