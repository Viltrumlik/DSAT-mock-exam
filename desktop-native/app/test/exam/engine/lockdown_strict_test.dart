// The strict lock (0.3.0): a midterm is one window, one app. The controller asks the DLL for
// MS_LOCK_STRICT (and again on its silent re-lock), the strict pre-check also refuses any other
// app with a window, and while a strict lock is held the app knows it (app.dart then refuses a
// polite close). A past paper keeps the plain lock.
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/exam/engine/lockdown_controller.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import 'support/engine_harness.dart';

const chrome = BlockedApp(exe: 'chrome.exe', name: 'Google Chrome', closable: true);

void main() {
  test('a strict controller locks strictly, re-locks strictly, and is known app-wide while held', () {
    final native = FakeNativeBridge();
    final lock = LockdownController(native: native, strict: true);
    expect(LockdownController.strictEngaged, isFalse);
    lock.enter();
    expect(native.lastLockStrict, isTrue);
    expect(LockdownController.strictEngaged, isTrue);
    native.lastLockStrict = null;
    native.watchdogReleased = true;
    expect(lock.beat(), isTrue);
    expect(native.lastLockStrict, isTrue, reason: 'the silent re-lock after a watchdog release is strict too');
    lock.exit();
    expect(LockdownController.strictEngaged, isFalse);
    lock.dispose();
  });

  test('another app with a window refuses only the strict lock; a lost strict lock is not held', () {
    final native = FakeNativeBridge()..windowApps = [chrome];
    final plain = LockdownController(native: native);
    plain.enter(); // a past paper does not look at other windows
    expect(native.lastLockStrict, isFalse);
    expect(LockdownController.strictEngaged, isFalse, reason: 'a plain lock is not the strict one');
    plain.dispose();

    final strict = LockdownController(native: native, strict: true);
    expect(
      strict.enter,
      throwsA(isA<PrecheckFailed>().having((e) => e.report.apps.single.name, 'listed app', 'Google Chrome')),
    );
    expect(LockdownController.strictEngaged, isFalse);
    native.windowApps.clear();
    strict.enter();
    // The watchdog let go and meanwhile Chrome opened again: the strict re-lock fails.
    native.windowApps = [chrome];
    native.watchdogReleased = true;
    expect(strict.beat(), isFalse);
    expect(strict.lost, isTrue);
    expect(LockdownController.strictEngaged, isFalse);
    strict.dispose();
  });

  test('a midterm engine owns a strict lock; a past paper engine a plain one', () {
    withHarness((h) {
      final midterm = h.midterm();
      final pastpaper = h.pastpaper();
      expect(midterm.lockdown.strict, isTrue);
      expect(pastpaper.lockdown.strict, isFalse);
      midterm.dispose();
      pastpaper.dispose();
    });
  });
}
