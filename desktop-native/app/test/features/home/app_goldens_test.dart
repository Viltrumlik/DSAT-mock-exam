// Goldens of every non-exam screen and state at 1280×820 (the design's desktop window), drawn
// with the app's bundled faces — Geist and Plus Jakarta Sans, the files the app ships — and the
// icon font (test/core/harness/fonts.dart).
//
//   flutter test test/features/home/app_goldens_test.dart                  compare
//   flutter test test/features/home/app_goldens_test.dart --update-goldens record
//
// Recorded on macOS at UTC+5; skipped elsewhere (see goldenSkipReason).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/store/user_store.dart';
import 'package:mastersat_app/features/shell/shell_page.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import '../../core/harness/app_harness.dart';
import '../../core/harness/fonts.dart';

/// A fixture API whose midterm 10 re-sit attempt (4411) is submitted but not released yet.
class _AwaitingReleaseApi extends FixtureV1Api {
  _AwaitingReleaseApi({super.now});

  @override
  Future<MidtermResult> midtermResult(int attemptId) async {
    if (attemptId != 4411) return super.midtermResult(attemptId);
    final json = FixtureV1Api.fixture('midterm_result.response.awaiting_release.json')..['attempt_id'] = 4411;
    return MidtermResult.fromJson(JsonReader.of(json));
  }
}

Future<void> golden(WidgetTester tester, String name) async {
  await settleApp(tester);
  // Images (the logo) decode for real, outside the fake clock.
  await tester.runAsync(() async {
    for (final element in find.byType(Image).evaluate()) {
      await precacheImage((element.widget as Image).image, element);
    }
  });
  await tester.pump();
  await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/$name.png'));
}

/// A golden test with real (blurred) shadows, so the image looks like the app — the binding's
/// default draws every shadow as a solid block. Set before the first paint, reset before the
/// test ends (the binding checks it), as the runner's and the midterm goldens do.
void _goldenTest(String name, Future<void> Function(WidgetTester tester) body) => testWidgets(name, (tester) async {
      debugDisableShadows = false;
      try {
        await body(tester);
      } finally {
        debugDisableShadows = true;
      }
    }, skip: !goldensSupported);

/// The open page's own scroll view (not the sidebar's list).
Finder _pageScroll() => find.descendant(of: find.byType(ShellPage), matching: find.byType(Scrollable)).first;

ApiConfig get _productionConfig => ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0');

