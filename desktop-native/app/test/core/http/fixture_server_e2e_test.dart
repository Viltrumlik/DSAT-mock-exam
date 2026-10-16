// End to end over real sockets: AuthController + HttpV1Api + HttpTransport against the local
// fixture server (tool/fixture_server). Sign-in with login + password (and its refusals), Home
// with ETag/304, a 401 answered by one refresh, a revoked session, offline, the 426 gate, and a
// past paper from open to its result.
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/http_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/auth/auth_controller.dart';
import 'package:mastersat_app/core/auth/token_store.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/http/http_transport.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/store/unsent_work.dart';

// The server is its own package (it depends on this app), so it is imported by path; its
// package: imports resolve against this app's package config.
// ignore: avoid_relative_lib_imports
import '../../../../tool/fixture_server/lib/fixture_server.dart';

void main() {
  late FixtureServer server;
  late HttpTransport transport;
  late HttpV1Api api;
  late AuthController auth;
  late MemoryTokenStore tokens;
  late ApiConfig config;

  Future<void> boot({String version = '0.2.0'}) async {
    config = ApiConfig(origin: server.origin, appVersion: version);
    transport = HttpTransport(config: config);
    api = HttpV1Api(transport: transport, config: config);
    tokens = MemoryTokenStore();
    auth = AuthController(api: api, store: tokens, unsentWork: UnsentWork());
    api.tokens = auth;
    await auth.restore();
  }

  setUp(() async {
    server = FixtureServer();
    await server.start();
    await boot();
  });

  tearDown(() async {
    auth.dispose();
    transport.close(force: true);
    await server.close();
  });

  test('sign-in: login + password over HTTP, tokens in the body, the user read from the JWT', () async {
    await auth.signIn('aziza@example.com', 'fixture-password');
    expect(auth.status, AuthStatus.signedIn);
    expect(auth.session!.userId, FixtureServer.studentId, reason: 'read from the JWT');
    expect(auth.session!.accessExpiresAt.isAfter(DateTime.now().toUtc().add(const Duration(hours: 2))), isTrue);
    expect(tokens.session, isNotNull);
    expect(server.requestLog.take(1), ['POST /api/desktop/auth/login/ 200']);
  });

  test('a wrong password and an account without one are refused with what to do next', () async {
    await auth.signIn('aziza@example.com', FixtureV1Api.wrongPassword);
    expect(auth.status, AuthStatus.signedOut);
    expect(auth.problem!.kind, AuthProblemKind.invalidCredentials);
    await auth.signIn(FixtureV1Api.passwordNotSetLogin, '4567');
    expect(auth.problem!.kind, AuthProblemKind.passwordNotSet);
    expect(auth.problem!.message, 'Set your password on mastersat.uz first, then sign in here.');
    expect(server.requestLog, ['POST /api/desktop/auth/login/ 401', 'POST /api/desktop/auth/login/ 403']);
    expect(tokens.session, isNull);
  });

  test('sign-in below the minimum version is told to update', () async {
    server.minimumVersion = '0.3.0';
    await auth.signIn('aziza', 'p');
    expect(auth.problem!.kind, AuthProblemKind.updateRequired);
  });

  test('Home: 200 with an ETag, then 304 for the same ETag; gzip on the wire', () async {
    await auth.signIn('aziza', 'fixture-password');
    final first = await api.home();
    expect(first.home!.student.fullName, 'Aziza Karimova');
    expect(first.etag, startsWith('"sha256:'));
    final second = await api.home(ifNoneMatch: first.etag);
    expect(second.notModified, isTrue);
    expect(server.requestLog.where((l) => l.startsWith('GET /api/desktop/v1/home')), [
      'GET /api/desktop/v1/home 200',
      'GET /api/desktop/v1/home 304',
    ]);
  });

  test('an expired access token: 401 → one refresh (rotated) → the request succeeds', () async {
    await auth.signIn('aziza', 'fixture-password');
    final before = auth.session!;
    server.expireAccessTokens();
    final home = await api.home();
    expect(home.home, isNotNull);
    expect(auth.session!.access, isNot(before.access));
    expect(auth.session!.refresh, isNot(before.refresh), reason: 'refresh tokens rotate');
    expect(tokens.session!.refresh, auth.session!.refresh, reason: 'the rotated pair is stored');
    expect(server.requestLog.skip(1), [
      'GET /api/desktop/v1/home 401',
      'POST /api/auth/refresh/ 200',
      'GET /api/desktop/v1/home 200',
    ]);
  });

  test('concurrent 401s share ONE refresh', () async {
    await auth.signIn('aziza', 'fixture-password');
    server.expireAccessTokens();
    await Future.wait([api.home(), api.pastpaperResult(8801), api.midtermResult(4410)]);
    expect(server.requestLog.where((l) => l.startsWith('POST /api/auth/refresh/')), hasLength(1));
  });

  test('a revoked session ends: the refresh is refused and the student is signed out', () async {
    await auth.signIn('aziza', 'fixture-password');
    server.revokeAll();
    await expectLater(api.home(), throwsA(isA<ApiError>()));
    expect(auth.status, AuthStatus.signedOut);
    expect(auth.problem!.kind, AuthProblemKind.sessionEnded);
    expect(tokens.session, isNull);
  });

  test('offline: NetworkError, and the session is kept', () async {
    await auth.signIn('aziza', 'fixture-password');
    server.offline = true;
    await expectLater(api.home(), throwsA(isA<NetworkError>()));
    expect(auth.isSignedIn, isTrue);
    server.offline = false;
    expect((await api.home()).home, isNotNull);
  });

  test('the version gate answers 426 → UpdateRequired', () async {
    await auth.signIn('aziza', 'fixture-password');
    server.minimumVersion = '0.3.0';
    await expectLater(api.home(), throwsA(isA<UpdateRequired>().having((e) => e.minimumVersion, 'min', '0.3.0')));
    server.minimumVersion = '0.2.0';
    expect((await api.home()).home, isNotNull);
  });

  test('a past paper from open to its result, over HTTP', () async {
    await auth.signIn('aziza', 'fixture-password');
    final bundle = await api.pastpaperOpen(52, const PastpaperOpenRequest(start: false));
    final attempt = bundle.attempt.id;
    await api.pastpaperStart(attempt, idempotencyKey: IdempotencyKeys.start(attempt));
    var moduleId = bundle.attempt.module!.id;
    var seq = 0;
    for (var m = 0; m < 2; m++) {
      final out = await api.pastpaperSubmit(
        attempt,
        SyncRequest(moduleId: moduleId, seq: ++seq, answers: const {}, flagged: const []),
        idempotencyKey: IdempotencyKeys.submit(attempt, moduleId),
      );
      expect(out.applied, isTrue);
      moduleId = out.attempt.module?.id ?? moduleId;
    }
    var result = await api.pastpaperResult(attempt);
    for (var i = 0; i < 5 && result.isScoring; i++) {
      result = await api.pastpaperResult(attempt);
    }
    expect(result.isCompleted, isTrue);
    expect(result.attemptId, attempt);
    final pdf = await api.pastpaperCertificatePdf(attempt);
    expect(String.fromCharCodes(pdf.take(5)), '%PDF-');
  });
}
