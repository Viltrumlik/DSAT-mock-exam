// The app's sign-in state (architecture §6 "Sign-in", §4.2 "Tokens").
//
//   starting    reading auth.bin
//   signedOut   the sign-in form (with [AuthController.problem] when something failed)
//   signingIn   POST /api/desktop/auth/login/ {identifier, password} in flight
//   signedIn    Home
//
// Sign-in is the app's own login form: the same login and password the website takes (email,
// username or phone), exchanged once for the token pair, which comes back in the body. The
// password is never stored, logged or kept: it lives in the request for the one call and the
// controller holds no reference to it afterwards (the form clears its field on a refusal).
//
// Refresh rules, carried over from 0.1.0's review rounds:
//  * one refresh at a time — two refreshes race, and the loser presents a retired token;
//  * a refresh is never cut short (the server rotates inside it; HttpV1Api gives it 120 s);
//  * in the background when less than 30 minutes of the access token remain;
//  * the session ends ONLY on a definite 400/401 from the refresh endpoint — a dropped
//    connection or a 5xx keeps the tokens (signing out on a blip would unmount a midterm).
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../api/http_v1_api.dart';
import '../api/v1_api.dart';
import '../clock/clock.dart';
import '../models/models.dart';
import '../store/unsent_work.dart';
import 'session.dart';
import 'token_store.dart';

enum AuthStatus { starting, signedOut, signingIn, signedIn }

enum AuthProblemKind {
  /// 401: the login or the password is wrong (or the account does not exist, or is closed —
  /// the server answers all of these alike).
  invalidCredentials,

  /// 403 `password_not_set`: an lc-up account still on its first phone + four digits sign-in.
  /// The server's own words say where to set the password.
  passwordNotSet,

  /// Any other 403 (account rules); the server's own words are shown.
  refused,

  /// 429: too many tries for this account or from this network.
  tooManyAttempts,

  /// The sign-in did not reach the server. The form can send it again as it is.
  offline,

  /// The server failed. The form can send it again as it is.
  server,

  /// A refresh was definitely refused: the session is over.
  sessionEnded,

  /// This build is too old (426); the update card takes over.
  updateRequired,
}

@immutable
class AuthProblem {
  const AuthProblem(this.kind, this.message, {this.canRetry = false});

  final AuthProblemKind kind;
  final String message;

  /// Whether the sign-in can be sent again as typed ("Try again"): it never reached the
  /// server, or the server failed. A refusal is final until something is retyped.
  final bool canRetry;

  @override
  String toString() => 'AuthProblem($kind, $message)';
}

/// Outcome of [AuthController.signOut].
sealed class SignOutResult {
  const SignOutResult();
}

final class SignedOut extends SignOutResult {
  const SignedOut();
}

/// Work saved on this computer has not reached the server; signing out would strand it.
final class SignOutBlocked extends SignOutResult {
  const SignOutBlocked(this.unsent);
  final UnsentSummary unsent;
}

class AuthController extends ChangeNotifier implements AccessTokenSource {
  AuthController({
    required this._api,
    required this._store,
    required UnsentWork unsentWork,
    this._clock = const SystemClock(),
    this.refreshLead = const Duration(minutes: 30),
  }) : _unsent = unsentWork;

  final V1Api _api;
  final TokenStore _store;
  final UnsentWork _unsent;
  final Clock _clock;

  /// Refresh in the background when less than this much of the access token remains.
  final Duration refreshLead;

  AuthStatus _status = AuthStatus.starting;
  AuthSession? _session;
  AuthProblem? _problem;
  Future<RecoverOutcome>? _refreshing;
  Timer? _refreshTimer;
  Duration _refreshBackoff = const Duration(seconds: 30);
  bool _disposed = false;

  AuthStatus get status => _status;
  AuthSession? get session => _session;
  AuthProblem? get problem => _problem;
  bool get isSignedIn => _status == AuthStatus.signedIn && _session != null;

  @override
  String? get accessToken => _session?.access;

  // ------------------------------------------------------------------------------------------
  // Start-up
  // ------------------------------------------------------------------------------------------

