// AuthController with the stateful FixtureV1Api and an in-memory token store: the login form's
// sign-in and every way it can fail, background refresh (never cut short, signs out only on
// 400/401), single-flight refresh, and sign-out.
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/http_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/auth/auth_controller.dart';
import 'package:mastersat_app/core/auth/session.dart';
import 'package:mastersat_app/core/auth/token_store.dart';
import 'package:mastersat_app/core/clock/clock.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/store/unsent_work.dart';

import '../harness/app_harness.dart' show fakeJwt;

class _Rig {
  _Rig({DateTime? start, AuthSession? session})
      : clock = ManualClock(start ?? DateTime.utc(2026, 10, 11, 9)),
        tokens = MemoryTokenStore(session: session) {
    api = FixtureV1Api(now: clock.now);
    auth = AuthController(api: api, store: tokens, unsentWork: unsent, clock: clock);
  }

  final ManualClock clock;
  final MemoryTokenStore tokens;
  final UnsentWork unsent = UnsentWork();
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
  });

  group('sign-in with login and password', () {
    test('signs in: the login is trimmed, the tokens stored, the refresh scheduled', () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.signIn('  aziza.karimova ', 's3cret pass');
      expect(r.auth.status, AuthStatus.signedIn);
      expect(r.auth.problem, isNull);
      final call = r.api.calls.singleWhere((c) => c.method == 'authLogin');
      expect(call.args, {'identifier': 'aziza.karimova'});
      expect(r.tokens.session!.access, r.auth.accessToken);
      expect(r.tokens.session!.refresh, 'eyJhbGciOiJIUzI1NiJ9.fixture-refresh.sig');
      expect(r.auth.nextRefreshAt, isNotNull);
      r.auth.dispose();
    });

    test('the password is never stored: not in the session, not in the token store', () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.signIn('aziza', 'very-secret-password');
      expect(r.tokens.session!.toJson().toString(), isNot(contains('very-secret-password')));
      expect(r.api.calls.map((c) => c.args.toString()).join(), isNot(contains('very-secret-password')));
      expect(const AuthLoginRequest(identifier: 'a', password: 'very-secret-password').toString(),
          isNot(contains('very-secret-password')));
      r.auth.dispose();
    });

    test('"signingIn" while the request is in flight; a second press sends nothing', () async {
      final r = _Rig();
      await r.auth.restore();
      r.api.latency = const Duration(milliseconds: 20);
      final first = r.auth.signIn('aziza', 'p');
      expect(r.auth.status, AuthStatus.signingIn);
      await r.auth.signIn('aziza', 'p');
      await first;
      expect(r.calls('authLogin'), 1);
      expect(r.auth.isSignedIn, isTrue);
      await r.auth.signIn('aziza', 'p');
      expect(r.calls('authLogin'), 1, reason: 'already signed in');
      r.auth.dispose();
    });

    test('a blank login or password sends nothing', () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.signIn('   ', 'p');
      await r.auth.signIn('aziza', '');
      expect(r.calls('authLogin'), 0);
      expect(r.auth.status, AuthStatus.signedOut);
    });

    test('a wrong login or password says so, and is not offered again as it is', () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.signIn('aziza', FixtureV1Api.wrongPassword);
      expect(r.auth.status, AuthStatus.signedOut);
      expect(r.auth.problem!.kind, AuthProblemKind.invalidCredentials);
      expect(r.auth.problem!.message, 'That login or password is not right.');
      expect(r.auth.problem!.canRetry, isFalse);
      expect(r.tokens.session, isNull);
    });

    test("an lc-up account without a password: the server's own words", () async {
      final r = _Rig();
      await r.auth.restore();
      await r.auth.signIn(FixtureV1Api.passwordNotSetLogin, '4567');
      expect(r.auth.problem!.kind, AuthProblemKind.passwordNotSet);
      expect(r.auth.problem!.message, 'Set your password on mastersat.uz first, then sign in here.');
      expect(r.auth.problem!.canRetry, isFalse);
    });

    test('every other outcome says what to do next', () async {
      Future<AuthProblem> failWith(ApiException e) async {
        final r = _Rig();
        await r.auth.restore();
        r.api.failNext(e);
        await r.auth.signIn('aziza', 'p');
        expect(r.auth.status, AuthStatus.signedOut);
        return r.auth.problem!;
      }

      final refused = await failWith(ApiError(status: 403, body: ApiErrorBody(detail: 'This app is for learning center students.')));
      expect(refused.kind, AuthProblemKind.refused);
      expect(refused.message, 'This app is for learning center students.');
      expect(refused.canRetry, isFalse);
      final bare = await failWith(ApiError(status: 403, body: ApiErrorBody()));
      expect(bare.kind, AuthProblemKind.refused);
      expect(bare.message, "This account can't sign in to the app. Ask your teacher for help.");
      final notSetBare = await failWith(ApiError(status: 403, body: ApiErrorBody(code: 'password_not_set')));
      expect(notSetBare.kind, AuthProblemKind.passwordNotSet);
      expect(notSetBare.message, 'Set your password on mastersat.uz first, then sign in here.');
      final slow = await failWith(
          ApiError(status: 429, body: ApiErrorBody(detail: 'throttled'), retryAfter: const Duration(seconds: 600)));
      expect(slow.kind, AuthProblemKind.tooManyAttempts);
      expect(slow.message, 'Too many tries. Wait a few minutes and try again.');
      expect(slow.canRetry, isFalse);
      final down = await failWith(ApiError(status: 503, body: ApiErrorBody(detail: 'x')));
      expect(down.kind, AuthProblemKind.server);
      expect(down.canRetry, isTrue);
      final odd = await failWith(ApiError(status: 400, body: ApiErrorBody(detail: 'x')));
      expect(odd.kind, AuthProblemKind.server);
      final offline = await failWith(const NetworkError('no route'));
      expect(offline.kind, AuthProblemKind.offline);
      expect(offline.message, 'No connection to MasterSAT. Check your internet, then press Try again.');
      expect(offline.canRetry, isTrue);
      final old = await failWith(const UpdateRequired(updateUrl: ''));
      expect(old.kind, AuthProblemKind.updateRequired);
    });

    test('offline, then the same login again signs in and clears the problem', () async {
      final r = _Rig();
      await r.auth.restore();
      r.api.offline = true;
      await r.auth.signIn('aziza', 'p');
      expect(r.auth.problem!.kind, AuthProblemKind.offline);
      r.api.offline = false;
      await r.auth.signIn('aziza', 'p');
      expect(r.auth.isSignedIn, isTrue);
      expect(r.auth.problem, isNull);
      final logins = r.api.calls.where((c) => c.method == 'authLogin').map((c) => c.args).toList();
      expect(logins, [
        {'identifier': 'aziza'},
        {'identifier': 'aziza'},
      ]);
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
