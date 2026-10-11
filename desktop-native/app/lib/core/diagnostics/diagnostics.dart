// Settings → "Copy diagnostics": one JSON document a student can paste to support.
//
// It holds what helps diagnose a problem and nothing that could sign someone in: no tokens,
// no verifier, no answer content. [EventLog] keeps the last notable events (network failures,
// sign-in transitions) in memory only.
import 'dart:collection';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../clock/clock.dart';

@immutable
class LogEvent {
  const LogEvent(this.at, this.kind, this.message);

  final DateTime at;
  final String kind;
  final String message;

  Map<String, Object?> toJson() => {'at': at.toUtc().toIso8601String(), 'kind': kind, 'message': message};
}

/// A bounded in-memory log of recent events.
class EventLog {
  EventLog({this.capacity = 50, this._clock = const SystemClock()});

  final int capacity;
  final Clock _clock;
  final ListQueue<LogEvent> _events = ListQueue<LogEvent>();

  static final RegExp _secret = RegExp(r'(eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*\.[A-Za-z0-9_\-]*)|(Bearer\s+\S+)');

  /// Records an event. Anything that looks like a token is masked.
  void add(String kind, String message) {
    _events.addLast(LogEvent(_clock.now(), kind, message.replaceAll(_secret, '[redacted]')));
    while (_events.length > capacity) {
      _events.removeFirst();
    }
  }

  List<LogEvent> get events => List.unmodifiable(_events);
}

/// The inputs of a diagnostics report (gathered by the app; plain values so this is testable).
class DiagnosticsInput {
  const DiagnosticsInput({
    required this.appVersion,
    required this.buildMode,
    required this.apiOrigin,
    required this.clientHeader,
    required this.nativeLibraryVersion,
    required this.signedIn,
    this.userId,
    this.accessExpiresAt,
    this.nextRefreshAt,
    this.homeFetchedAt,
    this.homeEtag,
    this.midtermCount,
    this.pastpaperCount,
    required this.online,
    required this.unsent,
    required this.updateChannel,
    required this.updateState,
    this.serverClockOffset,
    required this.events,
    required this.now,
    this.islands,
  });

  final String appVersion;
  final String buildMode;
  final String apiOrigin;
  final String clientHeader;
  final String nativeLibraryVersion;
  final bool signedIn;
  final int? userId;
  final DateTime? accessExpiresAt;
  final DateTime? nextRefreshAt;
  final DateTime? homeFetchedAt;
  final String? homeEtag;
  final int? midtermCount;
  final int? pastpaperCount;
  final bool online;
  final Map<String, Object?> unsent;
  final String updateChannel;
  final String updateState;
  final Duration? serverClockOffset;
  final List<LogEvent> events;
  final DateTime now;

  /// The question islands (WebView2): runtime version, the last host problem — or null when
  /// the exam layer is not wired (tests of the screens around the exam).
  final Map<String, Object?>? islands;
}

String _ts(DateTime? t) => t?.toUtc().toIso8601String() ?? '';

/// The report as a JSON-ready map.
Map<String, Object?> buildDiagnostics(DiagnosticsInput i) => {
      'schema': 1,
      'generated_at': _ts(i.now),
      'app': {
        'version': i.appVersion,
        'build': i.buildMode,
        'client_header': i.clientHeader,
        'api_origin': i.apiOrigin,
        'native_library': i.nativeLibraryVersion,
      },
      'os': {
        'platform': Platform.operatingSystem,
        'version': Platform.operatingSystemVersion,
        'locale': Platform.localeName,
        'processors': Platform.numberOfProcessors,
        'dart': Platform.version.split(' ').first,
      },
      'session': {
        'signed_in': i.signedIn,
        'user_id': i.userId,
        'access_expires_at': _ts(i.accessExpiresAt),
        'next_refresh_at': _ts(i.nextRefreshAt),
      },
      'home': {
        'fetched_at': _ts(i.homeFetchedAt),
        'etag': i.homeEtag,
        'midterms': i.midtermCount,
        'pastpapers': i.pastpaperCount,
        'online': i.online,
      },
      'unsent': i.unsent,
      'update': {'channel': i.updateChannel, 'state': i.updateState},
      'clock': {'server_offset_ms': i.serverClockOffset?.inMilliseconds},
      if (i.islands != null) 'islands': i.islands,
      'recent_events': [for (final e in i.events) e.toJson()],
    };

/// Pretty JSON for the clipboard.
String diagnosticsJson(DiagnosticsInput i) => const JsonEncoder.withIndent('  ').convert(buildDiagnostics(i));
