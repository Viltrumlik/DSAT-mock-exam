// The WHOLE app for end-to-end widget tests: the real services (buildAppServices), the real
// exam launcher, real ExamRuntimes on a real file database (synchronous SQLite, so it runs in
// the widget tester's fake time), over FixtureV1Api + FakeNativeBridge + FakeIslandHost.
// Only the outside world is fake: the server, the native library, WebView2.
import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/auth/session.dart';
import 'package:mastersat_app/core/auth/token_store.dart';
import 'package:mastersat_app/core/clock/clock.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/store/app_paths.dart';
import 'package:mastersat_app/core/store/user_store.dart';
import 'package:mastersat_app/exam/engine/engine_clock.dart';
import 'package:mastersat_app/exam/engine/engine_deps.dart';
import 'package:mastersat_app/exam/engine/exam_runtime.dart';
import 'package:mastersat_app/exam/engine/power_events.dart';
import 'package:mastersat_app/exam/launch/exam_launcher.dart';
import 'package:mastersat_app/exam/launch/island_guard.dart';
import 'package:mastersat_app/island/fake_island_host.dart';
import 'package:mastersat_app/island/island_host.dart';
import 'package:mastersat_app/main.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';
import 'package:mastersat_app/native/native_bridge.dart';

/// The fixtures' "now" (contracts/v1/manifest.json).
final DateTime rigBase = DateTime.utc(2026, 10, 11, 9);

/// Engine time = the widget tester's fake clock.
class TesterEngineClock implements EngineClock {
  TesterEngineClock(this._now) : _start = _now();

  final DateTime Function() _now;
  final DateTime _start;

  @override
  Duration get monotonic => _now().difference(_start);

  @override
  DateTime get wallNow => rigBase.add(monotonic);
}

String _jwt(DateTime expires, {int userId = 77}) {
  String b64(Object o) => base64Url.encode(utf8.encode(jsonEncode(o))).replaceAll('=', '');
  return '${b64({'alg': 'HS256', 'typ': 'JWT'})}.'
      '${b64({'token_type': 'access', 'exp': expires.millisecondsSinceEpoch ~/ 1000, 'user_id': userId, 'jti': '1'})}.sig';
}

/// A native bridge that also records keep-awake and battery reads.
class RigNativeBridge extends FakeNativeBridge {
  final List<bool> keepAwakeCalls = [];
  int batteryReads = 0;

  @override
  void keepAwake(bool on) {
    keepAwakeCalls.add(on);
    super.keepAwake(on);
  }

  @override
  BatteryStatus? battery() {
    batteryReads++;
    return super.battery();
  }
}

/// A content island whose WebView2 cannot start (open() throws, like a missing runtime).
class FailingIslandHost extends FakeIslandHost {
  FailingIslandHost(super.kind);

  @override
  Future<void> open() async {
    opens++;
    throw StateError('WebView2 runtime not found');
  }
}

class AppRig {
  AppRig._(this.tester, this.dir, this.clock, this.api, this.native, this.tokens, this.services, this.hosts, this.openedUrls);

  final WidgetTester tester;
  final Directory dir;
  final TesterEngineClock clock;
  final FixtureV1Api api;
  final RigNativeBridge native;
  final MemoryTokenStore tokens;
  final AppServices services;

  /// Every island host the app created, in order.
  final List<FakeIslandHost> hosts;

  /// Links the app opened in the browser.
  final List<Uri> openedUrls;

  static Future<AppRig> start(
    WidgetTester tester, {
    EngineTimings timings = const EngineTimings(),
    Duration accessLeft = const Duration(hours: 3),
    bool islandOpenFails = false,
  }) async {
    driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
    final dir = Directory.systemTemp.createTempSync('wire-e2e-');
    final clock = TesterEngineClock(() => tester.binding.clock.now());
    final api = FixtureV1Api(now: () => clock.wallNow);
    final native = RigNativeBridge();
    final tokens = MemoryTokenStore(
      session: AuthSession(
        access: _jwt(rigBase.add(accessLeft)),
        refresh: 'eyJhbGciOiJIUzI1NiJ9.fixture-refresh.sig',
        obtainedAt: rigBase,
        userId: 77,
        displayName: 'Aziza Karimova',
      ),
    );
    final hosts = <FakeIslandHost>[];
    final opened = <Uri>[];
    final services = await buildAppServices(
      config: ApiConfig(origin: Uri.parse('http://fixtures.invalid'), appVersion: appVersion, target: ApiTarget.inProcessFixtures),
      paths: AppPaths(dir.path),
      native: native,
      clock: FunctionClock(() => clock.wallNow),
      api: api,
      tokenStore: tokens,
      openStore: UserStore.memory,
      openUrl: (url) async {
        opened.add(url);
        return true;
      },
      copyToClipboard: (_) async {},
      examLauncher: ExamLauncherWiring(
        islandFactory: (kind) {
          final h = islandOpenFails ? FailingIslandHost(kind) : FakeIslandHost(kind);
          hosts.add(h);
          return h;
        },
        windowControls: () => null,
        animate: false,
      ).call,
      examRuntimes: (userId, {required api, required native, required fetchMedia}) => ExamRuntime.open(
        dataDir: dir,
        userId: userId,
        api: api,
        native: native,
        fetchMedia: fetchMedia,
        clock: clock,
        power: PowerEvents.detached(),
        timings: timings,
        background: false,
      ),
      islandDiagnostics: IslandDiagnostics(runtimeVersion: () async => null),
    );
    return AppRig._(tester, dir, clock, api, native, tokens, services, hosts, opened);
  }

  /// The content island the current sitting runs on.
  FakeIslandHost get content => hosts.lastWhere((h) => h.kind == IslandKind.content);

  Future<void> pump({Size size = const Size(1366, 768)}) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await services.auth.restore();
    if (services.auth.isSignedIn) await services.home.loadCached();
    await tester.pumpWidget(MasterSatApp(services: services));
    await settle();
  }

  /// Let replies land and the screens catch up (no pumpAndSettle: spinners never settle).
  Future<void> settle([Duration step = const Duration(milliseconds: 50), int frames = 8]) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(step);
    }
  }

  Future<void> tapText(String text, {bool last = false}) async {
    final f = last ? find.text(text).last : find.text(text).first;
    await tester.ensureVisible(f);
    await tester.pump();
    await tester.tap(f);
    await settle();
  }

  Future<void> tapKey(String key) async {
    final f = find.byKey(ValueKey(key));
    await tester.ensureVisible(f);
    await tester.pump();
    await tester.tap(f);
    await settle();
  }

  /// Unmount, stop every timer and close every database (call at the end of each test).
  Future<void> dispose() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    final exams = services.exams;
    await tester.runAsync(() async {
      await exams?.close();
    });
    services.dispose();
    await tester.pump(const Duration(seconds: 1));
    try {
      dir.deleteSync(recursive: true);
    } on FileSystemException {
      // best effort
    }
  }
}
