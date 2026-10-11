// The app's sign-in state (architecture §6 "Sign-in", §4.2 "Tokens").
//
//   starting           reading auth.bin
//   signedOut          the sign-in screen (with [AuthController.problem] when something failed)
//   waitingForBrowser  "Sign in with your browser" is open; waiting for mastersat://auth?code=
//   exchanging         POST /api/desktop/auth/exchange/ {code, verifier} in flight
//   signedIn           Home
//
// Sign-in is PKCE through the student's real browser (Google and Telegram refuse embedded
// web views): NativeBridge.pkceNew → open https://mastersat.uz/desktop/link?challenge=<S256>
// → the website mints a one-time code and navigates to mastersat://auth?code=… → exchange it
// with the verifier, which never left this computer. Tokens come back in the body (#244).
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
import 'package:url_launcher/url_launcher.dart';

import '../../native/native_bridge.dart';
import '../api/http_v1_api.dart';
import '../api/v1_api.dart';
import '../clock/clock.dart';
import '../http/api_config.dart';
import '../models/models.dart';
import '../store/unsent_work.dart';
import 'launch_links.dart';
import 'session.dart';
import 'token_store.dart';

enum AuthStatus { starting, signedOut, waitingForBrowser, exchanging, signedIn }

enum AuthProblemKind {
  /// The browser could not be opened.
  browserFailed,

  /// The exchange did not reach the server. Retry re-sends it.
  offline,

  /// The server refused the code (expired, used, or not this app's): start again.
  linkExpired,

  /// A link arrived but no sign-in was started in this app.
  notStartedHere,

  /// The server refused the student (account rules); the server's own words are shown.
  refused,

  /// The server failed or asked us to slow down. Retry re-sends the exchange.
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

  /// Whether "Try again" re-sends the same exchange request.
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

typedef UrlOpener = Future<bool> Function(Uri url);

/// Mints a sign-in code for a challenge without a browser (local fixture server, debug only).
typedef DevCodeMinter = Future<String> Function(String challenge);

Future<bool> _openInBrowser(Uri url) => launchUrl(url, mode: LaunchMode.externalApplication);

class AuthController extends ChangeNotifier implements AccessTokenSource {
  AuthController({
    required this._api,
    required this._native,
    required this._store,
    required this._config,
    required UnsentWork unsentWork,
    this._clock = const SystemClock(),
    UrlOpener? openUrl,
    this.devMintCode,
    this.refreshLead = const Duration(minutes: 30),
  })  : _unsent = unsentWork,
        _openUrl = openUrl ?? _openInBrowser;

  final V1Api _api;
  final NativeBridge _native;
  final TokenStore _store;
  final ApiConfig _config;
  final UnsentWork _unsent;
  final Clock _clock;
  final UrlOpener _openUrl;

  /// Debug-only shortcut for the local fixture server (see main.dart).
  final DevCodeMinter? devMintCode;

  /// Refresh in the background when less than this much of the access token remains.
  final Duration refreshLead;

  AuthStatus _status = AuthStatus.starting;
  AuthSession? _session;
  AuthProblem? _problem;
  PendingSignIn? _pending;
  AuthExchangeRequest? _lastExchange;
  Future<RecoverOutcome>? _refreshing;
  Timer? _refreshTimer;
  Duration _refreshBackoff = const Duration(seconds: 30);
  StreamSubscription<String>? _linkSub;
  bool _disposed = false;

  AuthStatus get status => _status;
  AuthSession? get session => _session;
  AuthProblem? get problem => _problem;
  bool get isSignedIn => _status == AuthStatus.signedIn && _session != null;

  /// The PKCE pending sign-in (tests and diagnostics; the verifier is never shown).
  PendingSignIn? get pendingSignIn => _pending;

  @override
  String? get accessToken => _session?.access;

  // ------------------------------------------------------------------------------------------
  // Start-up
  // ------------------------------------------------------------------------------------------

  /// Reads auth.bin. Offline at launch with tokens in hand counts as signed in: Home draws
  /// from the cache with an offline banner, which beats a sign-in screen that cannot work.
  Future<void> restore() async {
    final s = await _store.read();
    _pending = await _store.readPending();
    if (_pending != null && _pending!.isExpired(_clock.now())) {
      _pending = null;
      await _store.clearPending();
    }
    if (s != null) {
      _session = s;
      _set(AuthStatus.signedIn);
      _scheduleRefresh();
    } else {
      _set(AuthStatus.signedOut);
    }
  }

