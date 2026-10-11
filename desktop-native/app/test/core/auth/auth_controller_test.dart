// AuthController with FakeNativeBridge (real S256 PKCE), the stateful FixtureV1Api and an
// in-memory token store: the browser hand-off, every exchange failure, background refresh
// (never cut short, signs out only on 400/401), single-flight refresh, and sign-out.
import 'package:fake_async/fake_async.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/http_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/auth/auth_controller.dart';
import 'package:mastersat_app/core/auth/launch_links.dart';
import 'package:mastersat_app/core/auth/session.dart';
import 'package:mastersat_app/core/auth/token_store.dart';
import 'package:mastersat_app/core/clock/clock.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/store/unsent_work.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';

import '../harness/app_harness.dart' show fakeJwt;

class _Rig {
  _Rig({DateTime? start, AuthSession? session, this.opens = true})
      : clock = ManualClock(start ?? DateTime.utc(2026, 10, 11, 9)),
        tokens = MemoryTokenStore(session: session) {
    api = FixtureV1Api(now: clock.now);
    auth = AuthController(
      api: api,
      native: native,
      store: tokens,
      config: ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0'),
      unsentWork: unsent,
      clock: clock,
      openUrl: (url) async {
        opened.add(url);
        if (!opens) throw StateError('no browser');
        return true;
      },
    );
  }

  final ManualClock clock;
  final MemoryTokenStore tokens;
  final FakeNativeBridge native = FakeNativeBridge();
  final UnsentWork unsent = UnsentWork();
  final List<Uri> opened = [];
  final bool opens;
  late final FixtureV1Api api;
  late final AuthController auth;

  int calls(String m) => api.calls.where((c) => c.method == m).length;
}

