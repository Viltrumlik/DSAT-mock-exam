// HomeController without widgets: cache first, one conditional request, the 30 s poll only
// while a midterm can change on its own, the store keyed by the student, and sign-out.
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/auth/auth_controller.dart';
import 'package:mastersat_app/core/auth/session.dart';
import 'package:mastersat_app/core/auth/token_store.dart';
import 'package:mastersat_app/core/clock/clock.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/store/settings_store.dart';
import 'package:mastersat_app/core/store/unsent_work.dart';
import 'package:mastersat_app/core/store/user_store.dart';
import 'package:mastersat_app/features/home/home_controller.dart';
import 'package:mastersat_app/features/home/update_controller.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import '../../core/harness/app_harness.dart';

class _Rig {
  _Rig({int? sessionUser = 77}) {
    clock = ManualClock(fixtureNow);
    api = FixtureV1Api(now: clock.now);
    tokens = MemoryTokenStore(
      session: AuthSession(
        access: sessionUser == null ? 'opaque-token' : fakeJwt(expires: fixtureNow.add(const Duration(hours: 3)), userId: sessionUser),
        refresh: 'eyJhbGciOiJIUzI1NiJ9.fixture-refresh.sig',
        obtainedAt: fixtureNow,
        userId: sessionUser,
      ),
    );
    auth = AuthController(api: api, store: tokens, unsentWork: UnsentWork(), clock: clock);
    home = HomeController(
      api: api,
      auth: auth,
      clock: clock,
      openStore: (id) async {
        opened.add(id);
        return stores[id] ??= await UserStore.memory(id);
      },
    );
  }

  late final ManualClock clock;
  late final FixtureV1Api api;
  late final MemoryTokenStore tokens;
  late final AuthController auth;
  late final HomeController home;
  final List<int> opened = [];
  final Map<int, UserStore> stores = {};

  List<FixtureCall> get homeCalls => api.calls.where((c) => c.method == 'home').toList();
}

