// HttpV1Api over a scripted Transport: the headers every call carries, status → typed error
// mapping, the single 401 → refresh → resend, 304, Retry-After and the Date header.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/http_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/http/http_transport.dart';
import 'package:mastersat_app/core/models/models.dart';

class ScriptedTransport implements Transport {
  final List<TransportRequest> requests = [];
  final List<TransportResponse Function(TransportRequest r)> _script = [];

  void reply(int status, [Object? json, Map<String, String> headers = const {}]) => _script.add((_) => TransportResponse(
        status: status,
        headers: {for (final e in headers.entries) e.key.toLowerCase(): e.value},
        body: Uint8List.fromList(json == null ? const [] : (json is String ? utf8.encode(json) : utf8.encode(jsonEncode(json)))),
      ));

  void fail(Object error) => _script.add((_) => throw error);

  @override
  Future<TransportResponse> send(TransportRequest request) async {
    requests.add(request);
    if (_script.isEmpty) throw StateError('no scripted reply for ${request.method} ${request.url}');
    return _script.removeAt(0)(request);
  }

  @override
  void close({bool force = false}) {}
}

class FakeTokens implements AccessTokenSource {
  FakeTokens(this.accessToken);

  @override
  String? accessToken;

  RecoverOutcome next = RecoverOutcome.retry;
  String? rotateTo = 'access-2';
  final List<String?> recovered = [];

  @override
  Future<RecoverOutcome> recoverFromUnauthorized(String? usedAccess) async {
    recovered.add(usedAccess);
    if (next == RecoverOutcome.retry) accessToken = rotateTo;
    return next;
  }
}

Map<String, Object?> fx(String file) => FixtureV1Api.fixture(file);