  /// Listens to `mastersat://` links, and handles the ones that arrived before (the link the
  /// app was launched with first). A sign-in link also brings the window to the front.
  Future<void> attachLinks(LaunchLinks links) async {
    await _linkSub?.cancel();
    Future<void> onLink(String raw) async {
      if (signInCodeFrom(raw) == null) return;
      unawaited(links.focusWindow());
      await handleLink(raw);
    }

    _linkSub = links.links.listen((raw) => unawaited(onLink(raw)));
    for (final raw in await links.takePending()) {
      await onLink(raw);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Sign-in
  // ------------------------------------------------------------------------------------------

  /// "Sign in with your browser".
  Future<void> signIn() async {
    if (_status == AuthStatus.exchanging) return;
    final pair = _native.pkceNew();
    final pending = PendingSignIn(verifier: pair.verifier, challenge: pair.challenge, startedAt: _clock.now());
    _pending = pending;
    _lastExchange = null;
    _problem = null;
    _set(AuthStatus.waitingForBrowser);
    await _store.writePending(pending);

    final mint = devMintCode;
    if (mint != null) {
      try {
        await handleLink('mastersat://auth?code=${Uri.encodeQueryComponent(await mint(pair.challenge))}');
      } catch (e) {
        _fail(const AuthProblem(AuthProblemKind.browserFailed, "Couldn't reach the local sign-in server."));
      }
      return;
    }

    bool opened;
    try {
      opened = await _openUrl(_config.signInLink(pair.challenge));
    } catch (_) {
      opened = false;
    }
    if (!opened && _status == AuthStatus.waitingForBrowser) {
      _fail(const AuthProblem(AuthProblemKind.browserFailed, "Couldn't open your browser. Please try again."));
    }
  }

  /// Back from "Waiting for your browser…" to the sign-in screen. The pending verifier is
  /// kept, so a link that still arrives completes the sign-in.
  void cancelSignIn() {
    if (_status != AuthStatus.waitingForBrowser) return;
    _set(AuthStatus.signedOut);
  }

  /// A `mastersat://…` link. Only `mastersat://auth?code=` does anything.
  Future<void> handleLink(String raw) async {
    final code = signInCodeFrom(raw);
    if (code == null) return;
    if (_status == AuthStatus.exchanging) return; // the same link delivered twice
    if (_status == AuthStatus.signedIn) return; // already in; a stale link changes nothing
    final pending = _pending ?? await _store.readPending();
    if (pending == null || pending.isExpired(_clock.now())) {
      _fail(const AuthProblem(
        AuthProblemKind.notStartedHere,
        "This sign-in didn't start in the app. Press “Sign in with your browser” to try again.",
      ));
      return;
    }
    _lastExchange = AuthExchangeRequest(code: code, verifier: pending.verifier);
    await _exchange();
  }

  /// "Try again" after a failed exchange: re-sends the SAME request (no new browser trip).
  Future<void> retry() async {
    if (_lastExchange == null || !(_problem?.canRetry ?? false)) return;
    await _exchange();
  }

  Future<void> _exchange() async {
    final request = _lastExchange;
    if (request == null) return;
    _problem = null;
    _set(AuthStatus.exchanging);
    try {
      final tokens = await _api.authExchange(request);
      final now = _clock.now();
      final session = AuthSession(
        access: tokens.access,
        refresh: tokens.refresh,
        obtainedAt: now,
        userId: Jwt.userId(tokens.access),
      );
      await _store.write(session);
      await _store.clearPending();
      _pending = null;
      _lastExchange = null;
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
      if (e.status == 400 || e.status == 401 || e.status == 404) {
        _lastExchange = null;
        _fail(const AuthProblem(
          AuthProblemKind.linkExpired,
          'That sign-in link has expired. Press “Sign in with your browser” to get a new one.',
        ));
      } else if (e.status == 403) {
        _lastExchange = null;
        _fail(AuthProblem(
          AuthProblemKind.refused,
          (e.body.detail?.trim().isNotEmpty ?? false)
              ? e.body.detail!.trim()
              : "This account can't sign in to the app. Ask your teacher for help.",
        ));
      } else if (e.status == 429) {
        _fail(const AuthProblem(
          AuthProblemKind.server,
          'Too many sign-in attempts. Wait a minute, then press Try again.',
          canRetry: true,
        ));
      } else {
        _fail(const AuthProblem(
          AuthProblemKind.server,
          "MasterSAT couldn't finish signing you in. Press Try again in a moment.",
          canRetry: true,
        ));
      }
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
    _lastExchange = null;
    await _store.clear();
    _problem = problem;
    _set(AuthStatus.signedOut);
  }

  void _set(AuthStatus s) {
    _status = s;
    _notify();
  }

  /// A refresh or an exchange can land after the app has torn this down: say nothing then.
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _refreshTimer?.cancel();
    _linkSub?.cancel();
    super.dispose();
  }
}
