// The midterm flow end to end, on a real MidtermEngine against the fixture server and the fake
// native bridge, driven through the widgets the student would use.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/features/midterm/midterm_flow.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import 'support/midterm_rig.dart';

/// A stand-in for runner-ui's ExamRunner: shows what it was given.
Widget fakeRunner(BuildContext context, MidtermRunnerSlots slots) {
  final s = slots.session;
  return ColoredBox(
    color: const Color(0xFFFFFFFF),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [Expanded(child: Text('RUNNER module ${s.moduleId}')), slots.headerExtra]),
        slots.banner,
        Expanded(child: Text('${s.questions.length} questions')),
      ],
    ),
  );
}

class Shell {
  Shell(this.tester) : rig = FlowRig(tester);

  final WidgetTester tester;
  final FlowRig rig;
  late MidtermFlowController controller;
  int exits = 0;

  Future<void> mount({Duration forfeitHold = const Duration(seconds: 6)}) async {
    controller = rig.controller(forfeitHold: forfeitHold);
    await pumpHost(
      tester,
      MidtermFlow(
        controller: controller,
        native: rig.native,
        runnerBuilder: fakeRunner,
        onExit: () => exits++,
      ),
    );
    await settle();
  }

  /// Let replies land and the screen catch up (no pumpAndSettle: spinners never settle).
  Future<void> settle([Duration d = const Duration(milliseconds: 50)]) async {
    for (var i = 0; i < 5; i++) {
      await tester.pump(d);
    }
  }

  Future<void> tapText(String text) async {
    await tester.ensureVisible(find.text(text));
    await tester.pump();
    await tester.tap(find.text(text));
    await settle();
  }

  Future<void> throughRulesAndCode() async {
    expect(find.text("I'm ready — continue"), findsOneWidget);
    await tapText("I'm ready — continue");
    expect(find.text('Enter your access code'), findsOneWidget);
    await tester.enterText(find.byType(EditableText), fixtureMidtermCode);
    await settle();
    await tapText('Verify & begin');
    expect(find.text('Get this computer ready'), findsOneWidget);
  }

  Future<void> start() async {
    await mount();
    await throughRulesAndCode();
    await tapText('Lock and start');
    await settle(const Duration(milliseconds: 200));
    expect(find.text('RUNNER module ${M14.m1}'), findsOneWidget);
  }

  Future<void> done() => rig.dispose(tester);

  /// The `ms_keep_awake` requests the flow made, in order.
  List<String> get awake => [
        for (final c in rig.native.calls)
          if (c.startsWith('keepAwake')) c,
      ];

  /// Run the live module to 50 ms past its deadline and let the hand-in land.
  Future<void> runOutModule() async {
    final e = controller.engine;
    await tester.pump(e.moduleClock!.remainingAt(e.mono) + const Duration(milliseconds: 50));
    await tester.pump();
    await settle(const Duration(milliseconds: 400));
  }
}

/// A bridge whose `ms_keep_awake` fails (an odd machine): the wake lock is best-effort.
class _KeepAwakeFails extends ScriptedNativeBridge {
  int attempts = 0;

  @override
  void keepAwake(bool on) {
    attempts++;
    throw const NativeBridgeException(NativeStatus.errOs, 'ms_keep_awake', 'refused');
  }
}

