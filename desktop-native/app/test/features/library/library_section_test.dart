// The library on Home: chips with counts, search (Ctrl+F focuses, Esc clears), Clear
// filters, the empty state, filters saved per student, and every card action.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/store/settings_store.dart';
import 'package:mastersat_app/core/store/user_store.dart';
import 'package:mastersat_app/features/library/booklet_card.dart';
import 'package:mastersat_app/features/library/history_dialog.dart';
import 'package:mastersat_app/features/library/pastpaper_model.dart';
import 'package:mastersat_app/features/results/pastpaper_result_screen.dart';

import '../../core/harness/app_harness.dart';

Finder _segment(String label) => find.byWidgetPredicate(
    (w) => w is Semantics && w.properties.label == label && (w.properties.button ?? false));

List<int> _shownPaperIds(WidgetTester tester) =>
    tester.widgetList<BookletCard>(find.byType(BookletCard)).map((c) => c.item.paper.id).toList();

Future<void> _scrollToLibrary(WidgetTester tester) async {
  await tester.scrollUntilVisible(find.text('Past papers'), 300, scrollable: find.byType(Scrollable).first);
  await settleApp(tester);
}

void main() {
  testWidgets('chips show counts and filter the cards; Clear filters resets everything', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await _scrollToLibrary(tester);

    expect(_segment('US 4'), findsOneWidget);
    expect(_segment('International 2'), findsOneWidget);
    expect(_segment('New 2'), findsOneWidget);
    expect(_segment('R&W 3'), findsOneWidget);
    expect(_shownPaperIds(tester), hasLength(6));

    await tester.tap(_segment('International 2'));
    await settleApp(tester);
    expect(_shownPaperIds(tester), unorderedEquals([43, 44]));
    expect(find.text('2 of 6 papers'), findsOneWidget);

    await tester.tap(_segment('Completed 1'));
    await settleApp(tester);
    expect(_shownPaperIds(tester), [43]);

    await tester.tap(find.text('Clear filters'));
    await settleApp(tester);
    expect(_shownPaperIds(tester), hasLength(6));
    expect(find.text('6 papers'), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('search ignores case and accents; Esc clears it; Ctrl+F focuses it', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    final field = find.byType(TextField);

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyF);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await settleApp(tester);
    expect(tester.widget<TextField>(field).focusNode!.hasFocus, isTrue);

    await tester.enterText(field, 'JÚNE');
    await settleApp(tester);
    expect(_shownPaperIds(tester), unorderedEquals([38, 37]));

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await settleApp(tester);
    expect(tester.widget<TextField>(field).controller!.text, isEmpty);
    expect(_shownPaperIds(tester), hasLength(6));
    await h.dispose(tester);
  });

  testWidgets('nothing matching shows "No matching papers" with its own Clear filters', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await tester.enterText(find.byType(TextField), 'zzz no such paper');
    await settleApp(tester);
    expect(find.text('No matching papers'), findsOneWidget);
    expect(find.byType(BookletCard), findsNothing);
    final clear = find.text('Clear filters').last;
    await tester.ensureVisible(clear);
    await tester.tap(clear);
    await settleApp(tester);
    expect(find.text('No matching papers'), findsNothing);
    expect(_shownPaperIds(tester), hasLength(6));
    await h.dispose(tester);
  });

  testWidgets('filter chips are saved for the student (not the search) and come back next time', (tester) async {
    final store = await UserStore.memory(77);
    final h = await AppHarness.start(openStore: (_) async => store);
    await h.pump(tester);
    await _scrollToLibrary(tester);
    await tester.tap(_segment('US 4'));
    await tester.enterText(find.byType(TextField), 'june');
    await settleApp(tester);
    expect(store.settings.readMap(SettingsKeys.libraryFilters),
        {'region': 'US', 'year': 'ALL', 'status': 'ALL', 'subject': 'ALL'});

    // A fresh library reading the same store.
    h.services.library.reset();
    h.services.library.attach(store.settings);
    expect(h.services.library.filters.region, RegionFilter.us);
    expect(h.services.library.filters.query, isEmpty);
    await h.dispose(tester);
  });

  testWidgets('card actions: Start, Resume and Start again open the exam; See score opens the result', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);

    Future<void> press(int paperId, String label) async {
      final card = find.byWidgetPredicate((w) => w is BookletCard && w.item.paper.id == paperId);
      final button = find.descendant(of: card, matching: find.text(label));
      await tester.ensureVisible(button);
      await tester.tap(button);
      await settleApp(tester);
    }

    await press(52, 'Start');
    await press(51, 'Resume');
    await press(44, 'Start again');
    expect(h.launched.map((r) => (r as PastpaperExamRequest).practiceTestId), [52, 51, 44]);
    expect(h.launched.map((r) => (r as PastpaperExamRequest).action),
        [PaperAction.start, PaperAction.resume, PaperAction.startAgain]);
    expect((h.launched[1] as PastpaperExamRequest).openAttemptId, 9124);

    await press(43, 'See score');
    expect(find.byType(PastpaperResultScreen), findsOneWidget);
    expect(find.text('640'), findsNWidgets(2), reason: 'the score card and its row in History');
    expect(find.text('+50 since your last sitting'), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('History lists every sitting newest first and opens the one picked', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    final history = find.text('History · 2 attempts');
    await tester.ensureVisible(history);
    await tester.tap(history);
    await settleApp(tester);
    expect(find.byType(HistoryDialog), findsOneWidget);
    expect(find.text('Attempt 2'), findsOneWidget);
    expect(find.text('Attempt 1'), findsOneWidget);
    expect(find.text('Latest'), findsOneWidget);

    await tester.tap(find.text('Attempt 2'));
    await settleApp(tester);
    expect(find.byType(HistoryDialog), findsNothing);
    final screen = tester.widget<PastpaperResultScreen>(find.byType(PastpaperResultScreen));
    expect(screen.attemptId, 8801);
    await h.dispose(tester);
  });

  testWidgets('a whole card is one keyboard stop: Enter on it runs its main action', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    final card = find.byWidgetPredicate((w) => w is BookletCard && w.item.paper.id == 52);
    await tester.ensureVisible(card);
    final focus = Focus.of(tester.element(find.descendant(of: card, matching: find.byType(Container)).first));
    focus.requestFocus();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await settleApp(tester);
    expect(h.launched.single, isA<PastpaperExamRequest>());
    await h.dispose(tester);
  });
}
