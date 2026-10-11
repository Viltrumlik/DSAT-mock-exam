// A tiny local HTTP server that speaks the v1 wire contract (desktop-native/contracts/v1) with
// in-memory state, for `flutter run -d macos --dart-define=MASTERSAT_API_BASE=http://127.0.0.1:<port>`
// and for the app's end-to-end HTTP tests. It never talks to production.
//
// The exam endpoints are served by the foundation's stateful [FixtureV1Api] (requests are
// parsed through the real models, answers serialised with their toJson). This server adds what
// a fake API object cannot show: the HTTP layer itself —
//  * auth: the browser hand-off (`POST /api/desktop/auth/code/` → one-time code bound to a PKCE
//    challenge, `POST /api/desktop/auth/exchange/` checks S256(verifier)), JWT-shaped access
//    tokens with a real `exp`, refresh rotation (a retired refresh token is refused), and a 401
//    for any request without a live access token;
//  * the version gate (426 below `minimumVersion`), ETag / If-None-Match on `home`,
//    Retry-After, gzip, the `Date` header;
//  * control endpoints under `/__fixture__/` to put the server offline, expire tokens, or make
//    Home offer or require an update — so every app state can be reached by hand.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';

/// What `home.app.update` the server should report (null = the fixture's own).
enum FixtureUpdateMode { none, available, required }

class FixtureServer {
  FixtureServer({
    FixtureV1Api? api,
    this.accessTtl = const Duration(hours: 3),
    this.minimumVersion,
    this.latency = Duration.zero,
    DateTime Function()? now,
    this.verbose = false,
  })  : _now = now ?? (() => DateTime.now().toUtc()),
        api = api ?? FixtureV1Api(now: now);

  /// The exam state. Replaced by `/__fixture__/reset`.
  FixtureV1Api api;

  /// How long a minted access token lives (short values exercise the app's refresh).
  Duration accessTtl;

  /// The version gate: clients below this get 426. Null = no gate.
  String? minimumVersion;

  /// Delay before every /api answer.
  Duration latency;

  /// Every /api request is dropped (the socket is destroyed): the app sees "no connection".
  bool offline = false;

  /// Overrides `home.app.update`.
  FixtureUpdateMode? updateMode;

  final bool verbose;
  final DateTime Function() _now;

  HttpServer? _server;
  final Random _random = Random.secure();
  final Map<String, _Code> _codes = {};
  final Map<String, DateTime> _access = {};
  String? _refresh;
  int _serial = 0;

  /// One line per /api request: `GET /api/desktop/v1/home 200`.
  final List<String> requestLog = [];

  /// The student every token belongs to (the fixture Home's student).
  static const studentId = 77;

  Uri get origin {
    final s = _server;
    if (s == null) throw StateError('not started');
    return Uri(scheme: 'http', host: s.address.address, port: s.port);
  }

  Future<Uri> start({InternetAddress? address, int port = 0}) async {
    final server = await HttpServer.bind(address ?? InternetAddress.loopbackIPv4, port);
    server.autoCompress = true; // gzip when the client accepts it
    server.idleTimeout = const Duration(seconds: 120);
    _server = server;
    server.listen((r) => unawaited(_handle(r)));
    return origin;
  }

  Future<void> close() async {
    await _server?.close(force: true);
    _server = null;
  }

  // ------------------------------------------------------------------------------------------
  // Tokens
  // ------------------------------------------------------------------------------------------

  String _b64(Object json) => base64Url.encode(utf8.encode(jsonEncode(json))).replaceAll('=', '');

  /// A JWT-shaped token the app can read `exp` / `user_id` from (never verified client-side).
  String _jwt(String type, Duration ttl) {
    _serial++;
    final exp = _now().add(ttl).millisecondsSinceEpoch ~/ 1000;
    return '${_b64({'alg': 'HS256', 'typ': 'JWT'})}.'
        '${_b64({'token_type': type, 'exp': exp, 'user_id': studentId, 'jti': 'fx-$_serial'})}.'
        'fixture-signature-$_serial';
  }

  Map<String, String> _mint() {
    final access = _jwt('access', accessTtl);
    _access[access] = _now().add(accessTtl);
    _refresh = _jwt('refresh', const Duration(days: 30));
    return {'access': access, 'refresh': _refresh!};
  }

  /// Every access token stops working (the app's next call gets a 401 and refreshes).
  void expireAccessTokens() => _access.clear();

  /// Signs the student out everywhere (the refresh token stops working too).
  void revokeAll() {
    _access.clear();
    _refresh = null;
  }

