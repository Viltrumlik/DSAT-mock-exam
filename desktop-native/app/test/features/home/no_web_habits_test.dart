// No browser habits outside the exam (owner decision; architecture §2.3): no ink ripples, no
// hand cursor, nothing selectable but inputs, no right-click menu; and the Home behaviours
// that are not buttons — a countdown reaching zero asks the server, coming back to the window
// refreshes, and Home's "update available" banner.
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import '../../core/harness/app_harness.dart';

class _UpdateAvailableApi extends FixtureV1Api {
  _UpdateAvailableApi({super.now});

  @override
  Future<HomeFetch> home({String? ifNoneMatch}) async {
    await super.home(ifNoneMatch: ifNoneMatch);
    return HomeFetch.fresh(
      HomeResponse.fromJson(JsonReader.of(FixtureV1Api.fixture('home.response.update_available.json'))),
      '"update"',
    );
  }
}

Future<void> expectNoWebHabits(WidgetTester tester, String screen) async {
  expect(find.byType(InkWell), findsNothing, reason: '$screen: no Material ink');
  expect(find.byType(InkResponse), findsNothing, reason: '$screen: no Material ink');
  expect(find.byType(SelectableText), findsNothing, reason: '$screen: nothing selectable');
  expect(find.byType(SelectionArea), findsNothing, reason: '$screen: nothing selectable');
  final hand = find.byWidgetPredicate((w) =>
      (w is MouseRegion && w.cursor == SystemMouseCursors.click) ||
      (w is FocusableActionDetector && w.mouseCursor == SystemMouseCursors.click));
  expect(hand, findsNothing, reason: '$screen: no hand cursor');
}

void main() {
  testWidgets('Home, a result, Settings and sign-in have no web habits', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await expectNoWebHabits(tester, 'Home');

    final ctx = h.services.navigatorKey.currentContext!;
    openPastpaperResult(ctx, attemptId: 8801).ignore();
    await settleApp(tester);
    await expectNoWebHabits(tester, 'past-paper result');
    h.services.navigatorKey.currentState!.pop();
    openSettings(ctx).ignore();
    await settleApp(tester);
    await expectNoWebHabits(tester, 'Settings');
    h.services.navigatorKey.currentState!.pop();
    await h.services.auth.signOut();
    await settleApp(tester);
    await expectNoWebHabits(tester, 'sign-in');
    await h.dispose(tester);
  });

  testWidgets('the mouse cursor over a button is the arrow', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    final gesture = await tester.createGesture(kind: PointerDeviceKind.mouse);
    addTearDown(gesture.removePointer);
    await gesture.addPointer(location: tester.getCenter(find.text('Sign out')));
    await tester.pump();
    expect(RendererBinding.instance.mouseTracker.debugDeviceActiveCursor(1), SystemMouseCursors.basic);
    await tester.ensureVisible(find.byType(TextField));
    await settleApp(tester);
    await gesture.moveTo(tester.getCenter(find.byType(TextField)));
    await tester.pump();
    expect(RendererBinding.instance.mouseTracker.debugDeviceActiveCursor(1), SystemMouseCursors.text,
        reason: 'inputs keep the text cursor');
    await h.dispose(tester);
  });

  testWidgets('right-clicking the search box opens no context menu', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await tester.enterText(find.byType(TextField), 'june');
    await tester.tap(find.byType(TextField), buttons: kSecondaryMouseButton, kind: PointerDeviceKind.mouse);
    await settleApp(tester);
    expect(find.byType(AdaptiveTextSelectionToolbar), findsNothing);
    expect(find.text('Copy'), findsNothing);
    expect(find.text('Paste'), findsNothing);
    await h.dispose(tester);
  });

  testWidgets('a countdown that reaches zero asks the server again', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    final before = h.api.calls.where((c) => c.method == 'home').length;
    // Midterm 15 opens 2026-10-12 09:00Z; move the clock to one second before.
    h.clock.set(DateTime.utc(2026, 10, 12, 8, 59, 59));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('starts in 0m 1s'), findsOneWidget);
    h.clock.set(DateTime.utc(2026, 10, 12, 9, 0, 0));
    await tester.pump(const Duration(seconds: 1));
    await settleApp(tester);
    expect(h.api.calls.where((c) => c.method == 'home').length, before + 1);
    await h.dispose(tester);
  });

  testWidgets('coming back to the window refreshes Home (one conditional request)', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    final before = h.api.calls.where((c) => c.method == 'home').length;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await settleApp(tester);
    final calls = h.api.calls.where((c) => c.method == 'home').toList();
    expect(calls.length, before + 1);
    expect(calls.last.args['if_none_match'], isNotNull);
    await h.dispose(tester);
  });

  testWidgets('Home offers an available update; with nothing in the feed yet, the website installer', (tester) async {
    final h = await AppHarness.start(api: _UpdateAvailableApi(now: () => fixtureNow));
    await h.pump(tester);
    expect(find.text('A new version of MasterSAT is ready.'), findsOneWidget);
    // The launch check found nothing in the feed yet: the website's installer is offered.
    expect(find.text('Download from the website'), findsOneWidget);
    await tester.tap(find.text('Download from the website'));
    await settleApp(tester);
    expect(h.openedUrls.single.toString(), 'https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe');
    await h.dispose(tester);
  });

  testWidgets('Home offers an available update and downloads it when the feed has it', (tester) async {
    final h = await AppHarness.start(api: _UpdateAvailableApi(now: () => fixtureNow));
    h.native.update = const UpdateInfo(available: true, version: '0.3.0');
    await h.pump(tester);
    expect(find.text('MasterSAT 0.3.0 is ready'), findsOneWidget, reason: 'downloaded in the background at launch');
    expect(find.text('Restart to update'), findsOneWidget);
    await h.dispose(tester);
  });
}