void main() {
  late ScriptedTransport t;
  late FakeTokens tokens;
  late HttpV1Api api;
  final config = ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0');

  setUp(() {
    t = ScriptedTransport();
    tokens = FakeTokens('access-1');
    api = HttpV1Api(transport: t, config: config)..tokens = tokens;
  });

  test('every call says who it is; authenticated calls carry the bearer token', () async {
    t.reply(200, fx('home.response.json'), {'ETag': '"e1"'});
    final home = await api.home();
    final r = t.requests.single;
    expect(r.method, 'GET');
    expect(r.url.toString(), 'https://mastersat.uz/api/desktop/v1/home');
    expect(r.headers['X-MasterSAT-Client'], 'windows/0.2.0');
    expect(r.headers['Accept'], 'application/json');
    expect(r.headers['Authorization'], 'Bearer access-1');
    expect(r.headers.containsKey('If-None-Match'), isFalse);
    expect(r.headers.keys.any((k) => k.toLowerCase() == 'cookie'), isFalse);
    expect(r.timeout, config.readTimeout);
    expect(home.etag, '"e1"');
    expect(home.home!.student.firstName, 'Aziza');
  });

  test('home with If-None-Match: a 304 is "not modified", keeping the ETag', () async {
    t.reply(304, null, {'ETag': '"e1"'});
    final f = await api.home(ifNoneMatch: '"e1"');
    expect(t.requests.single.headers['If-None-Match'], '"e1"');
    expect(f.notModified, isTrue);
    expect(f.home, isNull);
    expect(f.etag, '"e1"');
  });

  test('writes carry Idempotency-Key, the JSON body, and the write timeout', () async {
    t.reply(200, fx('pastpaper_sync.response.json'));
    final body = SyncRequest.fromJson(JsonReader.of(fx('pastpaper_sync.request.json')));
    await api.pastpaperSync(9123, body, idempotencyKey: IdempotencyKeys.sync(9123, 301, 4));
    final r = t.requests.single;
    expect(r.method, 'POST');
    expect(r.url.path, '/api/desktop/v1/pastpapers/attempts/9123/sync');
    expect(r.headers['Idempotency-Key'], 'sync.9123.301.4');
    expect(r.headers['Content-Type'], 'application/json; charset=utf-8');
    expect(jsonDecode(utf8.decode(r.body!)), body.toJson());
    expect(r.timeout, config.writeTimeout);
  });

  test('midterm calls after the handshake carry X-Lockdown-Session', () async {
    t.reply(200, fx('midterm_sync.response.json'));
    await api.midtermSync(5521, SyncRequest.fromJson(JsonReader.of(fx('midterm_sync.request.json'))),
        lockdownSession: 'ld-token', idempotencyKey: 'sync.5521.401.1');
    expect(t.requests.single.headers['X-Lockdown-Session'], 'ld-token');
    expect(t.requests.single.headers['Idempotency-Key'], 'sync.5521.401.1');
  });

  test('open and result use the long timeout; result sends ?have=', () async {
    t.reply(200, fx('pastpaper_result.response.completed.json'));
    await api.pastpaperResult(9123, have: {301: 'sha256:aa', 302: 'sha256:bb'});
    final r = t.requests.single;
    expect(r.timeout, config.longTimeout);
    expect(r.url.queryParameters['have'], '301:sha256:aa,302:sha256:bb');
  });

  test('sign-in endpoints never send a bearer token; refresh gets 120 s', () async {
    t.reply(200, fx('auth_login.response.json'));
    t.reply(200, fx('auth_refresh.response.json'));
    final tokens = await api.authLogin(const AuthLoginRequest(identifier: 'aziza@example.com', password: 'p4ss'));
    expect(tokens.access, isNotEmpty);
    await api.authRefresh(const RefreshRequest(refresh: 'r'));
    expect(t.requests.map((r) => r.headers.containsKey('Authorization')), [false, false]);
    expect(t.requests[0].url.path, '/api/desktop/auth/login/');
    expect(t.requests[0].headers['X-MasterSAT-Client'], 'windows/0.2.0', reason: 'what makes the server call it native');
    expect(jsonDecode(utf8.decode(t.requests[0].body!)), {'identifier': 'aziza@example.com', 'password': 'p4ss'});
    expect(t.requests[1].url.path, '/api/auth/refresh/');
    expect(t.requests[1].timeout, const Duration(seconds: 120));
  });

  test('a 401 refreshes once and resends the identical request with the new token', () async {
    t.reply(401, fx('error.401.json'));
    t.reply(200, fx('pastpaper_start.response.json'));
    await api.pastpaperStart(9123, idempotencyKey: 'start.9123');
    expect(tokens.recovered, ['access-1']);
    expect(t.requests, hasLength(2));
    expect(t.requests[1].headers['Authorization'], 'Bearer access-2');
    expect(t.requests[1].headers['Idempotency-Key'], 'start.9123', reason: 'same key: the first never reached the view');
  });

  test('a second 401 after the refresh is an ApiError (no loop)', () async {
    t.reply(401, fx('error.401.json'));
    t.reply(401, fx('error.401.json'));
    await expectLater(api.home(), throwsA(isA<ApiError>().having((e) => e.isUnauthorized, 'unauthorized', isTrue)));
    expect(tokens.recovered, hasLength(1));
  });

  test('a refresh that cannot reach the server is a transient NetworkError; a refused one ends with 401', () async {
    t.reply(401, fx('error.401.json'));
    tokens.next = RecoverOutcome.unreachable;
    await expectLater(api.home(), throwsA(isA<NetworkError>()));

    t.reply(401, fx('error.401.json'));
    tokens.next = RecoverOutcome.denied;
    await expectLater(api.home(), throwsA(isA<ApiError>().having((e) => e.status, 'status', 401)));
  });

  test('426 and a lockdown "desktop_update_required" refusal are UpdateRequired, reported app-wide', () async {
    final seen = <UpdateRequired>[];
    api.onUpdateRequired = seen.add;
    t.reply(426, fx('error.426.json'));
    await expectLater(api.home(), throwsA(isA<UpdateRequired>()));
    t.reply(403, {'detail': 'Update the app.', 'reason': 'desktop_update_required', 'desktop_required': true});
    await expectLater(api.midtermChallenge(5521), throwsA(isA<UpdateRequired>()));
    expect(seen, hasLength(2));
    expect(seen.first.updateUrl, isNotEmpty);
  });

  test('other statuses become ApiError with the parsed envelope and Retry-After', () async {
    t.reply(429, fx('error.429.json'), {'Retry-After': '30'});
    final e = await api.home().then<ApiError?>((_) => null, onError: (Object e) => e as ApiError);
    expect(e!.status, 429);
    expect(e.retryAfter, const Duration(seconds: 30));
    expect(e.isTransient, isTrue);

    t.reply(409, fx('midterm_submit.response.not_expired.json'));
    final conflict = await api
        .midtermSubmit(5521, SyncRequest.fromJson(JsonReader.of(fx('midterm_submit.request.json'))),
            lockdownSession: 'x', idempotencyKey: 'submit.5521.401')
        .then<ApiError?>((_) => null, onError: (Object e) => e as ApiError);
    expect(conflict!.code, 'module_not_expired');
    expect(conflict.retryAfterMs, isNotNull);

    t.reply(502, '<html>Bad gateway</html>');
    final html = await api.home().then<ApiError?>((_) => null, onError: (Object e) => e as ApiError);
    expect(html!.body.detail, '<html>Bad gateway</html>');
  });

  test('an answer that does not parse is a NetworkError (unusable), not a crash', () async {
    t.reply(200, '{"schema":1');
    await expectLater(api.home(), throwsA(isA<NetworkError>()));
    t.reply(200, {'schema': 1});
    await expectLater(api.home(), throwsA(isA<NetworkError>()));
  });

  test('transport failures pass through as NetworkError', () async {
    t.fail(const NetworkError('No connection to the server.'));
    await expectLater(api.home(), throwsA(isA<NetworkError>()));
  });

  test("the server's Date header is reported (ServerClock)", () async {
    final dates = <DateTime>[];
    api.onServerNow = dates.add;
    t.reply(200, fx('home.response.json'), {'Date': 'Sun, 11 Oct 2026 09:00:05 GMT'});
    await api.home();
    t.reply(200, fx('home.response.json'), {'Date': 'not a date'});
    await api.home();
    expect(dates, [DateTime.utc(2026, 10, 11, 9, 0, 5)]);
  });

  test('PDFs ask for application/pdf and return the bytes', () async {
    t.reply(200, '%PDF-1.4 fake');
    final bytes = await api.midtermCertificatePdf('MT-9-77-4F2K');
    expect(utf8.decode(bytes), '%PDF-1.4 fake');
    expect(t.requests.single.headers['Accept'], 'application/pdf');
    expect(t.requests.single.url.path, '/api/classes/certificates/midterm/MT-9-77-4F2K/download/');
    expect(t.requests.single.timeout, config.longTimeout);
  });

  group('parseRetryAfter', () {
    test('seconds and HTTP dates', () {
      final now = DateTime.utc(2026, 10, 11, 9);
      expect(HttpV1Api.parseRetryAfter('30'), const Duration(seconds: 30));
      expect(HttpV1Api.parseRetryAfter('-5'), Duration.zero);
      expect(HttpV1Api.parseRetryAfter('Sun, 11 Oct 2026 09:01:00 GMT', now: now), const Duration(minutes: 1));
      expect(HttpV1Api.parseRetryAfter('Sun, 11 Oct 2026 08:00:00 GMT', now: now), Duration.zero);
      expect(HttpV1Api.parseRetryAfter('soon'), isNull);
      expect(HttpV1Api.parseRetryAfter(null), isNull);
    });
  });
}
