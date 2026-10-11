// Widget-test rig for the midterm feature: a host app, a real MidtermEngine on the fixture
// server and the fake native bridge (running on the widget tester's fake clock), and the
// golden-test fonts (system Arial + the bundled Lucide icons, macOS only).
import 'dart:io';
import 'dart:math';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/exam/engine/engine_clock.dart';
import 'package:mastersat_app/exam/engine/engine_deps.dart';
import 'package:mastersat_app/exam/engine/exam_store.dart';
import 'package:mastersat_app/exam/engine/midterm_engine.dart';
import 'package:mastersat_app/exam/engine/outbox.dart';
import 'package:mastersat_app/exam/engine/power_events.dart';
import 'package:mastersat_app/features/midterm/midterm_flow.dart';

import '../../../exam/engine/support/engine_harness.dart' show M14, ScriptedNativeBridge;

export '../../../exam/engine/support/engine_harness.dart' show ScriptedNativeBridge, M14;

/// The desktop window the goldens are recorded at.
const Size desktopSize = Size(1280, 800);

/// A plain widgets host: MediaQuery, Directionality, default shortcuts/actions, no Material.
Widget host(Widget child) => WidgetsApp(
      color: const Color(0xFF1D4ED8),
      debugShowCheckedModeBanner: false,
      builder: (context, _) => child,
    );

Future<void> pumpHost(WidgetTester tester, Widget child, {Size size = desktopSize}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(host(child));
}

/// Engine time = the widget tester's fake clock.
class WidgetTestClock implements EngineClock {
  WidgetTestClock(this._now) : _start = _now();

  final DateTime Function() _now;
  final DateTime _start;

  @override
  Duration get monotonic => _now().difference(_start);

  @override
  DateTime get wallNow => DateTime.utc(2026, 10, 11, 9).add(monotonic);
}

/// A midterm engine for widget tests: fixture API + fake native, in-memory store.
class FlowRig {
  FlowRig(WidgetTester tester) {
    driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
    clock = WidgetTestClock(() => tester.binding.clock.now());
    api = FixtureV1Api(now: () => clock.wallNow);
    native = ScriptedNativeBridge();
    dir = Directory.systemTemp.createTempSync('midterm-flow-test');
    store = ExamStore.withExecutor(NativeDatabase.memory(), native: native, mediaDir: Directory('${dir.path}/media'));
    hub = OutboxHub(store: store, api: api, clock: clock, random: Random(1));
  }

  late final WidgetTestClock clock;
  late final FixtureV1Api api;
  late final ScriptedNativeBridge native;
  late final Directory dir;
  late final ExamStore store;
  late final OutboxHub hub;
  int _ids = 0;
  final List<MidtermFlowController> _controllers = [];

  Future<Uint8List> _fetch(Uri url) async {
    final key = Uri.decodeComponent(url.path.replaceFirst('/mastersat-media/', ''));
    final bytes = FixtureV1Api.fixtureMedia(key);
    if (bytes == null) throw StateError('no fixture image $key');
    return bytes;
  }

  MidtermEngine engine() => MidtermEngine(
        EngineDeps(
          api: api,
          store: store,
          native: native,
          clock: clock,
          hub: hub,
          fetchMedia: _fetch,
          newId: () => 'uuid-${++_ids}',
          power: PowerEvents.detached(),
        ),
        midtermId: M14.midterm,
        studentName: 'Aziza Karimova',
      );

  MidtermFlowController controller({Duration forfeitHold = const Duration(seconds: 6)}) {
    final c = MidtermFlowController(engine(), forfeitHold: forfeitHold);
    _controllers.add(c);
    return c;
  }

  /// Unmount, stop every timer and close the store (call at the end of each test).
  Future<void> dispose(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox());
    for (final c in _controllers) {
      c.dispose();
    }
    hub.stopAll();
    await tester.pump();
    await tester.runAsync(() => store.close());
    try {
      dir.deleteSync(recursive: true);
    } on FileSystemException {
      // best effort
    }
  }
}

/// Load system Arial and the Lucide icon font so goldens show real text and icons.
/// Returns false when they are not available (goldens are recorded on macOS only).
Future<bool> loadGoldenFonts() async {
  if (_fontsLoaded != null) return _fontsLoaded!;
  const dir = '/System/Library/Fonts/Supplemental';
  final regular = File('$dir/Arial.ttf');
  final bold = File('$dir/Arial Bold.ttf');
  if (!Platform.isMacOS || !regular.existsSync() || !bold.existsSync()) return _fontsLoaded = false;
  ByteData bytes(File f) => ByteData.view(Uint8List.fromList(f.readAsBytesSync()).buffer);
  final arial = FontLoader('Arial')
    ..addFont(Future.value(bytes(regular)))
    ..addFont(Future.value(bytes(bold)));
  await arial.load();
  final lucide = FontLoader('packages/lucide_icons_flutter/Lucide')
    ..addFont(rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'));
  await lucide.load();
  return _fontsLoaded = true;
}

bool? _fontsLoaded;

/// Why a golden is skipped here (null = run it).
String? goldenSkipReason() =>
    Platform.isMacOS ? null : 'Goldens are recorded on macOS with the system Arial; other hosts skip them.';
