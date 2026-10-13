// Where the app talks to and how patiently (architecture §4.2).
//
// The base URL comes from `--dart-define=MASTERSAT_API_BASE=…`:
//  * release builds default to https://mastersat.uz;
//  * debug/profile builds with no define use the in-process fixture API ("fixture:"), so a
//    developer never reaches production by accident;
//  * `http://127.0.0.1:<port>` points at tool/fixture_server.
import 'package:flutter/foundation.dart';

import '../api/v1_api.dart';

/// This build's version: `--dart-define=MASTERSAT_APP_VERSION=…`, which the packaging sets from
/// desktop-native/VERSION. The default is kept equal to that file (a test checks it).
const String appVersion = String.fromEnvironment('MASTERSAT_APP_VERSION', defaultValue: '0.2.6');

/// The production origin.
final Uri productionOrigin = Uri.parse('https://mastersat.uz');

/// What a dart-define base resolved to.
enum ApiTarget {
  /// A real HTTP origin (production or the local fixture server).
  http,

  /// The in-process [FixtureV1Api] — no network at all.
  inProcessFixtures,
}

@immutable
class ApiConfig {
  const ApiConfig({
    required this.origin,
    required this.appVersion,
    this.target = ApiTarget.http,
    this.connectTimeout = const Duration(seconds: 10),
    this.idleTimeout = const Duration(seconds: 90),
    this.writeTimeout = const Duration(seconds: 25),
    this.readTimeout = const Duration(seconds: 25),
    this.longTimeout = const Duration(seconds: 60),
    this.refreshTimeout = const Duration(seconds: 120),
    this.maxConnectionsPerHost = 6,
  });

  /// Parses the dart-define value. [raw] empty → the build-mode default described above.
  factory ApiConfig.fromDefine(String raw, {required String appVersion, bool releaseMode = kReleaseMode}) {
    final value = raw.trim();
    if (value.isEmpty) {
      return releaseMode
          ? ApiConfig(origin: productionOrigin, appVersion: appVersion)
          : ApiConfig(origin: Uri.parse('http://fixtures.invalid'), appVersion: appVersion, target: ApiTarget.inProcessFixtures);
    }
    if (value == 'fixture:' || value == 'fixtures') {
      return ApiConfig(origin: Uri.parse('http://fixtures.invalid'), appVersion: appVersion, target: ApiTarget.inProcessFixtures);
    }
    final uri = Uri.parse(value);
    if (!uri.hasScheme || (uri.scheme != 'http' && uri.scheme != 'https') || uri.host.isEmpty) {
      throw ArgumentError.value(raw, 'MASTERSAT_API_BASE', 'must be an http(s) origin or "fixture:"');
    }
    return ApiConfig(origin: Uri(scheme: uri.scheme, host: uri.host, port: uri.hasPort ? uri.port : null), appVersion: appVersion);
  }

  /// `https://mastersat.uz` (API paths are absolute: `/api/...`).
  final Uri origin;
  final String appVersion;
  final ApiTarget target;

  final Duration connectTimeout;
  final Duration idleTimeout;

  /// Writes (sync, submit, pause, reports, …).
  final Duration writeTimeout;

  /// Small reads (home, media, challenge).
  final Duration readTimeout;

  /// `open` and `result` (big bodies) and PDFs.
  final Duration longTimeout;

  /// `POST /api/auth/refresh/` — never cut short: the server rotates the token inside it, and a
  /// reply abandoned mid-flight leaves the client holding a revoked token. 120 s is longer than
  /// the server's 60 s replay grace (backend AUTH_REFRESH_REUSE_GRACE_SECONDS).
  final Duration refreshTimeout;

  final int maxConnectionsPerHost;

  /// `X-MasterSAT-Client` value.
  String get clientHeader => V1Headers.clientValue(appVersion);

  /// The origin is this machine (the fixture server). Dev-only helpers check this.
  bool get isLoopback {
    final h = origin.host;
    return h == '127.0.0.1' || h == 'localhost' || h == '::1' || h == '[::1]';
  }

  /// The website page the browser sign-in starts on.
  Uri signInLink(String challenge) =>
      origin.replace(path: '/desktop/link', queryParameters: {'challenge': challenge});

  /// The Velopack feed folder (architecture §6: the live `/downloads/desktop/` block).
  Uri get updateFeed => origin.replace(path: '/downloads/desktop/');

  Uri resolve(String pathAndQuery) => origin.resolve(pathAndQuery);

  ApiConfig copyWith({
    Uri? origin,
    String? appVersion,
    Duration? writeTimeout,
    Duration? readTimeout,
    Duration? longTimeout,
    Duration? refreshTimeout,
    Duration? connectTimeout,
  }) =>
      ApiConfig(
        origin: origin ?? this.origin,
        appVersion: appVersion ?? this.appVersion,
        target: target,
        connectTimeout: connectTimeout ?? this.connectTimeout,
        idleTimeout: idleTimeout,
        writeTimeout: writeTimeout ?? this.writeTimeout,
        readTimeout: readTimeout ?? this.readTimeout,
        longTimeout: longTimeout ?? this.longTimeout,
        refreshTimeout: refreshTimeout ?? this.refreshTimeout,
        maxConnectionsPerHost: maxConnectionsPerHost,
      );
}
