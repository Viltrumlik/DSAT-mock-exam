// Shared test support for the runner: the system fonts the runner is drawn with (Arial,
// Georgia, a monospace), an app shell, and a harness that pumps an ExamRunnerScreen over a
// FakeExamSession + FakeIslandHost and records everything a control can change.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/exam/runner/exam_runner_screen.dart';
import 'package:mastersat_app/exam/runner/runner_window.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/island/fake_island_host.dart';
import 'package:mastersat_app/island/island_host.dart';
import 'package:mastersat_app/native/native_bridge.dart' show BatteryStatus;

/// Font files per family: macOS first, then Windows (CI).
const _fontFiles = <String, List<List<String>>>{
  'Arial': [
    ['/System/Library/Fonts/Supplemental/Arial.ttf', r'C:\Windows\Fonts\arial.ttf'],
    ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', r'C:\Windows\Fonts\arialbd.ttf'],
    ['/System/Library/Fonts/Supplemental/Arial Italic.ttf', r'C:\Windows\Fonts\ariali.ttf'],
    ['/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf', r'C:\Windows\Fonts\arialbi.ttf'],
  ],
  'Georgia': [
    ['/System/Library/Fonts/Supplemental/Georgia.ttf', r'C:\Windows\Fonts\georgia.ttf'],
    ['/System/Library/Fonts/Supplemental/Georgia Bold.ttf', r'C:\Windows\Fonts\georgiab.ttf'],
    ['/System/Library/Fonts/Supplemental/Georgia Italic.ttf', r'C:\Windows\Fonts\georgiai.ttf'],
  ],
  // The app's UI face for the dialogs the website portals outside the runner. macOS has no
  // Segoe UI: Arial stands in there, so those goldens show Arial metrics.
  'Segoe UI': [
    [r'C:\Windows\Fonts\segoeui.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'],
    [r'C:\Windows\Fonts\segoeuib.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
  ],
  // Tailwind `font-mono` resolves to Consolas on Windows; macOS has Courier New.
  'Consolas': [
    [r'C:\Windows\Fonts\consola.ttf', '/System/Library/Fonts/Supplemental/Courier New.ttf'],
    [r'C:\Windows\Fonts\consolab.ttf', '/System/Library/Fonts/Supplemental/Courier New Bold.ttf'],
  ],
};

bool _fontsLoaded = false;

/// Whether every runner font was found on this machine (goldens need them).
bool runnerFontsAvailable = false;

/// Loads Arial, Georgia and the monospace face from the system (nothing is bundled — the
/// app uses the system's fonts too). Safe to call more than once.
Future<void> loadRunnerFonts() async {
  if (_fontsLoaded) return;
  _fontsLoaded = true;
  var all = true;
  for (final entry in _fontFiles.entries) {
    final loader = FontLoader(entry.key);
    var any = false;
    for (final candidates in entry.value) {
      final path = candidates.firstWhere((p) => File(p).existsSync(), orElse: () => '');
      if (path.isEmpty) {
        all = false;
        continue;
      }
      final bytes = File(path).readAsBytesSync();
      loader.addFont(Future.value(ByteData.view(Uint8List.fromList(bytes).buffer)));
      any = true;
    }
    if (any) await loader.load();
  }
  runnerFontsAvailable = all;
}

/// The app shell the runner lives in (MaterialApp supplies the localizations the text
/// fields need; the runner draws everything else itself).
Widget runnerApp(Widget child) => MaterialApp(
      debugShowCheckedModeBanner: false,
      home: child,
    );

/// Sets the test window to [size] logical px at 1× (the runner's goldens sizes).
void setWindowSize(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

/// A pumped runner and every observable it can change.
class RunnerHarness {
  RunnerHarness._(this.tester, this.session, this.content, this.window, this.battery);

  final WidgetTester tester;
  final FakeExamSession session;
  final FakeIslandHost content;
  final FakeRunnerWindowControls? window;
  final ValueNotifier<BatteryStatus?>? battery;

  /// Desmos hosts the runner created.
  final List<FakeIslandHost> desmosHosts = [];
  final List<RunnerExit> exits = [];
  final List<QuestionReportRequest> reports = [];
  final List<String> diagnostics = [];

  /// What the report submitter answers (or throws when [reportError] is set).
  ReportOutcome reportOutcome = ReportOutcome.sent;
  Object? reportError;

  ExamRunnerScreenState get state => tester.state<ExamRunnerScreenState>(find.byType(ExamRunnerScreen));

  static Future<RunnerHarness> pump(
    WidgetTester tester, {
    FakeExamSession? session,
    Size size = const Size(1366, 768),
    bool windowControls = true,
    bool canDrawOverIsland = true,
    BatteryStatus? battery,
    bool inert = false,
    Widget? overlay,
    bool animate = false,
    bool customSubmitter = true,
    bool nativeScientificOnly = true,
  }) async {
    setWindowSize(tester, size);
    final s = session ?? FakeExamSession.readingWriting(tick: false);
    final content = FakeIslandHost(IslandKind.content, canDrawOverIsland: canDrawOverIsland);
    final window = windowControls ? FakeRunnerWindowControls() : null;
    final batteryN = battery == null ? null : ValueNotifier<BatteryStatus?>(battery);
    final h = RunnerHarness._(tester, s, content, window, batteryN);
    await tester.pumpWidget(runnerApp(ExamRunnerScreen(
      session: s,
      contentHost: content,
      islandFactory: (kind) {
        final host = FakeIslandHost(kind, canDrawOverIsland: canDrawOverIsland);
        h.desmosHosts.add(host);
        return host;
      },
      window: window,
      battery: batteryN,
      inert: inert,
      overlay: overlay,
      animate: animate,
      nativeScientificOnly: nativeScientificOnly,
      onExit: h.exits.add,
      onDiagnostic: (w, m) => h.diagnostics.add('$w: $m'),
      submitReport: customSubmitter
          ? (r) async {
              h.reports.add(r);
              if (h.reportError != null) throw h.reportError!;
              return h.reportOutcome;
            }
          : null,
    )));
    await tester.pump();
    await tester.pump();
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      window?.dispose();
      batteryN?.dispose();
    });
    return h;
  }

  /// Everything a control can change, as one comparable string.
  String fingerprint() {
    final st = state;
    final texts = find
        .byType(Text)
        .hitTestable()
        .evaluate()
        .map((e) => (e.widget as Text).data ?? (e.widget as Text).textSpan?.toPlainText() ?? '')
        .join('|');
    return [
      'log:${session.log.length}',
      'tools:${st.tools.fingerprint}',
      'posted:${content.posted.length}',
      'desmos:${desmosHosts.map((h) => '${h.posted.length}/${h.visible}').join(',')}',
      'window:${window?.log.length ?? 0}',
      'exits:${exits.length}',
      'reports:${reports.length}',
      'phase:${session.phase.name}',
      'zoom:${session.zoom}',
      'notes:${session.notes.length}',
      'toasts:${st.toasts.notices.length}/${st.toasts.timerMessage}',
      'battery:${find.byKey(const ValueKey('battery.banner')).evaluate().length}',
      'texts:$texts',
    ].join(' ');
  }

  /// Taps the widget [finder] finds and settles the frame (no animations run forever here:
  /// spinners are frozen with animate:false).
  Future<void> tap(Finder finder) async {
    await tester.tap(finder);
    await tester.pump();
    await tester.pump();
  }

  Future<void> key(LogicalKeyboardKey key, {String? character}) async {
    await tester.sendKeyEvent(key, character: character);
    await tester.pump();
  }
}

/// A battery reading.
const lowBattery = BatteryStatus(percent: 18, charging: false, hasBattery: true);
const okBattery = BatteryStatus(percent: 76, charging: false, hasBattery: true);