void main() {
  test('cache first, then one conditional request; a 304 keeps the copy and moves "updated"', () async {
    final r = _Rig();
    final store = await UserStore.memory(77);
    r.stores[77] = store;
    // Seed the cache with exactly what the server would send (so its ETag matches).
    final fresh = await r.api.home();
    await store.homeCache.write(fresh.home!, fresh.etag, fixtureNow.subtract(const Duration(hours: 1)));
    r.api.calls.clear();

    await r.auth.restore();
    await r.home.loadCached();
    expect(r.home.home, isNotNull, reason: 'drawn before any request');
    expect(r.homeCalls, isEmpty);

    r.clock.advance(const Duration(minutes: 5));
    await r.home.refresh();
    expect(r.homeCalls.single.args['if_none_match'], fresh.etag);
    expect(r.home.fetchedAt, fixtureNow.add(const Duration(minutes: 5)));
    expect((await store.homeCache.read())!.fetchedAt, fixtureNow.add(const Duration(minutes: 5)));
    r.home.dispose();
    r.auth.dispose();
  });

  test('a JWT without user_id: the first Home names the student and opens their store', () async {
    final r = _Rig(sessionUser: null);
    await r.auth.restore();
    await r.home.start();
    await pumpEventQueue();
    expect(r.opened, [77]);
    expect(r.auth.session!.userId, 77);
    expect((await r.stores[77]!.homeCache.read())!.home.student.id, 77);
    r.home.dispose();
    r.auth.dispose();
  });

  test('start() racing loadCached() opens the store once', () async {
    final r = _Rig();
    await r.auth.restore();
    await Future.wait([r.home.loadCached(), r.home.start(), r.home.loadCached()]);
    await pumpEventQueue();
    expect(r.opened, [77]);
    r.home.dispose();
    r.auth.dispose();
  });

  test('polls every 30 s only while Home is visible and a midterm can change on its own', () {
    fakeAsync((fa) {
      final r = _Rig();
      r.auth.restore();
      fa.flushMicrotasks();
      r.home.start();
      fa.flushMicrotasks();
      expect(r.homeCalls, hasLength(1));
      fa.elapse(const Duration(seconds: 31));
      expect(r.homeCalls, hasLength(1), reason: 'Home is not on screen');
      r.home.setVisible(true);
      fa.elapse(const Duration(seconds: 30));
      expect(r.homeCalls, hasLength(2));
      fa.elapse(const Duration(seconds: 30));
      expect(r.homeCalls, hasLength(3));
      r.home.setVisible(false);
      fa.elapse(const Duration(minutes: 5));
      expect(r.homeCalls, hasLength(3));
      r.home.dispose();
      r.auth.dispose();
    });
  });

  test('offline keeps what is shown and flags it; a 401 is not shown as a problem', () async {
    final r = _Rig();
    await r.auth.restore();
    await r.home.start();
    await pumpEventQueue();
    r.api.offline = true;
    await r.home.refresh();
    expect(r.home.offline, isTrue);
    expect(r.home.home, isNotNull);
    r.api.offline = false;
    r.api.failNext(ApiError(status: 401, body: ApiErrorBody(detail: 'x')));
    await r.home.refresh();
    expect(r.home.problem, isNull);
    r.home.dispose();
    r.auth.dispose();
  });

  test('sign-out forgets everything and an answer still in flight is dropped', () async {
    final r = _Rig();
    await r.auth.restore();
    r.api.latency = const Duration(milliseconds: 30);
    final inFlight = r.home.refresh();
    await r.home.reset();
    await inFlight;
    expect(r.home.home, isNull);
    expect(r.home.store, isNull);
    r.home.dispose();
    r.auth.dispose();
  });

  group('UpdateController', () {
    UpdateController make(FakeNativeBridge native, {UpdateChannel channel = UpdateChannel.stable}) => UpdateController(
          native: native,
          config: ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0'),
          channel: () => channel,
        );

    test('up to date', () async {
      final native = FakeNativeBridge();
      final u = make(native);
      await u.checkAndDownload();
      expect(u.phase, UpdatePhase.upToDate);
      expect(native.calls, ['updateCheck stable']);
      u.dispose();
    });

    test('a new version downloads with real progress, then Restart applies it', () async {
      final native = FakeNativeBridge()..update = const UpdateInfo(available: true, version: '0.3.0');
      final u = make(native, channel: UpdateChannel.beta);
      final percents = <int>[];
      u.addListener(() => percents.add(u.percent));
      await u.checkAndDownload();
      expect(u.phase, UpdatePhase.ready);
      expect(u.version, '0.3.0');
      expect(percents, containsAllInOrder([0, 25, 50, 75, 100]));
      expect(native.calls.first, 'updateCheck beta');
      u.restartToUpdate();
      expect(native.applied, isTrue);
      u.dispose();
    });

    test('a build without an updater (the MacBook app) is not a failure, and is not asked again', () async {
      final native = _NoUpdater();
      final u = make(native);
      u.startPeriodic();
      await u.checkAndDownload();
      expect(u.phase, UpdatePhase.idle);
      expect(u.error, isNull);
      await u.checkAndDownload();
      expect(native.checks, 1, reason: 'no updater: one look, then never again');
      u.dispose();
    });

    test('a failure is shown and can be retried; checks never overlap', () async {
      final native = _FailingUpdates();
      final u = UpdateController(
        native: native,
        config: ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0'),
        channel: () => UpdateChannel.stable,
      );
      await Future.wait([u.checkAndDownload(), u.checkAndDownload()]);
      expect(native.checks, 1);
      expect(u.phase, UpdatePhase.failed);
      expect(u.error, 'feed unreachable');
      u.dispose();
    });

    test('checks at once and then every 6 h while Home shows', () {
      fakeAsync((fa) {
        final native = FakeNativeBridge();
        final u = make(native);
        u.startPeriodic();
        fa.flushMicrotasks();
        fa.elapse(const Duration(hours: 12, minutes: 1));
        expect(native.calls.where((c) => c.startsWith('updateCheck')), hasLength(3));
        u.stopPeriodic();
        fa.elapse(const Duration(hours: 12));
        expect(native.calls.where((c) => c.startsWith('updateCheck')), hasLength(3));
        u.dispose();
      });
    });
  });
}

class _FailingUpdates extends FakeNativeBridge {
  int checks = 0;

  @override
  Future<UpdateInfo> updateCheck({required String feedUrl, required String channel}) async {
    checks++;
    await Future<void>.delayed(const Duration(milliseconds: 5));
    throw const NativeBridgeException(NativeStatus.errOs, 'ms_update_check', 'feed unreachable');
  }
}

class _NoUpdater extends FakeNativeBridge {
  int checks = 0;

  @override
  Future<UpdateInfo> updateCheck({required String feedUrl, required String channel}) async {
    checks++;
    throw const NativeBridgeException(NativeStatus.errUnsupported, 'ms_update_check', 'updates are Windows-only');
  }
}
