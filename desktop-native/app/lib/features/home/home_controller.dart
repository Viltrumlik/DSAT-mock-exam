// Home's data: the cached `home` payload drawn on the first frame, then ONE `GET home` with
// `If-None-Match` (304 → the cache stands). Polls every 30 s only while a midterm could change
// on its own, and refreshes when the window comes back to the front and after a test.
//
// The per-user database opens here: from auth.bin's user id at launch, or from the first
// `home` after a fresh sign-in (`student.id`).
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/api/v1_api.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/clock/clock.dart';
import '../../core/diagnostics/diagnostics.dart';
import '../../core/models/models.dart';
import '../../core/store/user_store.dart';
import 'midterm_model.dart';

typedef StoreOpener = Future<UserStore> Function(int userId);

/// Why the last refresh did not produce fresh data.
enum HomeProblem {
  /// No connection: the cached copy is shown with an "updated hh:mm" banner.
  offline,

  /// The server answered with an error (5xx, 403, …).
  server,
}

class HomeController extends ChangeNotifier {
  HomeController({
    required V1Api api,
    required AuthController auth,
    required StoreOpener openStore,
    Clock clock = const SystemClock(),
    ServerClock? serverClock,
    EventLog? log,
    this.pollInterval = const Duration(seconds: 30),
  })  : _api = api,
        _auth = auth,
        _openStore = openStore,
        _clock = clock,
        _serverClock = serverClock,
        _log = log;

  final V1Api _api;
  final AuthController _auth;
  final StoreOpener _openStore;
  final Clock _clock;
  final ServerClock? _serverClock;
  final EventLog? _log;
  final Duration pollInterval;

  UserStore? _store;
  HomeResponse? _home;
  String? _etag;
  DateTime? _fetchedAt;
  bool _loading = false;
  bool _refreshing = false;
  HomeProblem? _problem;
  String? _problemDetail;
  Future<void>? _inFlight;
  Timer? _pollTimer;
  bool _polling = false;
  bool _disposed = false;
  int _generation = 0;

  UserStore? get store => _store;
  HomeResponse? get home => _home;
  String? get etag => _etag;

  /// When the shown payload was last fetched or confirmed (local clock).
  DateTime? get fetchedAt => _fetchedAt;

  /// True while the very first load has nothing to show yet.
  bool get loading => _loading && _home == null;

  /// True while a refresh is in flight.
  bool get refreshing => _refreshing;
  HomeProblem? get problem => _problem;
  String? get problemDetail => _problemDetail;
  bool get offline => _problem == HomeProblem.offline;

  /// Called (with the store) whenever the per-user store opens — library filters load from it.
  void Function(UserStore store)? onStoreOpened;

  /// Told when `home` answers 426 (the app-wide update card takes over).
  void Function(UpdateRequired error)? onUpdateRequired;

  /// Draws from the cache (before the first frame when the user is known), then refreshes.
  Future<void> start() async {
    final userId = _auth.session?.userId;
    if (userId != null) await _ensureStore(userId);
    unawaited(refresh());
  }

  /// Reads the cache only (main() calls this before runApp, so the first frame has Home).
  Future<void> loadCached() async {
    final userId = _auth.session?.userId;
    if (userId == null) return;
    await _ensureStore(userId);
  }

  Future<void> _ensureStore(int userId) async {
    if (_store?.userId == userId) return;
    final previous = _store;
    _store = null;
    await previous?.close();
    final gen = _generation;
    final store = await _openStore(userId);
    if (gen != _generation || _disposed) {
      await store.close();
      return;
    }
    _store = store;
    onStoreOpened?.call(store);
    if (_home == null) {
      final cached = await store.homeCache.read();
      if (cached != null && gen == _generation) {
        _home = cached.home;
        _etag = cached.etag;
        _fetchedAt = cached.fetchedAt;
      }
    }
    _notify();
  }

  /// One `GET home` (joins one already in flight).
  Future<void> refresh() => _inFlight ??= _refresh().whenComplete(() => _inFlight = null);

  Future<void> _refresh() async {
    if (!_auth.isSignedIn) return;
    final gen = _generation;
    _refreshing = true;
    _loading = _home == null;
    _notify();
    try {
      final fetch = await _api.home(ifNoneMatch: _home == null ? null : _etag);
      if (gen != _generation) return;
      final now = _clock.now();
      if (fetch.notModified) {
        _fetchedAt = now;
        if (fetch.etag != null) _etag = fetch.etag;
        await _store?.homeCache.touch(now, etag: fetch.etag);
      } else {
        final home = fetch.home!;
        _serverClock?.observe(home.serverNow, receivedAt: now);
        await _auth.rememberStudent(home.student);
        await _ensureStore(home.student.id);
        if (gen != _generation) return;
        _home = home;
        _etag = fetch.etag;
        _fetchedAt = now;
        await _store?.homeCache.write(home, fetch.etag, now);
      }
      _problem = null;
      _problemDetail = null;
    } on NetworkError catch (e) {
      if (gen != _generation) return;
      _problem = HomeProblem.offline;
      _problemDetail = e.message;
      _log?.add('home', 'offline: ${e.message}');
    } on UpdateRequired catch (e) {
      onUpdateRequired?.call(e);
      _problem = HomeProblem.server;
      _problemDetail = 'Update the MasterSAT app to continue.';
    } on ApiError catch (e) {
      if (gen != _generation) return;
      _problem = e.isUnauthorized ? null : HomeProblem.server;
      _problemDetail = e.body.detail;
      _log?.add('home', 'HTTP ${e.status} ${e.code ?? ''}');
    } finally {
      if (gen == _generation) {
        _refreshing = false;
        _loading = false;
        _reschedulePoll();
        _notify();
      }
    }
  }

  // ---- polling --------------------------------------------------------------------------------

  /// Home is on screen: poll while a midterm could change on its own.
  void setVisible(bool visible) {
    _polling = visible;
    _reschedulePoll();
  }

  bool get isPolling => _pollTimer != null;

  void _reschedulePoll() {
    _pollTimer?.cancel();
    _pollTimer = null;
    final home = _home;
    if (!_polling || _disposed || home == null || !midtermsNeedPolling(home.midterms)) return;
    _pollTimer = Timer(pollInterval, () {
      _pollTimer = null;
      unawaited(refresh());
    });
  }

  // ---- sign-out ------------------------------------------------------------------------------

  /// Forgets everything in memory and closes the student's database.
  Future<void> reset() async {
    _generation++;
    _pollTimer?.cancel();
    _pollTimer = null;
    _home = null;
    _etag = null;
    _fetchedAt = null;
    _problem = null;
    _problemDetail = null;
    _refreshing = false;
    _loading = false;
    final store = _store;
    _store = null;
    await store?.close();
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _pollTimer?.cancel();
    super.dispose();
  }
}