  bool _authorised(HttpRequest r) {
    final h = r.headers.value(HttpHeaders.authorizationHeader);
    if (h == null || !h.startsWith('Bearer ')) return false;
    final exp = _access[h.substring(7).trim()];
    return exp != null && exp.isAfter(_now());
  }

  /// A sign-in code for [challenge], as the website's /desktop/link page would mint one.
  String mintCode(String challenge) {
    final code = base64Url.encode(List<int>.generate(24, (_) => _random.nextInt(256))).replaceAll('=', '');
    _codes[code] = _Code(challenge, _now().add(const Duration(seconds: 120)));
    return code;
  }

  // ------------------------------------------------------------------------------------------
  // Plumbing
  // ------------------------------------------------------------------------------------------

  Future<void> _handle(HttpRequest r) async {
    final path = r.uri.path;
    try {
      if (path.startsWith('/__fixture__/')) {
        await _control(r);
        return;
      }
      if (!path.startsWith('/api/')) {
        await _json(r, 404, {'detail': 'Not found.'});
        return;
      }
      if (offline) {
        _log(r, 'dropped');
        final socket = await r.response.detachSocket(writeHeaders: false);
        socket.destroy();
        return;
      }
      if (latency > Duration.zero) await Future<void>.delayed(latency);
      await _api(r);
    } catch (e, st) {
      if (verbose) stderr.writeln('fixture server: $e\n$st');
      try {
        await _json(r, 500, {'detail': 'Fixture server error: $e'});
      } catch (_) {
        // The response was already started.
      }
    }
  }

  void _log(HttpRequest r, Object status) {
    final line = '${r.method} ${r.uri} $status';
    requestLog.add(line);
    if (verbose) stdout.writeln(line);
  }

  Future<void> _json(HttpRequest r, int status, Object? body, {Map<String, String> headers = const {}}) async {
    final res = r.response;
    res.statusCode = status;
    res.headers.set(HttpHeaders.dateHeader, HttpDate.format(_now()));
    headers.forEach(res.headers.set);
    if (status == 204 || status == 304) {
      res.contentLength = 0;
    } else {
      res.headers.contentType = ContentType.json;
      res.write(jsonEncode(body));
    }
    if (r.uri.path.startsWith('/api/')) _log(r, status);
    await res.close();
  }

  Future<void> _bytes(HttpRequest r, Uint8List bytes, String type) async {
    final res = r.response;
    res.statusCode = 200;
    res.headers.set(HttpHeaders.dateHeader, HttpDate.format(_now()));
    res.headers.contentType = ContentType.parse(type);
    res.add(bytes);
    _log(r, 200);
    await res.close();
  }

  Future<Map<String, Object?>> _body(HttpRequest r) async {
    final text = await utf8.decodeStream(r);
    if (text.trim().isEmpty) return {};
    final j = jsonDecode(text);
    if (j is! Map) throw const FormatException('Expected a JSON object body');
    return j.cast<String, Object?>();
  }

  Future<void> _error(HttpRequest r, ApiException e) async {
    switch (e) {
      case ApiError():
        await _json(r, e.status, e.body.toJson(), headers: {
          if (e.retryAfter != null) 'Retry-After': '${e.retryAfter!.inSeconds}',
        });
      case UpdateRequired():
        await _json(r, 426, _updateBody(e.minimumVersion));
      case NetworkError():
        final socket = await r.response.detachSocket(writeHeaders: false);
        socket.destroy();
    }
  }

  Map<String, Object?> _updateBody(String? minimum) => {
        'detail': 'This version of the MasterSAT app is out of date. Please update to continue.',
        'code': 'update_required',
        'minimum_version': minimum ?? minimumVersion ?? '0.2.0',
        'latest_version': minimum ?? minimumVersion ?? '0.2.0',
        'update_url': 'https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe',
      };

  static final _semver = RegExp(r'^windows/(\d+)\.(\d+)\.(\d+)');

