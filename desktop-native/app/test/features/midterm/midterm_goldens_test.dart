// Golden images of every midterm screen at 1280×800 (the rules page taller), with the system
// Arial and the bundled Lucide icons, so a reviewer can put them next to the website's.
// Recorded on macOS: `flutter test --update-goldens test/features/midterm/midterm_goldens_test.dart`.
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/features/midterm/code_screen.dart';
import 'package:mastersat_app/features/midterm/midterm_copy.dart';
import 'package:mastersat_app/features/midterm/midterm_ui.dart';
import 'package:mastersat_app/features/midterm/overlays.dart';
import 'package:mastersat_app/features/midterm/precheck_screen.dart';
import 'package:mastersat_app/features/midterm/rules_screen.dart';
import 'package:mastersat_app/features/midterm/status_screens.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import 'support/midterm_rig.dart';

const _rules = MidtermRules(
  title: 'October Midterm · Math',
  subject: 'MATH',
  questionCount: 44,
  moduleCount: 2,
  durationsMin: [35, 35],
  calculator: CalculatorMode.graphing,
  offscreenLimit: 3,
  offscreenGraceSeconds: 3,
  lateGraceSeconds: 300,
  // The pass mark comes in the prepared rules (`scoring_scale` + `pass_mark`).
  scoringScale: 'SCALE_800',
  passMark: 500,
);

/// A stand-in for the runner under the midterm overlays (runner-ui draws the real one).
class _RunnerStandIn extends StatelessWidget {
  const _RunnerStandIn({this.banner, this.headerExtra});
  final Widget? banner;
  final Widget? headerExtra;

  @override
  Widget build(BuildContext context) {
    return MidtermTheme(
      child: ColoredBox(
        color: MidtermColors.white,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              height: 72,
              padding: const EdgeInsets.symmetric(horizontal: 24),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: MidtermColors.slate200))),
              child: Row(children: [
                Text('October Midterm · Math — Module 1', style: MidtermText.size(16, weight: FontWeight.w700)),
                const Spacer(),
                Text('31:42', style: MidtermText.size(20, weight: FontWeight.w700)),
                const Spacer(),
                ?headerExtra,
              ]),
            ),
            ?banner,
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(48),
                child: Text(
                  'Question 7 — the paper is drawn by runner-ui; this stand-in only shows the midterm layers.',
                  style: MidtermText.size(16, color: MidtermColors.slate500),
                ),
              ),
            ),
            const SatColorRule(),
          ],
        ),
      ),
    );
  }
}

