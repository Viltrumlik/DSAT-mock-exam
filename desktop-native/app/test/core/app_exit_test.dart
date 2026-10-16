// Closing the window: a midterm's strict lock keeps it open (one window, one app — Alt+F4 is
// swallowed natively, this is the taskbar's or Task Manager's polite close); any other time the
// app closes as before.
import 'dart:ui' show AppExitResponse;

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/exam/engine/lockdown_controller.dart';

import 'harness/app_harness.dart';

void main() {
  testWidgets("a midterm's strict lock refuses a close; unlocked or plain-locked, the app closes", (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    expect(await tester.binding.handleRequestAppExit(), AppExitResponse.exit);

    final plain = LockdownController(native: h.native)..enter();
    expect(await tester.binding.handleRequestAppExit(), AppExitResponse.exit, reason: 'a past paper may close');
    plain.dispose();

    final strict = LockdownController(native: h.native, strict: true)..enter();
    expect(await tester.binding.handleRequestAppExit(), AppExitResponse.cancel);
    strict.dispose();
    expect(await tester.binding.handleRequestAppExit(), AppExitResponse.exit);
    await h.dispose(tester);
  });
}
