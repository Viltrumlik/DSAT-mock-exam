// Widget tests for every midterm screen on its own: the copy the student reads, every button
// doing what it says, the keyboard, and the states in between ("Locking…", "Closing…").
import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/engine/lockdown_controller.dart';
import 'package:mastersat_app/exam/engine/midterm_engine.dart';
import 'package:mastersat_app/features/midterm/code_screen.dart';
import 'package:mastersat_app/features/midterm/midterm_copy.dart';
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
);

void main() {
  group('rules', () {
    testWidgets('the website copy, the whole paper\'s time, no Back; continue proceeds', (tester) async {
      var proceeded = 0;
      await pumpHost(tester, MidtermRulesScreen(rules: _rules, requiresCode: true, onProceed: () => proceeded++),
          size: const Size(1280, 1200));
      expect(find.text('MIDTERM'), findsOneWidget);
      expect(find.text('October Midterm · Math'), findsOneWidget);
      expect(find.text('Read the rules below, then continue to start your Math midterm.'), findsOneWidget);
      expect(find.text('70 min'), findsOneWidget);
      expect(find.text('35 + 35 min'), findsOneWidget);
      expect(find.text('44'), findsOneWidget);
      expect(find.text(MidtermCopy.requiredCode), findsOneWidget);
      expect(find.text(MidtermCopy.allowedCalculator), findsOneWidget);
      expect(find.text(MidtermCopy.prohibitedCalculatorByHand), findsNothing, reason: 'this paper has Desmos');
      expect(
        find.text('Leaving full screen or switching to another window. You get 3 seconds to come back, and only 2 '
            'warnings — the third time, your paper is submitted immediately.'),
        findsOneWidget,
      );
      expect(find.textContaining('cannot be paused or reset', findRichText: true), findsOneWidget);
      expect(find.textContaining("You need to reach this midterm's pass mark.", findRichText: true), findsOneWidget);
      expect(find.text('TO PASS'), findsNothing, reason: 'no pass mark quoted without a known scale');
      expect(find.text('Back'), findsNothing, reason: 'no Back, as on the website');
      await tester.ensureVisible(find.text("I'm ready — continue"));
      await tester.pump();
      await tester.tap(find.text("I'm ready — continue"));
      expect(proceeded, 1);
      // The button has focus from the start: Enter continues too.
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      expect(proceeded, 2);
    });

    testWidgets('no code needed → no code rule; scientific calculator; the prepared scale quotes the pass mark',
        (tester) async {
      const rules = MidtermRules(
        title: 'Junior Midterm',
        subject: 'MATH',
        questionCount: 22,
        moduleCount: 1,
        durationsMin: [40],
        calculator: CalculatorMode.scientific,
        offscreenLimit: 3,
        offscreenGraceSeconds: 3,
        lateGraceSeconds: 300,
        scoringScale: 'SCALE_800',
        passMark: 500,
      );
      await pumpHost(tester, MidtermRulesScreen(rules: rules, requiresCode: false, onProceed: () {}),
          size: const Size(1280, 1200));
      expect(find.text(MidtermCopy.requiredCode), findsNothing);
      expect(find.text(MidtermCopy.allowedScientific), findsOneWidget);
      expect(find.text(MidtermCopy.prohibitedCalculatorByHand), findsNothing, reason: 'junior has Desmos Scientific');
      expect(find.text('40 min'), findsOneWidget);
      expect(find.textContaining('+'), findsNothing, reason: 'one module, no split');
      expect(find.text('TO PASS'), findsOneWidget);
      expect(find.text('500 out of 800'), findsOneWidget);
      expect(find.textContaining('You need 500 out of 800 to pass.', findRichText: true), findsOneWidget);
    });

    testWidgets("the midterm's own pass mark, on a 100 scale", (tester) async {
      const rules = MidtermRules(
        title: 'Midterm',
        subject: 'MATH',
        questionCount: 22,
        moduleCount: 1,
        durationsMin: [40],
        calculator: CalculatorMode.graphing,
        offscreenLimit: 3,
        offscreenGraceSeconds: 3,
        lateGraceSeconds: 300,
        scoringScale: 'SCALE_100',
        passMark: 60,
      );
      await pumpHost(tester, MidtermRulesScreen(rules: rules, requiresCode: true, onProceed: () {}),
          size: const Size(1280, 1200));
      expect(find.text('60 out of 100'), findsOneWidget);
      expect(find.textContaining('You need 60 out of 100 to pass.', findRichText: true), findsOneWidget);
    });

    testWidgets('a pre-midterm (no pass mark) quotes none even though its scale is known', (tester) async {
      const rules = MidtermRules(
        title: 'Pre-midterm',
        subject: 'MATH',
        questionCount: 22,
        moduleCount: 1,
        durationsMin: [40],
        calculator: CalculatorMode.graphing,
        offscreenLimit: 3,
        offscreenGraceSeconds: 3,
        lateGraceSeconds: 300,
        scoringScale: 'SCALE_800',
      );
      await pumpHost(tester, MidtermRulesScreen(rules: rules, requiresCode: true, onProceed: () {}),
          size: const Size(1280, 1200));
      expect(find.text('TO PASS'), findsNothing);
      expect(find.textContaining('out of', findRichText: true), findsNothing);
      expect(find.textContaining("You need to reach this midterm's pass mark.", findRichText: true), findsOneWidget);
    });

    testWidgets('a retake says so (from the prepared rules); Reading and Writing has no calculator rule',
        (tester) async {
      const rules = MidtermRules(
        title: 'R&W Retake',
        subject: 'READING_WRITING',
        questionCount: 27,
        moduleCount: 1,
        durationsMin: [32],
        offscreenLimit: 3,
        offscreenGraceSeconds: 3,
        lateGraceSeconds: 300,
        scoringScale: 'SCALE_100',
        passMark: 50,
        isRetake: true,
      );
      await pumpHost(tester, MidtermRulesScreen(rules: rules, requiresCode: true, onProceed: () {}),
          size: const Size(1280, 1200));
      expect(find.text('Read the rules below, then continue to start your Reading and Writing midterm.'), findsOneWidget);
      expect(find.text(MidtermCopy.allowedCalculator), findsNothing);
      expect(find.text(MidtermCopy.allowedScientific), findsNothing);
      // R&W has never had a calculator: it is told nothing about one, not "by hand".
      expect(find.text(MidtermCopy.prohibitedCalculatorByHand), findsNothing);
      expect(find.textContaining('there is no retake of a retake', findRichText: true), findsOneWidget);
      expect(find.textContaining('You need', findRichText: true), findsNothing, reason: 'a retake says retake');
    });

    testWidgets('the constructor overrides win over the prepared rules', (tester) async {
      await pumpHost(
          tester,
          MidtermRulesScreen(
            rules: _rules,
            requiresCode: true,
            onProceed: () {},
            scoringScale: 'SCALE_100',
            passMark: 70,
          ),
          size: const Size(1280, 1200));
      expect(find.text('70 out of 100'), findsOneWidget);
      await pumpHost(
          tester,
          MidtermRulesScreen(rules: _rules, requiresCode: true, onProceed: () {}, isRetake: true),
          size: const Size(1280, 1200));
      expect(find.textContaining('there is no retake of a retake', findRichText: true), findsOneWidget);
    });

    testWidgets('Foundation Math has no calculator: "by hand", FIRST under Prohibited, nothing under Allowed',
        (tester) async {
      const rules = MidtermRules(
        title: 'Foundation Midterm · Math',
        subject: 'MATH',
        questionCount: 22,
        moduleCount: 1,
        durationsMin: [40],
        offscreenLimit: 3,
        offscreenGraceSeconds: 3,
        lateGraceSeconds: 300,
      );
      await pumpHost(tester, MidtermRulesScreen(rules: rules, requiresCode: true, onProceed: () {}),
          size: const Size(1280, 1200));
      expect(MidtermCopy.prohibitedCalculatorByHand,
          'Any calculator, built-in or physical — this paper is worked out by hand, on your scratch paper.');
      expect(find.text(MidtermCopy.prohibitedCalculatorByHand), findsOneWidget);
      expect(find.text(MidtermCopy.allowedCalculator), findsNothing);
      expect(find.text(MidtermCopy.allowedScientific), findsNothing);
      // First under Prohibited: above "Other apps…", and drawn with the calculator icon.
      final byHand = tester.getTopLeft(find.text(MidtermCopy.prohibitedCalculatorByHand));
      final apps = tester.getTopLeft(find.text(MidtermCopy.prohibitedApps));
      expect(byHand.dy, lessThan(apps.dy));
      expect((byHand.dx - apps.dx).abs(), lessThan(1), reason: 'same column');
      final calculatorIcons = find.byWidgetPredicate((w) => w is Icon && w.icon == LucideIcons.calculator);
      expect(calculatorIcons, findsOneWidget);
      expect(tester.getTopLeft(calculatorIcons).dy, lessThan(apps.dy));
    });

    testWidgets('narrow windows stack the columns and still scroll to the button', (tester) async {
      var proceeded = 0;
      await pumpHost(tester, MidtermRulesScreen(rules: _rules, requiresCode: true, onProceed: () => proceeded++),
          size: const Size(700, 600));
      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(find.text("I'm ready — continue"), 300);
      await tester.tap(find.text("I'm ready — continue"));
      expect(proceeded, 1);
    });
  });

  group('access code', () {
    testWidgets('digits only, six at most; the button waits for six; Enter submits', (tester) async {
      final codes = <String>[];
      await pumpHost(tester, MidtermCodeScreen(onSubmitCode: (c) async => codes.add(c), onBack: () {}));
      expect(find.text('Enter your access code'), findsOneWidget);
      expect(find.text('••••••'), findsOneWidget);
      await tester.enterText(find.byType(EditableText), '48a2-91399');
      await tester.pump();
      expect(find.text('482913'), findsOneWidget);
      expect(find.text('••••••'), findsNothing);
      await tester.enterText(find.byType(EditableText), '4829');
      await tester.pump();
      await tester.tap(find.text('Verify & begin'));
      expect(codes, isEmpty, reason: 'four digits cannot be sent');
      await tester.enterText(find.byType(EditableText), '482913');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      expect(codes, ['482913']);
    });

    testWidgets('a wrong code says so and can be retyped; no connection says that instead', (tester) async {
      var next = <Object>[
        const ApiError(status: 403, body: ApiErrorBody(code: 'code_incorrect')),
        const NetworkError('offline'),
      ];
      await pumpHost(
        tester,
        MidtermCodeScreen(
          onSubmitCode: (c) async {
            if (next.isNotEmpty) {
              final e = next.first;
              next = next.sublist(1);
              throw e;
            }
          },
          onBack: () {},
        ),
      );
      await tester.enterText(find.byType(EditableText), '000000');
      await tester.pump();
      await tester.tap(find.text('Verify & begin'));
      await tester.pump();
      expect(find.text("That code isn't right. Ask your teacher for the current code."), findsOneWidget);
      await tester.enterText(find.byType(EditableText), '000001');
      await tester.pump();
      expect(find.text("That code isn't right. Ask your teacher for the current code."), findsNothing,
          reason: 'typing clears the error');
      await tester.tap(find.text('Verify & begin'));
      await tester.pump();
      expect(find.text(MidtermCopy.codeNetwork), findsOneWidget);
    });

    testWidgets('"Starting…" while verifying; Back to rules is off meanwhile, then works', (tester) async {
      final gate = Completer<void>();
      var backs = 0;
      await pumpHost(tester, MidtermCodeScreen(onSubmitCode: (_) => gate.future, onBack: () => backs++));
      await tester.enterText(find.byType(EditableText), '482913');
      await tester.pump();
      await tester.tap(find.text('Verify & begin'));
      await tester.pump();
      expect(find.text('Starting…'), findsOneWidget);
      await tester.tap(find.text('Back to rules'));
      expect(backs, 0);
      gate.complete();
      await tester.pump();
      await tester.tap(find.text('Back to rules'));
      expect(backs, 1);
    });
  });

  group('pre-check', () {
    testWidgets('a clean laptop: every row green, battery shown; Lock and start locks', (tester) async {
      final native = FakeNativeBridge();
      final gate = Completer<void>();
      var continued = 0;
      var backs = 0;
      await pumpHost(
        tester,
        MidtermPrecheckScreen(
          native: native,
          resume: false,
          onContinue: () {
            continued++;
            return gate.future;
          },
          onBack: () => backs++,
        ),
      );
      expect(find.text('Get this computer ready'), findsOneWidget);
      expect(find.text(MidtermCopy.precheckLead), findsOneWidget);
      expect(find.text('One screen'), findsOneWidget);
      expect(find.text('No chat or screen-sharing apps open'), findsOneWidget);
      expect(find.text('Battery 87%, charging'), findsOneWidget);
      await tester.tap(find.text('Lock and start'));
      await tester.pump();
      expect(continued, 1);
      expect(find.text('Locking…'), findsOneWidget);
      await tester.tap(find.text('Back'));
      expect(backs, 0, reason: 'no Back while locking');
      await tester.tap(find.text('Locking…'));
      expect(continued, 1, reason: 'no double lock');
      gate.complete();
      await tester.pump();
      expect(find.text('Lock and start'), findsOneWidget);
      await tester.tap(find.text('Back'));
      expect(backs, 1);
    });

    testWidgets('a past paper (PrecheckCopy.test) says "test" where a midterm is named; the rest is shared', (
      tester,
    ) async {
      final native = FakeNativeBridge(vm: true, remote: true);
      var backs = 0;
      await pumpHost(
        tester,
        MidtermPrecheckScreen(
          native: native,
          resume: true,
          copy: PrecheckCopy.test,
          onContinue: () async {},
          onBack: () => backs++,
        ),
      );
      expect(find.text('Resume your test'), findsOneWidget);
      expect(
        find.text(
          'When you continue, MasterSAT locks this computer until your test ends. Other apps, '
          'notifications, screenshots and copying are turned off.',
        ),
        findsOneWidget,
      );
      expect(find.text('Remote Desktop session'), findsOneWidget);
      expect(find.text('Take the test on this computer itself, not over Remote Desktop.'), findsOneWidget);
      expect(find.text('Virtual machine'), findsOneWidget);
      expect(find.text("Tests can't be taken inside a virtual machine."), findsOneWidget);
      expect(find.text('Lock and resume'), findsOneWidget);
      expect(find.textContaining('idterm'), findsNothing);
      await tester.tap(find.text('Back to Home'));
      expect(backs, 1);

      // The midterm's own words are unchanged (the default).
      expect(PrecheckCopy.midterm.resumeTitle, 'Resume your midterm');
      expect(PrecheckCopy.midterm.lead, MidtermCopy.precheckLead);
      expect(PrecheckCopy.midterm.vmHint, "Midterms can't be taken inside a virtual machine.");
      expect(PrecheckCopy.midterm.remoteHint, 'Take the midterm on this computer itself, not over Remote Desktop.');
      expect(PrecheckCopy.midterm.back, 'Back');
      expect(PrecheckCopy.test.title, PrecheckCopy.midterm.title);
    });

    testWidgets('apps to close: a Close button each (or the tray hint); the row clears itself', (tester) async {
      final native = FakeNativeBridge(apps: [
        const BlockedApp(exe: 'Telegram.exe', name: 'Telegram', closable: true),
        const BlockedApp(exe: 'AnyDesk.exe', name: 'AnyDesk', closable: false),
      ]);
      await pumpHost(tester, MidtermPrecheckScreen(native: native, resume: false, onContinue: () async {}));
      expect(find.text('Close Telegram'), findsOneWidget);
      expect(find.text('Close AnyDesk'), findsOneWidget);
      expect(find.text('Close AnyDesk from the system tray, then come back.'), findsOneWidget);
      expect(find.text('Close'), findsOneWidget, reason: 'only the closable app has a button');
      await tester.tap(find.text('Close'));
      await tester.pump(); // "Closing…" paints first
      await tester.pump();
      expect(native.calls, contains('closeApp Telegram.exe'));
      expect(find.text('Close Telegram'), findsNothing);
      // Lock and start stays off until the machine passes.
      expect(find.text('Lock and start'), findsOneWidget);
      native.apps.clear(); // the student closed AnyDesk from the tray
      await tester.pump(const Duration(seconds: 2));
      expect(find.text('No chat or screen-sharing apps open'), findsOneWidget);
    });

    testWidgets('two screens, Remote Desktop, a VM: each says how to fix it; the 2 s re-check notices', (tester) async {
      final native = FakeNativeBridge(displays: 2, remote: true, vm: true);
      var continued = 0;
      await pumpHost(
          tester, MidtermPrecheckScreen(native: native, resume: false, onContinue: () async => continued++));
      expect(find.text('2 screens connected'), findsOneWidget);
      expect(find.text('Disconnect the second monitor or projector.'), findsOneWidget);
      expect(find.text('Remote Desktop session'), findsOneWidget);
      expect(find.text('Virtual machine'), findsOneWidget);
      await tester.tap(find.text('Lock and start'));
      expect(continued, 0, reason: 'disabled while the machine fails');
      native
        ..displays = 1
        ..remote = false
        ..vm = false;
      await tester.pump(const Duration(seconds: 2));
      expect(find.text('One screen'), findsOneWidget);
      await tester.tap(find.text('Lock and start'));
      expect(continued, 1);
    });

    testWidgets('low battery warns (amber) and asks for the charger', (tester) async {
      final native = FakeNativeBridge()..batteryStatus = const BatteryStatus(percent: 20, charging: false, hasBattery: true);
      await pumpHost(tester, MidtermPrecheckScreen(native: native, resume: false, onContinue: () async {}));
      expect(find.text('Battery 20%'), findsOneWidget);
      expect(find.text('Plug in your charger before you start.'), findsOneWidget);
      native.batteryStatus = null; // a desktop PC: no row
      await tester.pump(const Duration(seconds: 2));
      expect(find.textContaining('Battery'), findsNothing);
    });

    testWidgets('exactly 25 % on battery is not low (LockdownScreens.tsx: isLowBattery, < 25)', (tester) async {
      final native = FakeNativeBridge()..batteryStatus = const BatteryStatus(percent: 25, charging: false, hasBattery: true);
      await pumpHost(tester, MidtermPrecheckScreen(native: native, resume: false, onContinue: () async {}));
      expect(find.text('Battery 25%'), findsOneWidget);
      expect(find.text('Plug in your charger before you start.'), findsNothing);
    });

    testWidgets('failures are said plainly under the list; a failed pre-check updates the rows', (tester) async {
      final native = FakeNativeBridge();
      final errors = <Object>[
        const NetworkError('offline'),
        const ProofRefused('no key'),
        const MidtermBlocked(MidtermBlockReason.desktopRequired, 'This midterm can only be taken in the MasterSAT app for Windows.'),
        const NativeBridgeException(NativeStatus.errOs, 'ms_lock_enter'),
        PrecheckFailed(PrecheckReport.parse(
            '{"ok":false,"displays":1,"remote":false,"vm":false,"apps":[{"exe":"Zoom.exe","name":"Zoom","closable":true}]}')),
      ];
      await pumpHost(
        tester,
        MidtermPrecheckScreen(native: native, resume: true, onContinue: () async => throw errors.removeAt(0)),
      );
      expect(find.text('Resume your midterm'), findsOneWidget);
      Future<void> press() async {
        await tester.tap(find.text('Lock and resume'));
        await tester.pump();
      }

      await press();
      expect(find.text(MidtermCopy.network), findsOneWidget);
      await press();
      expect(find.text(MidtermCopy.proofInvalid), findsOneWidget);
      await press();
      expect(find.text('This midterm can only be taken in the MasterSAT app for Windows.'), findsOneWidget);
      await press();
      expect(find.text(MidtermCopy.lockFailed), findsOneWidget);
      await press();
      expect(find.text('Close Zoom'), findsOneWidget, reason: 'the refused pre-check is shown as rows');
      expect(find.text('Back'), findsNothing, reason: 'no Back unless the caller offers one');
    });

    testWidgets('a pre-check that cannot run says so (and recovers when it can)', (tester) async {
      final native = _FlakyPrecheck();
      await pumpHost(tester, MidtermPrecheckScreen(native: native, resume: false, onContinue: () async {}));
      expect(find.text('Checking this computer…'), findsOneWidget);
      expect(find.text(MidtermCopy.cannotCheck), findsOneWidget);
      native.broken = false;
      await tester.pump(const Duration(seconds: 2));
      expect(find.text(MidtermCopy.cannotCheck), findsNothing);
      expect(find.text('One screen'), findsOneWidget);
    });
  });

  group('off-screen', () {
    testWidgets('the warning counts down, shows the chances left and swallows every click', (tester) async {
      var underneath = 0;
      await pumpHost(
        tester,
        Stack(children: [
          GestureDetector(onTap: () => underneath++, child: const SizedBox.expand()),
          const Positioned.fill(child: OffscreenWarning(secondsLeft: 3, chancesLeft: 2)),
        ]),
      );
      expect(find.text('Come back to your exam'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('seconds to return'), findsOneWidget);
      expect(find.text('2 chances left'), findsOneWidget);
      await tester.tapAt(const Offset(20, 20));
      expect(underneath, 0);
      await pumpHost(tester, const OffscreenWarning(secondsLeft: 1, chancesLeft: 0));
      expect(find.text('second to return'), findsOneWidget);
      expect(find.text('No chances left'), findsOneWidget);
    });

    testWidgets('the after-return note: Got it dismisses it', (tester) async {
      var dismissed = 0;
      await pumpHost(
        tester,
        OffscreenNotice(
          text: 'You left the exam window. That counted as a warning — 2 chances left.',
          onDismiss: () => dismissed++,
        ),
      );
      expect(find.text('You left the exam window. That counted as a warning — 2 chances left.'), findsOneWidget);
      await tester.tap(find.text('Got it'));
      expect(dismissed, 1);
    });

    testWidgets('terminated: it explains; See your result moves on', (tester) async {
      var seen = 0;
      await pumpHost(tester, MidtermTerminatedScreen(onContinue: () => seen++));
      expect(find.text('Your exam was submitted'), findsOneWidget);
      expect(find.text(MidtermCopy.terminatedBody), findsOneWidget);
      await tester.tap(find.text('See your result'));
      expect(seen, 1);
    });
  });

  group('battery and connection', () {
    testWidgets('the banner shows below 25 % unplugged, can be dismissed, and warns again next time',
        (tester) async {
      Future<void> show(BatteryStatus? b) => pumpHost(tester, LowBatteryBanner(battery: b));
      await show(const BatteryStatus(percent: 26, charging: false, hasBattery: true));
      expect(find.textContaining('battery is low'), findsNothing);
      // 25 % itself does not warn (the website's and 0.1.0's `percent < 25`).
      await show(const BatteryStatus(percent: 25, charging: false, hasBattery: true));
      expect(find.textContaining('battery is low'), findsNothing);
      await show(const BatteryStatus(percent: 24, charging: false, hasBattery: true));
      expect(find.text('Your battery is low (24%). Plug in your device.'), findsOneWidget);
      await tester.tap(find.byIcon(LucideIcons.x));
      await tester.pump();
      expect(find.textContaining('battery is low'), findsNothing);
      await show(const BatteryStatus(percent: 24, charging: true, hasBattery: true)); // plugged in
      await show(const BatteryStatus(percent: 22, charging: false, hasBattery: true)); // unplugged again
      expect(find.text('Your battery is low (22%). Plug in your device.'), findsOneWidget);
    });

    testWidgets('the battery reading: percent and icon; nothing on a desktop PC', (tester) async {
      await pumpHost(
          tester, const MidtermBatteryIndicator(battery: BatteryStatus(percent: 64, charging: false, hasBattery: true)));
      expect(find.text('64%'), findsOneWidget);
      await pumpHost(tester, const MidtermBatteryIndicator(battery: null));
      expect(find.textContaining('%'), findsNothing);
    });

    testWidgets('reconnecting banner only while offline', (tester) async {
      await pumpHost(tester, const ReconnectingBanner(show: true));
      expect(find.text(MidtermCopy.reconnecting), findsOneWidget);
      await pumpHost(tester, const ReconnectingBanner(show: false));
      expect(find.text(MidtermCopy.reconnecting), findsNothing);
    });
  });

  group('status screens', () {
    testWidgets('update required: one click with progress; a failed update offers the download', (tester) async {
      final gate = Completer<void>();
      void Function(int)? progress;
      var downloads = 0;
      var homes = 0;
      await pumpHost(
        tester,
        MidtermUpdateRequiredScreen(
          onHome: () => homes++,
          onDownload: () => downloads++,
          onUpdateNow: (p) {
            progress = p;
            return gate.future;
          },
        ),
      );
      expect(find.text('Update the MasterSAT app'), findsOneWidget);
      expect(find.text(MidtermCopy.updateBody), findsOneWidget);
      expect(find.text('Download for Windows'), findsNothing);
      await tester.tap(find.text('Update now'));
      await tester.pump();
      progress!(42);
      await tester.pump();
      expect(find.text('Updating… 42%'), findsOneWidget);
      await tester.tap(find.text('Back to my tests'));
      expect(homes, 0, reason: 'not while updating');
      gate.completeError(StateError('download failed'));
      await tester.pump();
      await tester.pump();
      expect(find.text(MidtermCopy.updateFailed), findsOneWidget);
      await tester.tap(find.text('Download for Windows'));
      expect(downloads, 1);
      await tester.tap(find.text('Back to my tests'));
      expect(homes, 1);
    });

    testWidgets('session moved: Back to my tests', (tester) async {
      var homes = 0;
      await pumpHost(tester, MidtermSessionMovedScreen(onHome: () => homes++));
      expect(find.text('This midterm was opened in another window'), findsOneWidget);
      await tester.tap(find.text('Back to my tests'));
      expect(homes, 1);
    });

    testWidgets('errors always have a way back; Try again when it can help', (tester) async {
      var retries = 0;
      var homes = 0;
      await pumpHost(
        tester,
        MidtermErrorScreen(
          title: MidtermCopy.openFailedTitle,
          body: MidtermCopy.openFailedBody,
          onRetry: () => retries++,
          onHome: () => homes++,
        ),
      );
      await tester.tap(find.text('Try again'));
      await tester.tap(find.text('Back to my tests'));
      expect((retries, homes), (1, 1));
    });

    testWidgets('waiting: the transition names the module; the plain one is a spinner and a line', (tester) async {
      await pumpHost(tester, const MidtermWaitingScreen(title: 'Continuing to Module 2', message: 'Math'));
      expect(find.text('Continuing to Module 2'), findsOneWidget);
      expect(find.text('Math'), findsOneWidget);
      await pumpHost(tester, const MidtermWaitingScreen(message: 'Opening your midterm…'));
      expect(find.text('Opening your midterm…'), findsOneWidget);
    });

    testWidgets('done: scoring, could not load, awaiting release, released score', (tester) async {
      var homes = 0;
      var reports = 0;
      Future<void> show(MidtermResult? r, {bool failed = false}) => pumpHost(
            tester,
            MidtermDoneScreen(result: r, failed: failed, onHome: () => homes++, onOpenReport: () => reports++),
          );
      await show(null);
      expect(find.text("You're all finished!"), findsOneWidget);
      expect(find.text('Scoring your answers…'), findsOneWidget);
      expect(find.text('Open the full report'), findsNothing);
      await show(null, failed: true);
      expect(find.text(MidtermCopy.resultFailed), findsOneWidget);
      await show(const MidtermResult(attemptId: 1, state: AttemptState.completed, released: false));
      expect(find.text(MidtermCopy.awaitingRelease), findsOneWidget);
      await show(const MidtermResult(
        attemptId: 1,
        state: AttemptState.completed,
        released: true,
        totalScore: 680,
        scoreCeiling: 800,
      ));
      expect(find.text('YOUR SCORE'), findsOneWidget);
      expect(find.text('680 / 800', findRichText: true), findsOneWidget);
      await tester.tap(find.text('Open the full report'));
      await tester.tap(find.text('Back to my tests'));
      expect((reports, homes), (1, 1));
    });
  });

  group('copy helpers', () {
    test('chances and pass marks', () {
      expect(offscreenChancesLabel(1), '2 chances left');
      expect(offscreenChancesLabel(2), '1 chance left');
      expect(offscreenChancesLabel(3), 'no chances left');
      expect(offscreenChancesLabel(9), 'no chances left');
      expect(offscreenChancesPill(0), 'No chances left');
      expect(midtermPassMarkLabel('SCALE_800'), '500 out of 800');
      expect(midtermPassMarkLabel('SCALE_100'), '50 out of 100');
      expect(midtermPassMarkLabel('SCALE_800', 560), '560 out of 800');
      expect(MidtermCopy.prohibitedLeaving(grace: 5, limit: 4),
          'Leaving full screen or switching to another window. You get 5 seconds to come back, and only 3 warnings — '
          'the 4th time, your paper is submitted immediately.');
    });
  });
}

class _FlakyPrecheck extends FakeNativeBridge {
  bool broken = true;

  @override
  PrecheckReport precheck() {
    if (broken) throw const NativeBridgeException(NativeStatus.errOs, 'ms_precheck_json');
    return super.precheck();
  }
}