  /// Reads auth.bin. Offline at launch with tokens in hand counts as signed in: Home draws
  /// from the cache with an offline banner, which beats a sign-in screen that cannot work.
  Future<void> restore() async {
    final s = await _store.read();
    if (s != null) {
      _session = s;
      _set(AuthStatus.signedIn);
      _scheduleRefresh();
    } else {
      _set(AuthStatus.signedOut);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Sign-in
  // ------------------------------------------------------------------------------------------

  /// The sign-in form: [identifier] is an email, username or phone. Does nothing while a
  /// sign-in is already in flight, when signed in, or with a blank field (the form's button is
  /// disabled then). The password is used for this one request and not kept anywhere.
  Future<void> signIn(String identifier, String password) async {
    if (_status == AuthStatus.signingIn || _status == AuthStatus.signedIn) return;
    final login = identifier.trim();
    if (login.isEmpty || password.isEmpty) return;
    _problem = null;
    _set(AuthStatus.signingIn);
    try {
      final tokens = await _api.authLogin(AuthLoginRequest(identifier: login, password: password));
      final now = _clock.now();
      final session = AuthSession(
        access: tokens.access,
        refresh: tokens.refresh,
        obtainedAt: now,
        userId: Jwt.userId(tokens.access),
      );
      await _store.write(session);
      _session = session;
      _refreshBackoff = const Duration(seconds: 30);
      _set(AuthStatus.signedIn);
      _scheduleRefresh();
    } on NetworkError {
      _fail(const AuthProblem(
        AuthProblemKind.offline,
        'No connection to MasterSAT. Check your internet, then press Try again.',
        canRetry: true,
      ));
    } on UpdateRequired {
      _fail(const AuthProblem(AuthProblemKind.updateRequired, 'Update the MasterSAT app to continue.'));
    } on ApiError catch (e) {
      _fail(_problemFor(e));
    } on Object catch (e) {
      // Anything else (the sign-in could not be saved on this computer, an answer that does not
      // parse): never leave the form spinning on "Signing in…".
      debugPrint('MasterSAT sign-in failed: $e');
      _fail(const AuthProblem(
        AuthProblemKind.server,
        "MasterSAT couldn't finish signing you in on this computer. Press Try again.",
        canRetry: true,
      ));
    }
  }

  static AuthProblem _problemFor(ApiError e) {
    final detail = e.body.detail?.trim() ?? '';
    switch (e.status) {
      case 401:
        return const AuthProblem(AuthProblemKind.invalidCredentials, 'That login or password is not right.');
      case 403 when e.code == 'password_not_set':
        return AuthProblem(
          AuthProblemKind.passwordNotSet,
          detail.isNotEmpty ? detail : 'Set your password on mastersat.uz first, then sign in here.',
        );
      case 403:
        return AuthProblem(
          AuthProblemKind.refused,
          detail.isNotEmpty ? detail : "This account can't sign in to the app. Ask your teacher for help.",
        );
      case 429:
        return const AuthProblem(AuthProblemKind.tooManyAttempts, 'Too many tries. Wait a few minutes and try again.');
      default:
        return const AuthProblem(
          AuthProblemKind.server,
          "MasterSAT couldn't finish signing you in. Press Try again in a moment.",
          canRetry: true,
        );
    }
  }

  void _fail(AuthProblem p) {
    _problem = p;
    _set(AuthStatus.signedOut);
  }

  // ------------------------------------------------------------------------------------------
  // Who is signed in
  // ------------------------------------------------------------------------------------------

  /// Records the student from `home` (keys the per-user database; JWTs from some servers do
  /// not carry a readable `user_id`).
  Future<void> rememberStudent(Student student) async {
    final s = _session;
    if (s == null) return;
    if (s.userId == student.id && s.displayName == student.fullName) return;
    final updated = s.copyWith(userId: student.id, displayName: student.fullName);
    _session = updated;
    await _store.write(updated);
    _notify();
  }

  // ------------------------------------------------------------------------------------------
  // Refresh
  // ------------------------------------------------------------------------------------------

  @override
  Future<RecoverOutcome> recoverFromUnauthorized(String? usedAccess) async {
    final s = _session;
    if (s == null) return RecoverOutcome.denied;
    if (usedAccess != null && s.access != usedAccess) return RecoverOutcome.retry;
    return refreshNow();
  }

  /// Refreshes now (joining a refresh already in flight).
  Future<RecoverOutcome> refreshNow() => _refreshing ??= _refresh().whenComplete(() => _refreshing = null);

  Future<RecoverOutcome> _refresh() async {
    final start = _session;
    if (start == null) return RecoverOutcome.denied;
    try {
      final tokens = await _api.authRefresh(RefreshRequest(refresh: start.refresh));
      if (!identical(_session, start)) {
        // Signed out (or replaced) while the refresh was in flight: do not resurrect it.
        return _session == null ? RecoverOutcome.denied : RecoverOutcome.retry;
      }
      final next = start.copyWith(access: tokens.access, refresh: tokens.refresh, obtainedAt: _clock.now());
      _session = next;
      await _store.write(next);
      _refreshBackoff = const Duration(seconds: 30);
      _scheduleRefresh();
      _notify();
      return RecoverOutcome.retry;
    } on ApiError catch (e) {
      if (e.status == 400 || e.status == 401) {
        if (identical(_session, start)) {
          await _endSession(const AuthProblem(AuthProblemKind.sessionEnded, 'Your session ended. Please sign in again.'));
        }
        return RecoverOutcome.denied;
      }
      return RecoverOutcome.unreachable;
    } on ApiException {
      return RecoverOutcome.unreachable;
    }
  }

  /// Makes sure at least [minLeft] of the access token remains (the midterm rules screen asks
  /// for 2.5 h so no refresh is needed under lockdown). Waits at most [wait] for the refresh —
  /// and never cancels it: a slow refresh still lands and stores the new pair.
  Future<void> ensureFreshFor(Duration minLeft, {Duration wait = const Duration(seconds: 15)}) async {
    final s = _session;
    if (s == null) return;
    if (s.accessExpiresAt.difference(_clock.now()) > minLeft) return;
    await Future.any<Object?>([refreshNow(), Future<void>.delayed(wait)]);
  }

  /// When the next background refresh is due (tests, diagnostics).
  DateTime? get nextRefreshAt {
    final s = _session;
    if (s == null) return null;
    return s.accessExpiresAt.subtract(refreshLead);
  }

  void _scheduleRefresh() {
    _refreshTimer?.cancel();
    final due = nextRefreshAt;
    if (due == null || _disposed) return;
    final wait = due.difference(_clock.now());
    _refreshTimer = Timer(wait.isNegative ? Duration.zero : wait, _backgroundRefresh);
  }

  Future<void> _backgroundRefresh() async {
    if (_session == null || _disposed) return;
    final outcome = await refreshNow();
    if (outcome == RecoverOutcome.unreachable && _session != null && !_disposed) {
      _refreshTimer?.cancel();
      _refreshTimer = Timer(_refreshBackoff, _backgroundRefresh);
      _refreshBackoff = Duration(seconds: math.min(_refreshBackoff.inSeconds * 2, 300));
    }
  }

  // ------------------------------------------------------------------------------------------
  // Sign-out
  // ------------------------------------------------------------------------------------------

  /// Signs out — unless work saved on this computer has not reached the server yet (design
  /// §1.12: after sign-out the tokens that could send it are gone). [force] is the explicit,
  /// destructive "Sign out anyway".
  Future<SignOutResult> signOut({bool force = false}) async {
    if (!force) {
      final unsent = await _unsent.check();
      if (!unsent.isEmpty) return SignOutBlocked(unsent);
    }
    await _endSession(null);
    return const SignedOut();
  }

  Future<void> _endSession(AuthProblem? problem) async {
    _refreshTimer?.cancel();
    _refreshTimer = null;
    _session = null;
    await _store.clear();
    _problem = problem;
    _set(AuthStatus.signedOut);
  }

  void _set(AuthStatus s) {
    _status = s;
    _notify();
  }

  /// A refresh or a sign-in can land after the app has torn this down: say nothing then.
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _refreshTimer?.cancel();
    super.dispose();
  }
}