  /// True when the client header is below [minimumVersion].
  bool _tooOld(HttpRequest r) {
    final min = minimumVersion;
    if (min == null) return false;
    final m = _semver.firstMatch(r.headers.value(V1Headers.client) ?? '');
    final need = RegExp(r'^(\d+)\.(\d+)\.(\d+)').firstMatch(min);
    if (m == null || need == null) return true;
    for (var i = 1; i <= 3; i++) {
      final a = int.parse(m.group(i)!);
      final b = int.parse(need.group(i)!);
      if (a != b) return a < b;
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------
  // /api
  // ------------------------------------------------------------------------------------------

  static final _routes = <(String, RegExp, String)>[
    ('POST', RegExp(r'^/api/desktop/auth/code/$'), 'code'),
    ('POST', RegExp(r'^/api/desktop/auth/exchange/$'), 'exchange'),
    ('POST', RegExp(r'^/api/auth/refresh/$'), 'refresh'),
    ('GET', RegExp(r'^/api/desktop/v1/home$'), 'home'),
    ('POST', RegExp(r'^/api/desktop/v1/pastpapers/(\d+)/open$'), 'ppOpen'),
    ('POST', RegExp(r'^/api/desktop/v1/pastpapers/attempts/(\d+)/start$'), 'ppStart'),
    ('POST', RegExp(r'^/api/desktop/v1/pastpapers/attempts/(\d+)/sync$'), 'ppSync'),
    ('POST', RegExp(r'^/api/desktop/v1/pastpapers/attempts/(\d+)/submit$'), 'ppSubmit'),
    ('POST', RegExp(r'^/api/desktop/v1/pastpapers/attempts/(\d+)/pause$'), 'ppPause'),
    ('POST', RegExp(r'^/api/desktop/v1/pastpapers/attempts/(\d+)/resume$'), 'ppResume'),
    ('GET', RegExp(r'^/api/desktop/v1/pastpapers/attempts/(\d+)/result$'), 'ppResult'),
    ('POST', RegExp(r'^/api/desktop/v1/midterms/(\d+)/prepare$'), 'mtPrepare'),
    ('POST', RegExp(r'^/api/midterms/attempts/(\d+)/desktop_challenge/$'), 'mtChallenge'),
    ('POST', RegExp(r'^/api/midterms/attempts/(\d+)/desktop_session/$'), 'mtSession'),
    ('POST', RegExp(r'^/api/desktop/v1/midterms/attempts/(\d+)/open$'), 'mtOpen'),
    ('POST', RegExp(r'^/api/desktop/v1/midterms/attempts/(\d+)/sync$'), 'mtSync'),
    ('POST', RegExp(r'^/api/desktop/v1/midterms/attempts/(\d+)/submit$'), 'mtSubmit'),
    ('POST', RegExp(r'^/api/desktop/v1/midterms/attempts/(\d+)/offscreen$'), 'mtOffscreen'),
    ('GET', RegExp(r'^/api/desktop/v1/midterms/attempts/(\d+)/result$'), 'mtResult'),
    ('GET', RegExp(r'^/api/desktop/v1/attempts/(pastpaper|midterm)/(\d+)/media$'), 'media'),
    ('PUT', RegExp(r'^/api/annotations/write/$'), 'annotation'),
    ('POST', RegExp(r'^/api/question-reports/reports/$'), 'report'),
    ('GET', RegExp(r'^/api/classes/pastpapers/attempts/(\d+)/report/pdf/$'), 'ppReportPdf'),
    ('GET', RegExp(r'^/api/classes/pastpapers/attempts/(\d+)/certificate/pdf/$'), 'ppCertPdf'),
    ('GET', RegExp(r'^/api/midterms/attempts/(\d+)/error-report/pdf/$'), 'mtReportPdf'),
    ('GET', RegExp(r'^/api/classes/certificates/midterm/([^/]+)/download/$'), 'mtCertPdf'),
  ];

  static const _public = {'code', 'exchange', 'refresh'};

  Future<void> _api(HttpRequest r) async {
    final path = r.uri.path;
    String? name;
    RegExpMatch? match;
    var methodMismatch = false;
    for (final (method, re, n) in _routes) {
      final m = re.firstMatch(path);
      if (m == null) continue;
      if (method != r.method) {
        methodMismatch = true;
        continue;
      }
      name = n;
      match = m;
      break;
    }
    if (name == null || match == null) {
      await _json(r, methodMismatch ? 405 : 404,
          methodMismatch ? {'detail': 'Method "${r.method}" not allowed.'} : FixtureV1Api.fixture('error.404.json'));
      return;
    }
    if (_tooOld(r)) {
      await _json(r, 426, _updateBody(null));
      return;
    }
    if (!_public.contains(name) && !_authorised(r)) {
      await _json(r, 401, FixtureV1Api.fixture('error.401.json'));
      return;
    }
    int id([int group = 1]) => int.parse(match!.group(group)!);
    String? header(String n) => r.headers.value(n);
    String key() => header(V1Headers.idempotencyKey) ?? '';
    String lockdown() => header(V1Headers.lockdownSession) ?? '';

    try {
      switch (name) {
        case 'code':
          final challenge = '${(await _body(r))['challenge'] ?? ''}'.trim();
          if (!RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(challenge)) {
            await _json(r, 400, {'detail': 'Invalid challenge.'});
            return;
          }
          await _json(r, 200, {'code': mintCode(challenge), 'expires_in': 120});
        case 'exchange':
          await _exchange(r);
        case 'refresh':
          final refresh = '${(await _body(r))['refresh'] ?? ''}';
          if (_refresh == null || refresh != _refresh) {
            await _json(r, 401, {'detail': 'Token is invalid or expired', 'code': 'token_not_valid'});
            return;
          }
          await _json(r, 200, _mint());
        case 'home':
          await _home(r);
        case 'ppOpen':
          final b = PastpaperOpenRequest.fromJson(JsonReader.of(await _body(r)));
          await _json(r, 200, (await api.pastpaperOpen(id(), b)).toJson());
        case 'ppStart':
          await _body(r);
          await _json(r, 200, (await api.pastpaperStart(id(), idempotencyKey: key())).toJson());
        case 'ppSync':
          final b = SyncRequest.fromJson(JsonReader.of(await _body(r)));
          await _json(r, 200, (await api.pastpaperSync(id(), b, idempotencyKey: key())).toJson());
        case 'ppSubmit':
          final b = SyncRequest.fromJson(JsonReader.of(await _body(r)));
          await _json(r, 200, (await api.pastpaperSubmit(id(), b, idempotencyKey: key())).toJson());
        case 'ppPause':
          await _body(r);
          await _json(r, 200, (await api.pastpaperPause(id())).toJson());
        case 'ppResume':
          await _body(r);
          await _json(r, 200, (await api.pastpaperResume(id())).toJson());
        case 'ppResult':
          await _json(r, 200, (await api.pastpaperResult(id(), have: _have(r.uri))).toJson());
        case 'mtPrepare':
          final b = MidtermPrepareRequest.fromJson(JsonReader.of(await _body(r)));
          await _json(r, 200, (await api.midtermPrepare(id(), b)).toJson());
        case 'mtChallenge':
          await _body(r);
          await _json(r, 200, (await api.midtermChallenge(id())).toJson());
        case 'mtSession':
          final b = LockdownSessionRequest.fromJson(JsonReader.of(await _body(r)));
          await _json(r, 200, (await api.midtermSession(id(), b)).toJson());
        case 'mtOpen':
          final b = MidtermOpenRequest.fromJson(JsonReader.of(await _body(r)));
          await _json(r, 200, (await api.midtermOpen(id(), b, lockdownSession: lockdown())).toJson());
        case 'mtSync':
          final b = SyncRequest.fromJson(JsonReader.of(await _body(r)));
          await _json(r, 200,
              (await api.midtermSync(id(), b, lockdownSession: lockdown(), idempotencyKey: key())).toJson());
        case 'mtSubmit':
          final b = SyncRequest.fromJson(JsonReader.of(await _body(r)));
          await _json(r, 200,
              (await api.midtermSubmit(id(), b, lockdownSession: lockdown(), idempotencyKey: key())).toJson());
        case 'mtOffscreen':
          final b = OffscreenRequest.fromJson(JsonReader.of(await _body(r)));
          await _json(r, 200,
              (await api.midtermOffscreen(id(), b, lockdownSession: lockdown(), idempotencyKey: key())).toJson());
        case 'mtResult':
          await _json(r, 200, (await api.midtermResult(id())).toJson());
        case 'media':
          final kind = AttemptKind.fromWire(match.group(1)!);
          final lockdownHeader = header(V1Headers.lockdownSession);
          await _json(r, 200, (await api.media(kind, id(2), lockdownSession: lockdownHeader)).toJson());
        case 'annotation':
          await api.annotationWrite(AnnotationWriteRequest.fromJson(JsonReader.of(await _body(r))));
          await _json(r, 204, null);
        case 'report':
          final b = QuestionReportRequest.fromJson(JsonReader.of(await _body(r)));
          final out = await api.questionReport(b, idempotencyKey: key());
          await _json(r, out.deduped ? 200 : 201, out.toJson());
        case 'ppReportPdf':
          await _bytes(r, await api.pastpaperReportPdf(id()), 'application/pdf');
        case 'ppCertPdf':
          await _bytes(r, await api.pastpaperCertificatePdf(id()), 'application/pdf');
        case 'mtReportPdf':
          await _bytes(r, await api.midtermErrorReportPdf(id()), 'application/pdf');
        case 'mtCertPdf':
          await _bytes(r, await api.midtermCertificatePdf(Uri.decodeComponent(match.group(1)!)), 'application/pdf');
      }
    } on ApiException catch (e) {
      await _error(r, e);
    } on FormatException catch (e) {
      await _json(r, 400, {'detail': 'Bad request: ${e.message}', 'code': 'bad_request'});
    }
  }

  static Map<int, String> _have(Uri uri) {
    final raw = uri.queryParameters['have'];
    if (raw == null || raw.isEmpty) return const {};
    final out = <int, String>{};
    for (final part in raw.split(',')) {
      final i = part.indexOf(':');
      if (i <= 0) continue;
      final id = int.tryParse(part.substring(0, i));
      if (id != null) out[id] = part.substring(i + 1);
    }
    return out;
  }

  Future<void> _exchange(HttpRequest r) async {
    final b = await _body(r);
    final code = '${b['code'] ?? ''}'.trim();
    final verifier = '${b['verifier'] ?? ''}'.trim();
    const refused = {'detail': 'This sign-in link has expired. Sign in again from the app.'};
    final row = _codes.remove(code); // spent on the first try either way
    if (row == null ||
        row.expires.isBefore(_now()) ||
        !RegExp(r'^[A-Za-z0-9._~-]{43,128}$').hasMatch(verifier) ||
        _s256(verifier) != row.challenge) {
      await _json(r, 400, refused);
      return;
    }
    final native = (r.headers.value(V1Headers.client) ?? '').startsWith('windows/');
    await _json(r, 200, native ? {'ok': true, ..._mint()} : {'ok': true});
  }

  static String _s256(String verifier) =>
      base64Url.encode(sha256.convert(ascii.encode(verifier)).bytes).replaceAll('=', '');

  Future<void> _home(HttpRequest r) async {
    final fetch = await api.home();
    final json = fetch.home!.toJson();
    final mode = updateMode;
    if (mode != null) {
      final app = (json['app']! as Map).cast<String, Object?>();
      app['update'] = mode.name;
      app['message'] = switch (mode) {
        FixtureUpdateMode.none => '',
        FixtureUpdateMode.available => 'A new version of MasterSAT is available.',
        FixtureUpdateMode.required => 'This version is out of date. Update to keep going.',
      };
      if (mode != FixtureUpdateMode.none) app['latest_version'] = '0.3.0';
      if (mode == FixtureUpdateMode.required) app['minimum_version'] = '0.3.0';
      json['app'] = app;
    }
    final stable = Map.of(json)..remove('server_now');
    final etag = '"sha256:${sha256.convert(utf8.encode(jsonEncode(stable)))}"';
    if (r.headers.value(HttpHeaders.ifNoneMatchHeader) == etag) {
      await _json(r, 304, null, headers: {'ETag': etag});
      return;
    }
    await _json(r, 200, json, headers: {'ETag': etag});
  }

  // ------------------------------------------------------------------------------------------
  // /__fixture__/ control
  // ------------------------------------------------------------------------------------------

  Future<void> _control(HttpRequest r) async {
    final q = r.uri.queryParameters;
    bool on() => q['on'] != '0' && q['on'] != 'false';
    switch (r.uri.path) {
      case '/__fixture__/state':
        break;
      case '/__fixture__/offline':
        offline = on();
      case '/__fixture__/expire-access':
        expireAccessTokens();
      case '/__fixture__/revoke':
        revokeAll();
      case '/__fixture__/update':
        final m = q['mode'];
        updateMode = m == null || m == 'fixture' ? null : FixtureUpdateMode.values.byName(m);
      case '/__fixture__/minimum-version':
        final v = q['v'];
        minimumVersion = (v == null || v.isEmpty) ? null : v;
      case '/__fixture__/latency':
        latency = Duration(milliseconds: int.tryParse(q['ms'] ?? '') ?? 0);
      case '/__fixture__/reset':
        api = FixtureV1Api(now: _now);
        revokeAll();
        _codes.clear();
        offline = false;
        updateMode = null;
        minimumVersion = null;
      default:
        await _json(r, 404, {'detail': 'Unknown control ${r.uri.path}'});
        return;
    }
    await _json(r, 200, {
      'offline': offline,
      'update_mode': updateMode?.name,
      'minimum_version': minimumVersion,
      'latency_ms': latency.inMilliseconds,
      'live_access_tokens': _access.length,
      'requests': requestLog.length,
    });
  }
}

class _Code {
  _Code(this.challenge, this.expires);
  final String challenge;
  final DateTime expires;
}
