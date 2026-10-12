// One place that builds the whole app for widget tests: the real services (buildAppServices)
// over the in-memory FixtureV1Api, FakeNativeBridge, a MemoryTokenStore and in-memory
// per-user databases, with every outside effect recorded — exams launched, URLs opened,
// clipboard writes, files saved.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/auth/session.dart';
import 'package:mastersat_app/core/auth/token_store.dart';
import 'package:mastersat_app/core/clock/clock.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/store/app_paths.dart';
import 'package:mastersat_app/core/store/user_store.dart';
import 'package:mastersat_app/features/home/home_controller.dart';
import 'package:mastersat_app/features/results/results_controller.dart';
import 'package:mastersat_app/main.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';

/// The app version every harness screen shows. Fixed, so bumping desktop-native/VERSION never
/// changes a golden or a version assertion (test/core/http/proxy_config_test.dart checks the
/// real default against VERSION).
const String kHarnessAppVersion = '0.2.0';

/// The fixtures' "now" (contracts/v1/manifest.json): midterm 14 is open, 15 opens tomorrow.
final DateTime fixtureNow = DateTime.utc(2026, 10, 11, 9);

/// The default window size for screen tests and goldens.
const Size desktopWindow = Size(1280, 820);

/// A JWT-shaped token the client can read `exp` / `user_id` from.
String fakeJwt({required DateTime expires, int userId = 77, String type = 'access', String jti = '1'}) {
  String b64(Object o) => base64Url.encode(utf8.encode(jsonEncode(o))).replaceAll('=', '');
  return '${b64({'alg': 'HS256', 'typ': 'JWT'})}.'
      '${b64({'token_type': type, 'exp': expires.millisecondsSinceEpoch ~/ 1000, 'user_id': userId, 'jti': jti})}.sig';
}

HomeResponse fixtureHome() => HomeResponse.fromJson(JsonReader.of(FixtureV1Api.fixture('home.response.json')));

class AppHarness {
  AppHarness._({
    required this.api,
    required this.native,
    required this.tokens,
    required this.clock,
    required this.services,
  });

  final FixtureV1Api api;
  final FakeNativeBridge native;
  final MemoryTokenStore tokens;
  final ManualClock clock;
  final AppServices services;

  /// Everything the app asked the outside world to do.
  final List<ExamRequest> launched = [];
  final List<Uri> openedUrls = [];
  final List<String> clipboard = [];
  final List<String> savePrompts = [];
  final Map<String, Uint8List> savedFiles = {};

  /// What the Save dialog answers (null = the student cancels).
  String? savePath = '/Users/student/Documents/report.pdf';

  /// What the exam launcher returns.
  ExamOutcome? Function(ExamRequest r) outcome = (_) => null;

  /// A signed-in student (session expiring in 3 h) or a signed-out app.
  static Future<AppHarness> start({
    bool signedIn = true,
    DateTime? now,
    ApiConfig? config,
    FixtureV1Api? api,
    StoreOpener? openStore,
  }) async {
    final clock = ManualClock(now ?? fixtureNow);
    final fixture = api ?? FixtureV1Api(now: clock.now);
    final native = FakeNativeBridge();
    final tokens = MemoryTokenStore(
      session: signedIn
          ? AuthSession(
              access: fakeJwt(expires: clock.now().add(const Duration(hours: 3))),
              refresh: 'eyJhbGciOiJIUzI1NiJ9.fixture-refresh.sig',
              obtainedAt: clock.now(),
              userId: 77,
              displayName: 'Aziza Karimova',
            )
          : null,
    );
    late AppHarness h;
    final services = await buildAppServices(
      config: config ??
          ApiConfig(origin: Uri.parse('http://fixtures.invalid'), appVersion: kHarnessAppVersion, target: ApiTarget.inProcessFixtures),
      paths: const AppPaths('/nonexistent-test-root'),
      native: native,
      clock: clock,
      api: fixture,
      tokenStore: tokens,
      openStore: openStore ?? UserStore.memory,
      documents: DocumentSaver(
        pick: (name) async {
          h.savePrompts.add(name);
          return h.savePath;
        },
        write: (path, bytes) async => h.savedFiles[path] = bytes,
      ),
      openUrl: (url) async {
        h.openedUrls.add(url);
        return true;
      },
      copyToClipboard: (text) async => h.clipboard.add(text),
      examLauncher: (context, request) async {
        h.launched.add(request);
        return h.outcome(request);
      },
    );
    h = AppHarness._(api: fixture, native: native, tokens: tokens, clock: clock, services: services);
    return h;
  }

  Widget app() => MasterSatApp(services: services);

  /// Restores the session (as main() does), reads the cache, and pumps the app at
  /// [size] (default 1280×820, device pixel ratio 1).
  Future<void> pump(WidgetTester tester, {Size size = desktopWindow, bool settle = true}) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await services.auth.restore();
    if (services.auth.isSignedIn) await services.home.loadCached();
    await tester.pumpWidget(app());
    if (settle) await settleApp(tester);
  }

  /// Unmounts the app and stops every timer the services hold (call at the end of a test).
  Future<void> dispose(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    services.dispose();
    await tester.pump();
  }
}

/// Pumps until nothing is scheduled, a few frames at most — spinners animate forever, so
/// pumpAndSettle cannot be used on loading states.
Future<void> settleApp(WidgetTester tester, {int frames = 12}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
    if (!tester.binding.hasScheduledFrame) break;
  }
}