void main() {

  _goldenTest('sign-in', (tester) async {
    final h = await AppHarness.start(signedIn: false, config: _productionConfig);
    await h.pump(tester);
    await golden(tester, 'signin');
    await h.dispose(tester);
  });

  _goldenTest('sign-in, a wrong password', (tester) async {
    final h = await AppHarness.start(signedIn: false, config: _productionConfig);
    await h.pump(tester);
    await tester.enterText(find.byType(TextField).first, 'aziza.karimova');
    await tester.enterText(find.byType(TextField).last, FixtureV1Api.wrongPassword);
    await tester.pump(); // the button enables once both fields have text
    await tester.tap(find.text('Sign in'));
    await golden(tester, 'signin_invalid');
    await h.dispose(tester);
  });

  _goldenTest('sign-in, offline', (tester) async {
    final h = await AppHarness.start(signedIn: false, config: _productionConfig);
    await h.pump(tester);
    h.api.offline = true;
    await tester.enterText(find.byType(TextField).first, 'aziza.karimova');
    await tester.enterText(find.byType(TextField).last, 'fixture-password');
    await tester.pump(); // the button enables once both fields have text
    await tester.tap(find.text('Sign in'));
    await golden(tester, 'signin_offline');
    await h.dispose(tester);
  });

  _goldenTest('midterms (the landing page: a midterm is open now)', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await golden(tester, 'midterms');
    await h.dispose(tester);
  });

  _goldenTest('midterms, scrolled to the past attempts', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await tester.drag(_pageScroll(), const Offset(0, -400));
    await golden(tester, 'midterms_lower');
    await h.dispose(tester);
  });

  _goldenTest('midterms, a narrow window (the sidebar is an icon rail)', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester, size: const Size(980, 720));
    await golden(tester, 'midterms_rail');
    await h.dispose(tester);
  });

  _goldenTest('past papers', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await openPage(tester, 'Past papers');
    await golden(tester, 'past_papers');
    await h.dispose(tester);
  });

  _goldenTest('past papers, the library', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await openPage(tester, 'Past papers');
    await tester.scrollUntilVisible(find.text('OCTOBER 2025'), 300, scrollable: _pageScroll());
    await tester.drag(_pageScroll(), const Offset(0, 120));
    await golden(tester, 'past_papers_library');
    await h.dispose(tester);
  });

  _goldenTest('past papers, filtered to nothing', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await openPage(tester, 'Past papers');
    await tester.enterText(find.byType(TextField), 'no such paper');
    await settleApp(tester);
    await tester.scrollUntilVisible(find.text('No matching papers'), 300, scrollable: _pageScroll());
    await golden(tester, 'past_papers_empty');
    await h.dispose(tester);
  });

  _goldenTest('the account menu', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await tester.tap(find.bySemanticsLabel('Your account'));
    await golden(tester, 'account_menu');
    await h.dispose(tester);
  });

  _goldenTest('home, offline with the cached copy', (tester) async {
    final store = await UserStore.memory(77);
    await store.homeCache.write(fixtureHome(), '"e"', DateTime.utc(2026, 10, 11, 8, 42));
    final h = await AppHarness.start(openStore: (_) async => store);
    h.api.offline = true;
    await h.pump(tester);
    await golden(tester, 'home_offline');
    await h.dispose(tester);
  });

  _goldenTest('home, offline with nothing cached', (tester) async {
    final h = await AppHarness.start();
    h.api.offline = true;
    await h.pump(tester);
    await golden(tester, 'home_offline_empty');
    await h.dispose(tester);
  });

  _goldenTest('home, update ready', (tester) async {
    final h = await AppHarness.start();
    h.native.update = const UpdateInfo(available: true, version: '0.3.0');
    await h.pump(tester);
    await golden(tester, 'home_update_ready');
    await h.dispose(tester);
  });

  _goldenTest('update required', (tester) async {
    final h = await AppHarness.start();
    h.api.failNext(const UpdateRequired(
        minimumVersion: '0.3.0', updateUrl: 'https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe'));
    await h.pump(tester);
    await golden(tester, 'update_required');
    await h.dispose(tester);
  });

  _goldenTest('history dialog', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await openPage(tester, 'Past papers');
    final link = find.text('History · 2 attempts');
    await tester.ensureVisible(link);
    await tester.tap(link);
    await golden(tester, 'history_dialog');
    await h.dispose(tester);
  });

  _goldenTest('sign-out blocked by unsent answers', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    h.services.unsentWork.register('exam outbox', () => 3);
    await tester.tap(find.text('Sign out'));
    await golden(tester, 'signout_unsent');
    await h.dispose(tester);
  });

  _goldenTest('past-paper result', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    final paper = h.services.home.home!.pastpapers.firstWhere((p) => p.id == 43);
    unawaited(openPastpaperResult(h.services.navigatorKey.currentContext!, attemptId: 8801, paper: paper));
    await golden(tester, 'result_pastpaper');
    await tester.drag(_pageScroll(), const Offset(0, -600));
    await golden(tester, 'result_pastpaper_lower');
    await h.dispose(tester);
  });

  _goldenTest('past-paper result, offline', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    h.api.failNext(const NetworkError('x'));
    unawaited(openPastpaperResult(h.services.navigatorKey.currentContext!, attemptId: 8801));
    await golden(tester, 'result_pastpaper_offline');
    await h.dispose(tester);
  });

  _goldenTest('midterm result, released', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    final row = h.services.home.home!.midterms.firstWhere((m) => m.midtermId == 9);
    unawaited(openMidtermResult(h.services.navigatorKey.currentContext!, row: row));
    await golden(tester, 'result_midterm');
    await h.dispose(tester);
  });

  _goldenTest('midterm result, awaiting release', (tester) async {
    final h = await AppHarness.start(api: _AwaitingReleaseApi(now: () => fixtureNow));
    await h.pump(tester);
    final row = h.services.home.home!.midterms.firstWhere((m) => m.midtermId == 10);
    unawaited(openMidtermResult(h.services.navigatorKey.currentContext!, row: row));
    await golden(tester, 'result_midterm_awaiting');
    await h.dispose(tester);
  });

  _goldenTest('settings', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    unawaited(openSettings(h.services.navigatorKey.currentContext!));
    await golden(tester, 'settings');
    await h.dispose(tester);
  });

  _goldenTest('settings, a toast after Copy diagnostics', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    unawaited(openSettings(h.services.navigatorKey.currentContext!));
    await settleApp(tester);
    await tester.tap(find.text('Copy diagnostics'));
    await golden(tester, 'settings_toast');
    await h.dispose(tester);
  });

  _goldenTest('settings, delete confirmation', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    unawaited(openSettings(h.services.navigatorKey.currentContext!));
    await settleApp(tester);
    await tester.ensureVisible(find.text('Delete data on this computer'));
    await tester.tap(find.text('Delete data on this computer'));
    await golden(tester, 'settings_delete_confirm');
    await h.dispose(tester);
  });

  _goldenTest('settings, delete blocked', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    h.services.unsentWork.register('exam outbox', () => 2);
    unawaited(openSettings(h.services.navigatorKey.currentContext!));
    await settleApp(tester);
    await tester.ensureVisible(find.text('Delete data on this computer'));
    await tester.tap(find.text('Delete data on this computer'));
    await golden(tester, 'settings_delete_blocked');
    await h.dispose(tester);
  });
}