AuthSession session(DateTime now, {Duration left = const Duration(hours: 3), String refresh = 'eyJhbGciOiJIUzI1NiJ9.fixture-refresh.sig'}) =>
    AuthSession(access: fakeJwt(expires: now.add(left)), refresh: refresh, obtainedAt: now, userId: 77);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('start-up', () {
    test('no stored session → signed out', () async {
      final r = _Rig();
      await r.auth.restore();
      expect(r.auth.status, AuthStatus.signedOut);
      expect(r.auth.accessToken, isNull);
    });

    test('a stored session → signed in, with the refresh due 30 min before expiry', () async {
      final now = DateTime.utc(2026, 10, 11, 9);
      final r = _Rig(session: session(now));
      await r.auth.restore();
      expect(r.auth.status, AuthStatus.signedIn);
      expect(r.auth.nextRefreshAt, now.add(const Duration(hours: 2, minutes: 30)));
      r.auth.dispose();
    });

    test('an abandoned browser sign-in older than 10 minutes is forgotten', () async {
      final r = _Rig();
      r.tokens.pending = PendingSignIn(verifier: 'v' * 43, challenge: 'c', startedAt: r.clock.now().subtract(const Duration(minutes: 11)));
      await r.auth.restore();
      expect(r.auth.pendingSignIn, isNull);
      expect(r.tokens.pending, isNull);
    });
  });

  group('sign-in through the browser', () {
    test('opens /desktop/link with the S256 challenge; the verifier never leaves', () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.signIn();
      expect(r.auth.status, AuthStatus.waitingForBrowser);
      final url = r.opened.single;
      expect(url.origin, 'https://mastersat.uz');
      expect(url.path, '/desktop/link');
      expect(url.queryParameters['challenge'], FakeNativeBridge.pkceChallenge(FakeNativeBridge.fixedVerifier));
      expect(url.toString(), isNot(contains(FakeNativeBridge.fixedVerifier)));
      expect(r.tokens.pending!.verifier, FakeNativeBridge.fixedVerifier, reason: 'kept for a cold-start link');
    });

    test('the deep link completes it: exchange {code, verifier}, tokens stored, user known', () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.signIn();
      await r.auth.handleLink('mastersat://auth?code=abc123');
      expect(r.auth.status, AuthStatus.signedIn);
      final call = r.api.calls.singleWhere((c) => c.method == 'authExchange');
      expect(call.args, {'code': 'abc123', 'verifier': FakeNativeBridge.fixedVerifier});
      expect(r.tokens.session!.access, r.auth.accessToken);
      expect(r.tokens.pending, isNull);
    });

    test('a link with no sign-in started here is refused', () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.handleLink('mastersat://auth?code=abc');
      expect(r.auth.problem!.kind, AuthProblemKind.notStartedHere);
      expect(r.calls('authExchange'), 0);
    });

    test('other links are ignored', () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.signIn();
      for (final l in ['https://mastersat.uz/?code=1', 'mastersat://other?code=1', 'mastersat://auth', 'mastersat://auth/x?code=1']) {
        await r.auth.handleLink(l);
      }
      expect(r.auth.status, AuthStatus.waitingForBrowser);
      expect(r.calls('authExchange'), 0);
    });

    test('the same link delivered twice exchanges once', () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.signIn();
      await Future.wait([r.auth.handleLink('mastersat://auth?code=x'), r.auth.handleLink('mastersat://auth?code=x')]);
      expect(r.calls('authExchange'), 1);
      expect(r.auth.isSignedIn, isTrue);
    });

    test('offline: "Try again" re-sends the SAME exchange (no second browser trip)', () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.signIn();
      r.api.offline = true;
      await r.auth.handleLink('mastersat://auth?code=c1');
      expect(r.auth.status, AuthStatus.signedOut);
      expect(r.auth.problem!.kind, AuthProblemKind.offline);
      expect(r.auth.problem!.canRetry, isTrue);
      r.api.offline = false;
      await r.auth.retry();
      expect(r.auth.isSignedIn, isTrue);
      final exchanges = r.api.calls.where((c) => c.method == 'authExchange').map((c) => c.args).toList();
      expect(exchanges, hasLength(2));
      expect(exchanges[0], exchanges[1]);
      expect(r.opened, hasLength(1));
    });

    test('every refusal says what to do next', () async {
      Future<AuthProblem> failWith(ApiException e) async {
        final r = _Rig();
        await r.auth.restore();
        await r.auth.signIn();
        r.api.failNext(e);
        await r.auth.handleLink('mastersat://auth?code=c');
        return r.auth.problem!;
      }

      final expired = await failWith(ApiError(status: 400, body: ApiErrorBody(detail: 'expired')));
      expect(expired.kind, AuthProblemKind.linkExpired);
      expect(expired.canRetry, isFalse);
      final refused = await failWith(ApiError(status: 403, body: ApiErrorBody(detail: 'Your account is paused.')));
      expect(refused.kind, AuthProblemKind.refused);
      expect(refused.message, 'Your account is paused.');
      final busy = await failWith(ApiError(status: 429, body: ApiErrorBody(detail: 'slow down')));
      expect(busy.kind, AuthProblemKind.server);
      expect(busy.canRetry, isTrue);
      final down = await failWith(ApiError(status: 503, body: ApiErrorBody(detail: 'x')));
      expect(down.canRetry, isTrue);
      final old = await failWith(const UpdateRequired(updateUrl: ''));
      expect(old.kind, AuthProblemKind.updateRequired);
    });

    test("a browser that won't open is reported", () async {
      final r = _Rig(opens: false);
      await r.auth.restore();
      await r.auth.signIn();
      expect(r.auth.problem!.kind, AuthProblemKind.browserFailed);
    });

    test('Cancel goes back; a link that still arrives completes the sign-in', () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.signIn();
      r.auth.cancelSignIn();
      expect(r.auth.status, AuthStatus.signedOut);
      await r.auth.handleLink('mastersat://auth?code=late');
      expect(r.auth.isSignedIn, isTrue);
    });

    test('links from the runner: pending first (cold start), then live; each focuses the window', () async {
      const channel = MethodChannel('test/launch');
      final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      final nativeCalls = <String>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        nativeCalls.add(call.method);
        if (call.method == 'takePending') return <Object?>['mastersat://auth?code=cold'];
        return true;
      });
      addTearDown(() => messenger.setMockMethodCallHandler(channel, null));

      final r = _Rig();
      await r.auth.restore();
      r.tokens.pending =
          PendingSignIn(verifier: FakeNativeBridge.fixedVerifier, challenge: 'c', startedAt: r.clock.now());
      final links = LaunchLinks(channel: channel);
      addTearDown(links.dispose);
      await r.auth.attachLinks(links);
      expect(r.auth.isSignedIn, isTrue);
      expect(nativeCalls, ['takePending', 'focusWindow']);
      r.auth.dispose();
    });
  });

  group('refresh', () {
    test('runs in the background 30 min before expiry and stores the rotated pair', () {
      fakeAsync((fa) {
        final start = DateTime.utc(2026, 10, 11, 9);
        final r = _Rig(session: session(start));
        r.auth.restore();
        fa.flushMicrotasks();
        fa.elapse(const Duration(hours: 2, minutes: 29));
        expect(r.calls('authRefresh'), 0);
        r.clock.advance(const Duration(hours: 2, minutes: 30));
        fa.elapse(const Duration(minutes: 1));
        expect(r.calls('authRefresh'), 1);
        expect(r.tokens.session!.refresh, isNot('eyJhbGciOiJIUzI1NiJ9.fixture-refresh.sig'));
        expect(r.auth.accessToken, r.tokens.session!.access);
        r.auth.dispose();
      });
    });

    test('a refresh that cannot reach the server keeps the session and retries with backoff', () {
      fakeAsync((fa) {
        final start = DateTime.utc(2026, 10, 11, 9);
        final r = _Rig(session: session(start, left: const Duration(minutes: 10)));
        r.auth.restore();
        r.api.offline = true;
        fa.flushMicrotasks();
        fa.elapse(Duration.zero);
        expect(r.calls('authRefresh'), 1);
        expect(r.auth.isSignedIn, isTrue);
        fa.elapse(const Duration(seconds: 30));
        expect(r.calls('authRefresh'), 2);
        fa.elapse(const Duration(seconds: 60));
        expect(r.calls('authRefresh'), 3, reason: 'backoff doubles');
        r.api.offline = false;
        fa.elapse(const Duration(seconds: 120));
        expect(r.calls('authRefresh'), 4);
        expect(r.auth.isSignedIn, isTrue);
        r.auth.dispose();
      });
    });

    test('a 5xx keeps the session; only a definite 400/401 ends it', () async {
      final now = DateTime.utc(2026, 10, 11, 9);
      final r = _Rig(session: session(now));
      await r.auth.restore();
      r.api.failNext(ApiError(status: 503, body: ApiErrorBody(detail: 'x')));
      expect(await r.auth.refreshNow(), RecoverOutcome.unreachable);
      expect(r.auth.isSignedIn, isTrue);

      r.api.failNext(ApiError(status: 401, body: ApiErrorBody(detail: 'Token is invalid or expired')));
      expect(await r.auth.refreshNow(), RecoverOutcome.denied);
      expect(r.auth.status, AuthStatus.signedOut);
      expect(r.auth.problem!.kind, AuthProblemKind.sessionEnded);
      expect(r.tokens.session, isNull);
    });

    test('any number of 401s at once cause ONE refresh', () async {
      final now = DateTime.utc(2026, 10, 11, 9);
      final r = _Rig(session: session(now));
      await r.auth.restore();
      r.api.latency = const Duration(milliseconds: 20);
      final used = r.auth.accessToken;
      final outcomes = await Future.wait([for (var i = 0; i < 5; i++) r.auth.recoverFromUnauthorized(used)]);
      expect(outcomes, everyElement(RecoverOutcome.retry));
      expect(r.calls('authRefresh'), 1);
      // A 401 for a token that was already replaced just retries.
      expect(await r.auth.recoverFromUnauthorized(used), RecoverOutcome.retry);
      expect(r.calls('authRefresh'), 1);
      r.auth.dispose();
    });

    test('signing out while a refresh is in flight does not bring the session back', () async {
      final now = DateTime.utc(2026, 10, 11, 9);
      final r = _Rig(session: session(now));
      await r.auth.restore();
      r.api.latency = const Duration(milliseconds: 20);
      final refreshing = r.auth.refreshNow();
      await r.auth.signOut();
      expect(await refreshing, RecoverOutcome.denied);
      expect(r.auth.isSignedIn, isFalse);
      expect(r.tokens.session, isNull);
    });

    test('ensureFreshFor refreshes only when too little time is left', () async {
      final now = DateTime.utc(2026, 10, 11, 9);
      final r = _Rig(session: session(now, left: const Duration(hours: 3)));
      await r.auth.restore();
      await r.auth.ensureFreshFor(const Duration(hours: 2));
      expect(r.calls('authRefresh'), 0);
      await r.auth.ensureFreshFor(const Duration(hours: 4));
      expect(r.calls('authRefresh'), 1);
      r.auth.dispose();
    });
  });

  group('sign-out', () {
    test('is blocked while answers are unsent; "anyway" forces it', () async {
      final now = DateTime.utc(2026, 10, 11, 9);
      final r = _Rig(session: session(now));
      await r.auth.restore();
      r.unsent.register('exam outbox', () => 2);
      final blocked = await r.auth.signOut();
      expect(blocked, isA<SignOutBlocked>());
      expect((blocked as SignOutBlocked).unsent.total, 2);
      expect(r.auth.isSignedIn, isTrue);
      expect(await r.auth.signOut(force: true), isA<SignedOut>());
      expect(r.auth.isSignedIn, isFalse);
      expect(r.tokens.session, isNull);
    });

    test('remembers the student from Home (keys the per-user database)', () async {
      final now = DateTime.utc(2026, 10, 11, 9);
      final r = _Rig(session: AuthSession(access: 'opaque', refresh: 'r', obtainedAt: now));
      await r.auth.restore();
      expect(r.auth.session!.userId, isNull);
      await r.auth.rememberStudent(const Student(id: 77, firstName: 'Aziza', lastName: 'Karimova'));
      expect(r.tokens.session!.userId, 77);
      expect(r.tokens.session!.displayName, 'Aziza Karimova');
      r.auth.dispose();
    });
  });
}
