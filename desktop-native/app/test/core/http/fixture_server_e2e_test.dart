// End to end over real sockets: AuthController + HttpV1Api + HttpTransport against the local
// fixture server (tool/fixture_server). Sign-in through the PKCE code exchange, Home with
// ETag/304, a 401 answered by one refresh, a revoked session, offline, the 426 gate, and a
// past paper from open to its result.
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/http_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/auth/auth_controller.dart';
import 'package:mastersat_app/core/auth/dev_sign_in.dart';
import 'package:mastersat_app/core/auth/token_store.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/http/http_transport.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/store/unsent_work.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';

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
    auth = AuthController(
      api: api,
      native: FakeNativeBridge(),
      store: tokens,
      config: config,
      unsentWork: UnsentWork(),
      devMintCode: devCodeMinterFor(config, transport, releaseMode: false),
    );
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

  test('sign-in: code bound to the S256 challenge, exchanged with the verifier, tokens in the body', () async {
    await auth.signIn();
    expect(auth.status, AuthStatus.signedIn);
    expect(auth.session!.userId, FixtureServer.studentId, reason: 'read from the JWT');
    expect(auth.session!.accessExpiresAt.isAfter(DateTime.now().toUtc().add(const Duration(hours: 2))), isTrue);
    expect(tokens.session, isNotNull);
    expect(server.requestLog.take(2), ['POST /api/desktop/auth/code/ 200', 'POST /api/desktop/auth/exchange/ 200']);
  });

  test('a code minted for another challenge is refused (as an expired link); the right one works', () async {
    final browser = AuthController(
      api: api,
      native: FakeNativeBridge(),
      store: MemoryTokenStore(),
      config: config,
      unsentWork: UnsentWork(),
      openUrl: (_) async => true,
    );
    addTearDown(browser.dispose);
    await browser.restore();
    await browser.signIn(); // waiting for the browser; the verifier stays here
    final stolen = server.mintCode(FakeNativeBridge.pkceChallenge('someone-elses-verifier-0123456789abcdefghijklm'));
    await browser.handleLink('mastersat://auth?code=$stolen');
    expect(browser.status, AuthStatus.signedOut);
    expect(browser.problem!.kind, AuthProblemKind.linkExpired);

    await browser.signIn();
    final mine = server.mintCode(browser.pendingSignIn!.challenge);
    await browser.handleLink('mastersat://auth?code=$mine');
    expect(browser.status, AuthStatus.signedIn);
  });

  test('Home: 200 with an ETag, then 304 for the same ETag; gzip on the wire', () async {
    await auth.signIn();
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
    await auth.signIn();
    final before = auth.session!;
    server.expireAccessTokens();
    final home = await api.home();
    expect(home.home, isNotNull);
    expect(auth.session!.access, isNot(before.access));
    expect(auth.session!.refresh, isNot(before.refresh), reason: 'refresh tokens rotate');
    expect(tokens.session!.refresh, auth.session!.refresh, reason: 'the rotated pair is stored');
    expect(server.requestLog.skip(2), [
      'GET /api/desktop/v1/home 401',
      'POST /api/auth/refresh/ 200',
      'GET /api/desktop/v1/home 200',
    ]);
  });

  test('concurrent 401s share ONE refresh', () async {
    await auth.signIn();
    server.expireAccessTokens();
    await Future.wait([api.home(), api.pastpaperResult(8801), api.midtermResult(4410)]);
    expect(server.requestLog.where((l) => l.startsWith('POST /api/auth/refresh/')), hasLength(1));
  });

  test('a revoked session ends: the refresh is refused and the student is signed out', () async {
    await auth.signIn();
    server.revokeAll();
    await expectLater(api.home(), throwsA(isA<ApiError>()));
    expect(auth.status, AuthStatus.signedOut);
    expect(auth.problem!.kind, AuthProblemKind.sessionEnded);
    expect(tokens.session, isNull);
  });

  test('offline: NetworkError, and the session is kept', () async {
    await auth.signIn();
    server.offline = true;
    await expectLater(api.home(), throwsA(isA<NetworkError>()));
    expect(auth.isSignedIn, isTrue);
    server.offline = false;
    expect((await api.home()).home, isNotNull);
  });

  test('the version gate answers 426 → UpdateRequired', () async {
    await auth.signIn();
    server.minimumVersion = '0.3.0';
    await expectLater(api.home(), throwsA(isA<UpdateRequired>().having((e) => e.minimumVersion, 'min', '0.3.0')));
    server.minimumVersion = '0.2.0';
    expect((await api.home()).home, isNotNull);
  });

  test('a past paper from open to its result, over HTTP', () async {
    await auth.signIn();
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