void main() {
  final skip = goldenSkipReason() != null;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    if (!skip) await loadGoldenFonts();
  });

  Future<void> golden(WidgetTester tester, String name, Widget child, {Size size = desktopSize}) async {
    debugDisableShadows = false;
    try {
      await pumpHost(tester, child, size: size);
      await tester.pump();
      await expectLater(find.byType(WidgetsApp), matchesGoldenFile('goldens/$name.png'));
    } finally {
      debugDisableShadows = true;
    }
  }

  testWidgets('rules', (tester) async {
    await golden(tester, 'midterm_rules', MidtermRulesScreen(rules: _rules, requiresCode: true, onProceed: () {}),
        size: const Size(1280, 1220));
  }, skip: skip);

  testWidgets('rules: Foundation Math, worked by hand', (tester) async {
    const rules = MidtermRules(
      title: 'Foundation Midterm · Math',
      subject: 'MATH',
      questionCount: 44,
      moduleCount: 2,
      durationsMin: [35, 35],
      offscreenLimit: 3,
      offscreenGraceSeconds: 3,
      lateGraceSeconds: 300,
      scoringScale: 'SCALE_100',
      passMark: 50,
    );
    await golden(tester, 'midterm_rules_by_hand',
        MidtermRulesScreen(rules: rules, requiresCode: true, onProceed: () {}),
        size: const Size(1280, 1220));
  }, skip: skip);

  testWidgets('access code', (tester) async {
    await golden(tester, 'midterm_code', MidtermCodeScreen(onSubmitCode: (_) async {}, onBack: () {}));
  }, skip: skip);

  testWidgets('access code — wrong code', (tester) async {
    await pumpHost(
      tester,
      MidtermCodeScreen(onSubmitCode: (_) async => throw StateError('code_incorrect'), onBack: () {}),
    );
    await tester.enterText(find.byType(EditableText), '123456');
    await tester.pump();
    await tester.tap(find.text('Verify & begin'));
    await tester.pump();
    debugDisableShadows = false;
    await tester.pump();
    await expectLater(find.byType(WidgetsApp), matchesGoldenFile('goldens/midterm_code_wrong.png'));
    debugDisableShadows = true;
  }, skip: skip);

  testWidgets('pre-check — ready', (tester) async {
    await golden(tester, 'midterm_precheck_ready',
        MidtermPrecheckScreen(native: FakeNativeBridge(), resume: false, onContinue: () async {}, onBack: () {}));
  }, skip: skip);

  testWidgets('pre-check — things to fix', (tester) async {
    final native = FakeNativeBridge(displays: 2, apps: [
      const BlockedApp(exe: 'Telegram.exe', name: 'Telegram', closable: true),
      const BlockedApp(exe: 'AnyDesk.exe', name: 'AnyDesk', closable: false),
    ])
      ..batteryStatus = const BatteryStatus(percent: 19, charging: false, hasBattery: true);
    await golden(
      tester,
      'midterm_precheck_fix',
      MidtermPrecheckScreen(native: native, resume: false, onContinue: () async {}, onBack: () {}),
      size: const Size(1280, 900),
    );
  }, skip: skip);

  testWidgets('pre-check — resume', (tester) async {
    await golden(tester, 'midterm_precheck_resume',
        MidtermPrecheckScreen(native: FakeNativeBridge(), resume: true, onContinue: () async {}, onBack: () {}));
  }, skip: skip);

  testWidgets('off-screen warning over the paper', (tester) async {
    await golden(
      tester,
      'midterm_offscreen_warning',
      const Stack(fit: StackFit.expand, children: [
        _RunnerStandIn(),
        OffscreenWarning(secondsLeft: 2, chancesLeft: 2),
      ]),
    );
  }, skip: skip);

  testWidgets('after-return note, battery and reconnecting banners', (tester) async {
    const low = BatteryStatus(percent: 18, charging: false, hasBattery: true);
    await golden(
      tester,
      'midterm_runner_layers',
      Stack(fit: StackFit.expand, children: [
        const _RunnerStandIn(
          headerExtra: MidtermBatteryIndicator(battery: low),
          banner: Column(mainAxisSize: MainAxisSize.min, children: [
            ReconnectingBanner(show: true),
            LowBatteryBanner(battery: low),
          ]),
        ),
        OffscreenNotice(
          text: 'You left the exam window. That counted as a warning — 1 chance left.',
          onDismiss: () {},
        ),
      ]),
    );
  }, skip: skip);

  testWidgets('waiting for the server between modules', (tester) async {
    await golden(
      tester,
      'midterm_transition',
      const MidtermWaitingScreen(title: 'Continuing to Module 2', message: 'Math'),
    );
  }, skip: skip);

  testWidgets('waiting offline at the boundary', (tester) async {
    await golden(
      tester,
      'midterm_transition_offline',
      const MidtermWaitingScreen(
        title: 'Continuing to Module 2',
        message: 'Math',
        detail: MidtermCopy.waitingForConnection,
      ),
    );
  }, skip: skip);

  testWidgets('terminated', (tester) async {
    await golden(tester, 'midterm_terminated', MidtermTerminatedScreen(onContinue: () {}));
  }, skip: skip);

  testWidgets('done — released score', (tester) async {
    await golden(
      tester,
      'midterm_done_released',
      MidtermDoneScreen(
        result: const MidtermResult(
          attemptId: 5521,
          state: AttemptState.completed,
          released: true,
          totalScore: 680,
          scoreCeiling: 800,
        ),
        onHome: () {},
        onOpenReport: () {},
      ),
    );
  }, skip: skip);

  testWidgets('done — awaiting release', (tester) async {
    await golden(
      tester,
      'midterm_done_awaiting',
      MidtermDoneScreen(
        result: const MidtermResult(attemptId: 5521, state: AttemptState.completed, released: false),
        onHome: () {},
        onOpenReport: () {},
      ),
    );
  }, skip: skip);

  testWidgets('update required', (tester) async {
    await golden(
      tester,
      'midterm_update_required',
      MidtermUpdateRequiredScreen(onHome: () {}, onUpdateNow: (_) async {}, onDownload: () {}),
    );
  }, skip: skip);

  testWidgets('session moved', (tester) async {
    await golden(tester, 'midterm_session_moved', MidtermSessionMovedScreen(onHome: () {}));
  }, skip: skip);

  testWidgets('could not open', (tester) async {
    await golden(
      tester,
      'midterm_open_failed',
      MidtermErrorScreen(
        title: MidtermCopy.openFailedTitle,
        body: MidtermCopy.openFailedBody,
        onRetry: () {},
        onHome: () {},
      ),
    );
  }, skip: skip);

  test('goldens are only skipped off macOS', () {
    expect(skip, !Platform.isMacOS);
  });
}
