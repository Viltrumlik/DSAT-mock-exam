// "Every button does something" (architecture §10 Phase 1 exit): on every screen and dialog
// outside the exam, press each enabled control in turn — on a fresh app each time — and check
// that the world changed: a route, a dialog, the auth state, the library filters, the text on
// screen, or an outside effect (exam launched, URL opened, clipboard, Save dialog, native or
// API call). A control that is already the selected option is skipped (choosing it again is
// meant to do nothing). Every control must also carry an accessible label.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/store/user_store.dart';
import 'package:mastersat_app/core/theme/controls.dart';
import 'package:mastersat_app/features/home/app_header.dart';
import 'package:mastersat_app/features/home/update_card.dart';
import 'package:mastersat_app/features/library/history_dialog.dart';
import 'package:mastersat_app/features/library/pastpaper_model.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import '../../core/harness/app_harness.dart';

/// Builds the app and brings one screen (or dialog) up; returns the area to sweep.
typedef Scenario = Future<Finder> Function(WidgetTester tester, AppHarness h);

final Map<String, (Future<AppHarness> Function(), Scenario)> scenarios = {
  'Home': (AppHarness.start, (tester, h) async => find.byType(Scaffold)),
  'Home, offline with a cached copy': (
    () async {
      final store = await UserStore.memory(77);
      await store.homeCache.write(fixtureHome(), '"e"', fixtureNow);
      final h = await AppHarness.start(openStore: (_) async => store);
      h.api.offline = true;
      return h;
    },
    (tester, h) async => find.byType(Scaffold),
  ),
  'Home, an update downloaded': (
    () async {
      final h = await AppHarness.start();
      h.native.update = const UpdateInfo(available: true, version: '0.3.0');
      return h;
    },
    (tester, h) async => find.byType(Scaffold),
  ),
  'Update required card': (
    () async {
      final h = await AppHarness.start();
      h.api.failNext(const UpdateRequired(minimumVersion: '0.3.0', updateUrl: 'https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe'));
      return h;
    },
    (tester, h) async => find.byType(UpdateRequiredCard),
  ),
  'History dialog': (
    AppHarness.start,
    (tester, h) async {
      final link = find.text('History · 2 attempts');
      await tester.ensureVisible(link);
      await tester.tap(link);
      await settleApp(tester);
      return find.byType(HistoryDialog);
    },
  ),
  'Sign-out dialog (answers unsent)': (
    () async {
      final h = await AppHarness.start();
      h.services.unsentWork.register('exam outbox', () => 1);
      return h;
    },
    (tester, h) async {
      await tester.tap(find.text('Sign out'));
      await settleApp(tester);
      return find.byType(UnsentWorkDialog);
    },
  ),
  'Settings': (
    AppHarness.start,
    (tester, h) async {
      unawaited(openSettings(h.services.navigatorKey.currentContext!));
      await settleApp(tester);
      return find.byType(Scaffold).last;
    },
  ),
  'Delete-data confirmation': (
    AppHarness.start,
    (tester, h) async {
      unawaited(openSettings(h.services.navigatorKey.currentContext!));
      await settleApp(tester);
      await tester.ensureVisible(find.text('Delete data on this computer'));
      await tester.tap(find.text('Delete data on this computer'));
      await settleApp(tester);
      return find.byType(AppDialog);
    },
  ),
  'Past-paper result': (
    AppHarness.start,
    (tester, h) async {
      final paper = h.services.home.home!.pastpapers.firstWhere((p) => p.id == 43);
      unawaited(openPastpaperResult(h.services.navigatorKey.currentContext!, attemptId: 8801, paper: paper));
      await settleApp(tester);
      return find.byType(Scaffold).last;
    },
  ),
  'Past-paper result, offline': (
    AppHarness.start,
    (tester, h) async {
      h.api.offline = true;
      unawaited(openPastpaperResult(h.services.navigatorKey.currentContext!, attemptId: 8801));
      await settleApp(tester);
      return find.byType(Scaffold).last;
    },
  ),
  'Midterm result': (
    AppHarness.start,
    (tester, h) async {
      final row = h.services.home.home!.midterms.firstWhere((m) => m.midtermId == 9);
      unawaited(openMidtermResult(h.services.navigatorKey.currentContext!, row: row));
      await settleApp(tester);
      return find.byType(Scaffold).last;
    },
  ),
  'Exam placeholder': (
    AppHarness.start,
    (tester, h) async {
      final row = h.services.home.home!.pastpapers.first;
      unawaited(placeholderExamLauncher(
          h.services.navigatorKey.currentContext!, PastpaperExamRequest(paper: row, action: PaperAction.start)));
      await settleApp(tester);
      return find.byType(ExamPlaceholderScreen);
    },
  ),
  'Sign-in': (
    () => AppHarness.start(signedIn: false, config: ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0')),
    (tester, h) async => find.byType(Scaffold),
  ),
  'Sign-in, filled in': (
    () => AppHarness.start(signedIn: false, config: ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0')),
    (tester, h) async {
      await _fillSignIn(tester);
      return find.byType(Scaffold);
    },
  ),
  'Sign-in, offline': (
    () => AppHarness.start(signedIn: false, config: ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0')),
    (tester, h) async {
      await _fillSignIn(tester);
      h.api.offline = true;
      await tester.tap(find.text('Sign in'));
      await settleApp(tester);
      h.api.offline = false;
      return find.byType(Scaffold);
    },
  ),
};

Future<void> _fillSignIn(WidgetTester tester) async {
  await tester.enterText(find.byType(TextField).first, 'aziza');
  await tester.enterText(find.byType(TextField).last, 'fixture-password');
  await settleApp(tester);
}

/// Everything a press could change.
String fingerprint(WidgetTester tester, AppHarness h) {
  final texts = find.byType(Text).evaluate().map((e) => (e.widget as Text).data ?? '').join('|');
  final routes = <String>[];
  h.services.navigatorKey.currentState?.popUntil((r) {
    routes.add('${r.settings.name}:${r.runtimeType}');
    return true;
  });
  final focus = FocusManager.instance.primaryFocus?.debugLabel ?? '';
  return [
    routes.join(','),
    h.services.auth.status.name,
    h.services.library.filters.toJson().toString() + h.services.library.filters.query,
    h.launched.length,
    h.openedUrls.length,
    h.clipboard.length,
    h.savePrompts.length,
    h.savedFiles.length,
    h.native.calls.length,
    h.native.applied,
    h.api.calls.length,
    find.byType(AppDialog).evaluate().length,
    find.byType(HistoryDialog).evaluate().length,
    // A password shown or hidden.
    find.byType(EditableText).evaluate().map((e) => (e.widget as EditableText).obscureText).join(','),
    focus,
    texts,
  ].join('\n');
}

List<Pressable> pressablesIn(Finder area) => find
    .descendant(of: area, matching: find.byType(Pressable))
    .evaluate()
    .map((e) => e.widget as Pressable)
    .where((p) => p.onPressed != null && !p.selected)
    .toList();

void main() {
  for (final entry in scenarios.entries) {
    testWidgets('every control on "${entry.key}" does something', (tester) async {
      final (make, open) = entry.value;

      // Inventory.
      var h = await make();
      await h.pump(tester);
      var area = await open(tester, h);
      final labels = [for (final p in pressablesIn(area)) p.semanticLabel ?? ''];
      expect(labels, isNotEmpty, reason: 'nothing to press on ${entry.key}?');
      expect(labels.where((l) => l.trim().isEmpty), isEmpty, reason: 'every control has an accessible label');
      await h.dispose(tester);

      final dead = <String>[];
      final seen = <String, int>{};
      for (final label in labels) {
        final nth = seen[label] = (seen[label] ?? -1) + 1;
        h = await make();
        await h.pump(tester);
        area = await open(tester, h);
        final matches = find.descendant(
          of: area,
          matching: find.byWidgetPredicate((w) => w is Pressable && w.semanticLabel == label && w.onPressed != null && !w.selected),
        );
        final target = matches.at(nth);
        await tester.ensureVisible(target);
        await settleApp(tester);
        final before = fingerprint(tester, h);
        await tester.tap(target, warnIfMissed: false);
        await settleApp(tester);
        if (fingerprint(tester, h) == before) dead.add('$label #$nth');
        await h.dispose(tester);
      }
      expect(dead, isEmpty, reason: 'controls that did nothing on ${entry.key}');
    });
  }
}