void main() {
  testWidgets('rules → code → pre-check → Lock and start → the locked runner', (tester) async {
    final s = Shell(tester);
    await s.mount();
    expect(find.text('October Midterm · Math'), findsOneWidget);
    await s.throughRulesAndCode();
    expect(s.rig.native.locked, isFalse, reason: 'nothing locks before the student says so');
    await s.tapText('Lock and start');
    await s.settle(const Duration(milliseconds: 200));
    expect(find.text('RUNNER module ${M14.m1}'), findsOneWidget);
    expect(find.text('4 questions'), findsOneWidget);
    expect(s.rig.native.locked, isTrue);
    expect(find.text('87%'), findsOneWidget, reason: 'the battery reading is in the header slot');
    expect(s.controller.view, MidtermView.running);
    await s.done();
    expect(s.rig.native.locked, isFalse, reason: 'a lockdown never outlives the flow');
  });

  testWidgets('a wrong code stays on the code screen with the website wording', (tester) async {
    final s = Shell(tester);
    await s.mount();
    await s.tapText("I'm ready — continue");
    await tester.enterText(find.byType(EditableText), '000000');
    await s.settle();
    await s.tapText('Verify & begin');
    expect(find.text("That code isn't right. Ask your teacher for the current code."), findsOneWidget);
    await s.tapText('Back to rules');
    expect(find.text("I'm ready — continue"), findsOneWidget);
    await s.done();
  });

  testWidgets('Back from the pre-check releases the machine and returns to the rules', (tester) async {
    final s = Shell(tester);
    await s.mount();
    await s.throughRulesAndCode();
    // The lock goes through but the paper cannot be opened (offline): still locked, can retry.
    s.rig.api.offline = true;
    await s.tapText('Lock and start');
    await s.settle(const Duration(seconds: 2));
    expect(find.text('Get this computer ready'), findsOneWidget);
    expect(find.text("That didn't go through. Check your internet connection and try again."), findsOneWidget);
    await s.tapText('Back');
    expect(s.rig.native.locked, isFalse);
    expect(find.text("I'm ready — continue"), findsOneWidget);
    await s.done();
  });

  testWidgets('leaving the window: the warning with its countdown, then the note on return', (tester) async {
    final s = Shell(tester);
    await s.start();
    await tester.pump(const Duration(seconds: 2));
    s.rig.native.away = true;
    await s.settle(const Duration(milliseconds: 150));
    expect(find.text('Come back to your exam'), findsOneWidget);
    expect(find.text('seconds to return'), findsOneWidget);
    expect(find.text('2 chances left'), findsOneWidget);
    s.rig.native.away = false;
    await s.settle(const Duration(milliseconds: 150));
    expect(find.text('Come back to your exam'), findsNothing);
    expect(find.text('You left the exam window. That counted as a warning — 2 chances left.'), findsOneWidget);
    await s.tapText('Got it');
    expect(find.textContaining('You left the exam window'), findsNothing);
    expect(find.text('RUNNER module ${M14.m1}'), findsOneWidget);
    await s.done();
  });

  testWidgets('the third absence ends the sitting: the explanation, then the result', (tester) async {
    final s = Shell(tester);
    await s.start();
    await tester.pump(const Duration(seconds: 2));
    s.rig.native.away = true;
    for (var i = 0; i < 40; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(find.text('Your exam was submitted'), findsOneWidget);
    expect(s.rig.native.locked, isFalse, reason: 'released at once');
    s.rig.native.away = false;
    await tester.pump(const Duration(seconds: 6));
    await s.settle(const Duration(milliseconds: 500));
    expect(find.text("You're all finished!"), findsOneWidget);
    await s.settle(const Duration(seconds: 2));
    expect(find.text('YOUR SCORE'), findsOneWidget, reason: 'the fixture releases midterm results at once');
    expect(find.textContaining('/ 800', findRichText: true), findsOneWidget);
    await s.tapText('Back to my tests');
    expect(s.exits, 1);
    await s.done();
  });

  testWidgets('"See your result" skips the wait on the forfeit screen', (tester) async {
    final s = Shell(tester);
    await s.start();
    await tester.pump(const Duration(seconds: 2));
    s.rig.native.away = true;
    for (var i = 0; i < 40; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    s.rig.native.away = false;
    await s.tapText('See your result');
    expect(find.text("You're all finished!"), findsOneWidget);
    await s.done();
  });

  testWidgets('module end: "Continuing to Module 2", then the runner on module 2', (tester) async {
    final s = Shell(tester);
    await s.start();
    final e = s.controller.engine;
    // To 50 ms past the server deadline: 0:00 locks the paper; the hand-in goes at + 750 ms.
    await tester.pump(e.moduleClock!.remainingAt(e.mono) + const Duration(milliseconds: 50));
    await tester.pump();
    expect(find.text('Continuing to Module 2'), findsOneWidget);
    expect(find.text('Math'), findsOneWidget);
    await s.settle(const Duration(milliseconds: 400));
    expect(find.text('RUNNER module ${M14.m2}'), findsOneWidget);
    await s.done();
  });

  testWidgets('another window took the sitting: "opened in another window", released', (tester) async {
    final s = Shell(tester);
    await s.start();
    final api = s.rig.api;
    late LockdownChallenge ch;
    await tester.runAsync(() async => ch = await api.midtermChallenge(M14.attempt));
    await tester.runAsync(() => api.midtermSession(
        M14.attempt, LockdownSessionRequest(nonce: ch.nonce, keyId: 'k', mac: 'm', appVersion: '0.2.0', precheck: '{}')));
    await tester.pump(const Duration(seconds: 16)); // the next heartbeat sync is refused
    await s.settle();
    expect(find.text('This midterm was opened in another window'), findsOneWidget);
    expect(s.rig.native.locked, isFalse);
    await s.tapText('Back to my tests');
    expect(s.exits, 1);
    await s.done();
  });

  testWidgets('a lost lock covers the paper with "Resume your midterm"; Lock and resume brings it back',
      (tester) async {
    final s = Shell(tester);
    await s.start();
    s.rig.native
      ..watchdogReleased = true
      ..failLockEnter = true;
    await tester.pump(const Duration(milliseconds: 3100));
    await s.settle();
    expect(find.text('Resume your midterm'), findsOneWidget);
    expect(find.textContaining('RUNNER'), findsNothing, reason: 'never a running paper unlocked');
    s.rig.native.failLockEnter = false;
    await s.tapText('Lock and resume');
    expect(find.text('RUNNER module ${M14.m1}'), findsOneWidget);
    expect(s.rig.native.locked, isTrue);
    await s.done();
  });

  testWidgets('reopening the app mid-sitting goes straight to "Resume your midterm"', (tester) async {
    final s = Shell(tester);
    await s.start();
    // The first window goes away (a crash); a new one opens the same sitting.
    await tester.pumpWidget(const SizedBox());
    s.controller.dispose();
    s.rig.native.lockExit();
    await s.mount();
    expect(find.text('Resume your midterm'), findsOneWidget);
    expect(find.text("I'm ready — continue"), findsNothing, reason: 'no rules again for a running paper');
    await s.tapText('Lock and resume');
    await s.settle(const Duration(milliseconds: 200));
    expect(find.text('RUNNER module ${M14.m1}'), findsOneWidget);
    await s.done();
  });

  testWidgets('no connection at open: an error with Try again, which then works', (tester) async {
    final s = Shell(tester);
    s.rig.api.offline = true;
    await s.mount();
    expect(find.text('This midterm couldn’t be opened'), findsOneWidget);
    s.rig.api.offline = false;
    await s.tapText('Try again');
    expect(find.text("I'm ready — continue"), findsOneWidget);
    await s.tapText("I'm ready — continue");
    expect(find.text('Enter your access code'), findsOneWidget);
    await s.done();
  });

  testWidgets('a build below the minimum gets the update screen', (tester) async {
    final s = Shell(tester);
    s.rig.api.failNext(const UpdateRequired(updateUrl: 'https://mastersat.uz/downloads/desktop/'));
    await s.mount();
    expect(find.text('Update the MasterSAT app'), findsOneWidget);
    await s.tapText('Back to my tests');
    expect(s.exits, 1);
    await s.done();
  });

  testWidgets('a write the server refuses for good is said plainly above the paper', (tester) async {
    final s = Shell(tester);
    await s.start();
    s.rig.api.failNext(const ApiError(status: 400, body: ApiErrorBody(code: 'invalid', detail: 'bad payload')));
    await tester.pump(const Duration(seconds: 16)); // the heartbeat sync is refused
    await s.settle();
    expect(
      find.text("The server couldn't accept part of your work. Ask your teacher — it's saved on this computer."),
      findsOneWidget,
    );
    expect(find.text('RUNNER module ${M14.m1}'), findsOneWidget, reason: 'the student keeps working');
    await s.done();
  });

  testWidgets('offline mid-paper: the reconnecting banner; low battery: the battery banner', (tester) async {
    final s = Shell(tester);
    await s.start();
    s.rig.native.batteryStatus = const BatteryStatus(percent: 18, charging: false, hasBattery: true);
    s.rig.api.offline = true;
    await tester.pump(const Duration(seconds: 31));
    await s.settle();
    expect(find.text('Your battery is low (18%). Plug in your device.'), findsOneWidget);
    expect(find.textContaining('Reconnecting…'), findsOneWidget);
    expect(find.text('18%'), findsOneWidget);
    s.rig.api.offline = false;
    await tester.pump(const Duration(seconds: 16));
    await s.settle();
    expect(find.textContaining('Reconnecting…'), findsNothing);
    expect(s.controller.engine.phase, ExamPhase.running);
    await s.done();
  });

  // ---- screen wake lock (2026-10-11, the learning center's request) ----------------------------
  // useScreenWakeLock(isMidterm && !isTerminal(attempt)) on the website, MidtermScreen.tsx in
  // 0.1.0: a display that sleeps and locks reads as leaving the paper, so the display stays
  // awake for the WHOLE midterm — rules, code, pre-check and the paper — until it is in.

  testWidgets('wake lock: on from the rules through the paper, off once it is handed in', (tester) async {
    final s = Shell(tester);
    await s.mount();
    expect(find.text("I'm ready — continue"), findsOneWidget);
    expect(s.awake, ['keepAwake true'], reason: 'the rules screen already keeps the display on');
    await s.throughRulesAndCode();
    expect(s.awake, ['keepAwake true'], reason: 'code and pre-check: still on, asked once');
    await s.tapText('Lock and start');
    await s.settle(const Duration(milliseconds: 200));
    expect(find.text('RUNNER module ${M14.m1}'), findsOneWidget);
    expect(s.awake, ['keepAwake true'], reason: 'the lock does not toggle it');

    await s.runOutModule();
    expect(find.text('RUNNER module ${M14.m2}'), findsOneWidget);
    expect(s.awake, ['keepAwake true'], reason: 'between modules: still on');

    await s.runOutModule();
    await s.settle(const Duration(seconds: 1));
    expect(find.text("You're all finished!"), findsOneWidget);
    expect(s.rig.native.locked, isFalse);
    expect(s.awake, ['keepAwake true', 'keepAwake false'], reason: 'the paper is in: the display may sleep');
    expect(s.rig.native.keptAwake, isFalse);

    await s.tapText('Back to my tests');
    expect(s.exits, 1);
    await s.done();
    expect(s.awake, ['keepAwake true', 'keepAwake false'], reason: 'nothing more to undo');
  });

  testWidgets('wake lock: a forfeit lets go at once, before the explanation moves on', (tester) async {
    final s = Shell(tester);
    await s.start();
    await tester.pump(const Duration(seconds: 2));
    s.rig.native.away = true;
    for (var i = 0; i < 40; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(find.text('Your exam was submitted'), findsOneWidget);
    expect(s.awake, ['keepAwake true', 'keepAwake false']);
    s.rig.native.away = false;
    await s.done();
  });

  testWidgets('wake lock: leaving mid-paper (the flow goes away) lets go', (tester) async {
    final s = Shell(tester);
    await s.start();
    expect(s.awake, ['keepAwake true']);
    await tester.pumpWidget(const SizedBox());
    expect(s.awake, ['keepAwake true', 'keepAwake false']);
    await s.done();
  });

  testWidgets('wake lock: Back to my tests from an error screen lets go', (tester) async {
    final s = Shell(tester);
    s.rig.api.offline = true;
    await s.mount();
    expect(find.text('This midterm couldn’t be opened'), findsOneWidget);
    expect(s.awake, ['keepAwake true'], reason: 'the midterm has started: the student is still in it');
    await s.tapText('Back to my tests');
    expect(s.exits, 1);
    expect(s.awake, ['keepAwake true', 'keepAwake false']);
    await s.done();
    expect(s.awake, ['keepAwake true', 'keepAwake false']);
  });

  testWidgets('wake lock: a lost lock and the re-lock leave it to the native library', (tester) async {
    // lock.rs remembers the request and re-asserts it after every release (Lock exit and the
    // watchdog alike), so the flow asks once and never has to ask again.
    final s = Shell(tester);
    await s.start();
    s.rig.native
      ..watchdogReleased = true
      ..failLockEnter = true;
    await tester.pump(const Duration(milliseconds: 3100));
    await s.settle();
    expect(find.text('Resume your midterm'), findsOneWidget);
    s.rig.native.failLockEnter = false;
    await s.tapText('Lock and resume');
    expect(find.text('RUNNER module ${M14.m1}'), findsOneWidget);
    expect(s.awake, ['keepAwake true']);
    expect(s.controller.keepScreenAwake, isTrue);
    await s.done();
  });

  testWidgets('wake lock: reopening the app mid-sitting asks again for the new window', (tester) async {
    final s = Shell(tester);
    await s.start();
    await tester.pumpWidget(const SizedBox());
    s.controller.dispose();
    s.rig.native.lockExit();
    s.rig.native.calls.clear();
    await s.mount();
    expect(find.text('Resume your midterm'), findsOneWidget);
    expect(s.awake, ['keepAwake true']);
    await s.done();
  });

  testWidgets('wake lock: a machine that refuses it still sits the midterm', (tester) async {
    final rig = FlowRig(tester);
    final native = _KeepAwakeFails();
    final controller = rig.controller();
    await pumpHost(
      tester,
      MidtermFlow(controller: controller, native: native, runnerBuilder: fakeRunner, onExit: () {}),
    );
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(tester.takeException(), isNull);
    expect(native.attempts, 1);
    expect(find.text("I'm ready — continue"), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    expect(tester.takeException(), isNull);
    expect(native.attempts, 2, reason: 'it still tries to let go');
    await rig.dispose(tester);
  });
}
