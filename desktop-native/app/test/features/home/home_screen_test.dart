// The signed-in shell: the sidebar (Past papers / Midterms / Settings), the top bar, the landing
// rule, both lists drawn from the cache on the first frame and refreshed with one conditional
// request, midterms grouped, offline and update banners, sign-out from the sidebar and the
// account menu (blocked while work is unsent).
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/auth/auth_controller.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/store/user_store.dart';
import 'package:mastersat_app/features/home/home_screen.dart';
import 'package:mastersat_app/features/home/midterm_model.dart';
import 'package:mastersat_app/features/home/midterms_page.dart';
import 'package:mastersat_app/features/library/past_papers_page.dart';
import 'package:mastersat_app/features/results/midterm_result_screen.dart';
import 'package:mastersat_app/features/results/pastpaper_result_screen.dart';
import 'package:mastersat_app/features/settings/settings_screen.dart';
import 'package:mastersat_app/features/shell/app_shell.dart';
import 'package:mastersat_app/features/shell/shell_controller.dart';
import 'package:mastersat_app/features/signin/sign_in_screen.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import '../../core/harness/app_harness.dart';

void main() {
  testWidgets('a signed-in student lands on Midterms (one is open now), with their name in the top bar', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);

    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.byType(MidtermsPage), findsOneWidget, reason: 'a midterm is available now');
    expect(find.byType(PastPapersPage), findsNothing, reason: 'built, but hidden');
    expect(find.text('Welcome back, Aziza'), findsOneWidget);
    expect(find.text('Aziza Karimova'), findsOneWidget, reason: 'the top bar shows the student');
    // The sidebar: three pages, Midterms current, with the count of midterms open now.
    final sidebar = find.byType(AppSidebar);
    for (final label in ['Past papers', 'Midterms', 'Settings', 'Sign out']) {
      expect(find.descendant(of: sidebar, matching: find.text(label)), findsOneWidget);
    }
    expect(find.descendant(of: sidebar, matching: find.text('2')), findsOneWidget, reason: 'two midterms can be sat now');
    expect(tester.widget<AppShell>(find.byType(AppShell)).section, ShellSection.midterms);
    // Midterm groups, website order, as a timeline.
    expect(midtermSection('Available now'), findsOneWidget);
    expect(midtermSection('Scheduled'), findsOneWidget);
    expect(midtermSection('Past attempts'), findsOneWidget);
    expect(find.text('October Midterm · Math'), findsOneWidget);
    expect(find.text('Start re-sit'), findsOneWidget);
    expect(find.text('starts in 1d 0h 0m'), findsOneWidget);

    // The library is one press away, drawn at once from the same Home.
    final homeCalls = h.api.calls.where((c) => c.method == 'home').length;
    await openPage(tester, 'Past papers');
    expect(find.byType(PastPapersPage), findsOneWidget);
    expect(find.text('SIMULATION'), findsOneWidget);
    expect(find.text('6 papers'), findsOneWidget);
    expect(find.text('OCTOBER 2025'), findsOneWidget);
    expect(h.api.calls.where((c) => c.method == 'home').length, homeCalls, reason: 'switching pages asks nothing');
    await h.dispose(tester);
  });

  testWidgets('with no midterm open now, the student lands on Past papers', (tester) async {
    final store = await UserStore.memory(77);
    final home = fixtureHome();
    final closed = HomeResponse.fromJson(JsonReader.of({
      ...home.toJson(),
      'midterms': [for (final m in home.midterms) if (!bucketMidterms([m]).available.contains(m)) m.toJson()],
    }));
    await store.homeCache.write(closed, '"closed"', fixtureNow);
    final h = await AppHarness.start(openStore: (_) async => store);
    h.api.offline = true;
    await h.pump(tester);
    expect(find.byType(PastPapersPage), findsOneWidget);
    expect(find.byType(MidtermsPage), findsNothing);
    expect(find.descendant(of: find.byType(AppSidebar), matching: find.text('2')), findsNothing, reason: 'no count');
    await h.dispose(tester);
  });

  testWidgets('a narrow window folds the sidebar to an icon rail that still works', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester, size: const Size(980, 720));
    final sidebar = find.byType(AppSidebar);
    expect(tester.getSize(sidebar).width, 72);
    expect(find.descendant(of: sidebar, matching: find.text('Past papers')), findsNothing, reason: 'labels become tooltips');
    await tester.tap(find.descendant(of: sidebar, matching: find.bySemanticsLabel('Past papers')));
    await settleApp(tester);
    expect(find.byType(PastPapersPage), findsOneWidget);

    await h.pump(tester, size: const Size(1280, 820));
    expect(tester.getSize(sidebar).width, 272);
    await h.dispose(tester);
  });

  testWidgets('Home draws the cached copy first, then asks with If-None-Match (one request)', (tester) async {
    final store = await UserStore.memory(77);
    final cached = fixtureHome();
    await store.homeCache.write(cached, '"etag-1"', fixtureNow.subtract(const Duration(hours: 2)));
    final h = await AppHarness.start(openStore: (_) async => store);
    h.api.offline = true;

    await h.pump(tester);
    expect(find.text('Welcome back, Aziza'), findsOneWidget, reason: 'the cache is on screen offline');
    final homeCalls = h.api.calls.where((c) => c.method == 'home').toList();
    expect(homeCalls, hasLength(1));
    expect(homeCalls.single.args['if_none_match'], '"etag-1"');
    expect(find.textContaining("You're offline — updated"), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);

    // Back online: Try again re-sends the same conditional request.
    h.api.offline = false;
    await tester.tap(find.text('Try again'));
    await settleApp(tester);
    expect(h.api.calls.where((c) => c.method == 'home'), hasLength(2));
    expect(find.textContaining("You're offline"), findsNothing);
    await h.dispose(tester);
  });

  testWidgets('with nothing cached and no connection, Home says so and Try again works', (tester) async {
    final h = await AppHarness.start();
    h.api.offline = true;
    await h.pump(tester);
    expect(find.text("You're offline"), findsOneWidget);
    expect(find.textContaining('Anything you saved on this computer is safe'), findsOneWidget);

    h.api.offline = false;
    await tester.tap(find.text('Try again'));
    await settleApp(tester);
    expect(find.text('Welcome back, Aziza'), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('a server error keeps the shown copy and offers Try again', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    h.api.failNext(ApiError(status: 503, body: ApiErrorBody(detail: 'Back in a moment.')));
    await h.services.home.refresh();
    await settleApp(tester);
    expect(find.text("Couldn't refresh your tests"), findsOneWidget);
    expect(find.text('Back in a moment.'), findsOneWidget);
    expect(find.text('Welcome back, Aziza'), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('an open midterm starts through openExam; offline it cannot start', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await tester.tap(find.widgetWithText(Semantics, 'Start').first);
    await settleApp(tester);
    expect(h.launched.single, isA<MidtermExamRequest>());
    expect((h.launched.single as MidtermExamRequest).midterm.midtermId, 14);

    h.api.offline = true;
    await h.services.home.refresh();
    await settleApp(tester);
    expect(find.text('Needs a connection to start'), findsNWidgets(2));
    await h.dispose(tester);
  });

  testWidgets('a downloaded update shows "Restart to update" on Home', (tester) async {
    final h = await AppHarness.start();
    h.native.update = const UpdateInfo(available: true, version: '0.3.0');
    await h.pump(tester);
    expect(find.text('MasterSAT 0.3.0 is ready'), findsOneWidget);
    await tester.tap(find.text('Restart to update'));
    await tester.pump();
    expect(h.native.applied, isTrue);
    await h.dispose(tester);
  });

  testWidgets('a 426 from the server covers the app with the update card', (tester) async {
    final h = await AppHarness.start();
    h.api.failNext(const UpdateRequired(
      minimumVersion: '0.3.0',
      updateUrl: 'https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe',
    ));
    await h.pump(tester);
    expect(find.text('Update required'), findsOneWidget);
    expect(find.textContaining('version 0.3.0 or newer is needed'), findsOneWidget);
    await tester.tap(find.text('Download from the website'));
    await tester.pump();
    expect(h.openedUrls.single.toString(), 'https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe');
    await h.dispose(tester);
  });

  testWidgets('Sign out signs out; with unsent answers it asks first', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    var pending = 3;
    final unregister = h.services.unsentWork.register('exam outbox', () => pending);

    await tester.tap(find.text('Sign out'));
    await settleApp(tester);
    expect(find.text("Some answers haven't been sent yet"), findsOneWidget);
    expect(find.textContaining('3 items are saved on this computer'), findsOneWidget);
    await tester.tap(find.text('Stay signed in'));
    await settleApp(tester);
    expect(h.services.auth.status, AuthStatus.signedIn);

    await tester.tap(find.text('Sign out'));
    await settleApp(tester);
    await tester.tap(find.text('Sign out anyway'));
    await settleApp(tester);
    expect(h.services.auth.status, AuthStatus.signedOut);
    expect(find.byType(SignInScreen), findsOneWidget);
    expect(h.tokens.session, isNull);

    pending = 0;
    unregister();
    await h.dispose(tester);
  });

  testWidgets('the sidebar opens Settings and the lists; a result keeps the shell and its way back', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await openPage(tester, 'Settings');
    expect(find.byType(SettingsScreen), findsOneWidget);
    expect(find.byType(MidtermsPage), findsNothing);
    await openPage(tester, 'Midterms');
    expect(find.byType(SettingsScreen), findsNothing);
    expect(find.byType(MidtermsPage), findsOneWidget);

    // A result opens over the shell: the sidebar stays, Midterms stays current, and the link
    // above the result goes back.
    await tester.tap(find.text('View result'));
    await settleApp(tester);
    expect(find.byType(MidtermResultScreen), findsOneWidget);
    expect(find.byType(AppSidebar), findsOneWidget);
    expect(tester.widget<AppShell>(find.byType(AppShell)).section, ShellSection.midterms);
    await tester.tap(find.text('Back to midterms'));
    await settleApp(tester);
    expect(find.byType(MidtermResultScreen), findsNothing);
    expect(find.byType(MidtermsPage), findsOneWidget);

    // From a result, the sidebar goes straight to another page.
    await tester.tap(find.text('View result'));
    await settleApp(tester);
    await openPage(tester, 'Past papers');
    expect(find.byType(MidtermResultScreen), findsNothing);
    expect(find.byType(PastPapersPage), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('the account menu shows the student and signs out; Escape closes it', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    await tester.tap(find.bySemanticsLabel('Your account'));
    await settleApp(tester);
    expect(find.text('Aziza Karimova'), findsNWidgets(2), reason: 'the button and the menu');
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await settleApp(tester);
    expect(find.text('Aziza Karimova'), findsOneWidget, reason: 'Escape closed the menu');

    await tester.tap(find.bySemanticsLabel('Your account'));
    await settleApp(tester);
    await tester.tap(find.descendant(of: find.bySemanticsLabel('Account menu'), matching: find.text('Sign out')));
    await settleApp(tester);
    expect(h.services.auth.status, AuthStatus.signedOut);
    expect(find.byType(SignInScreen), findsOneWidget);
    await h.dispose(tester);
  });

  test('fixture sanity: the Home fixture has the rows these tests name', () {
    final home = HomeResponse.fromJson(JsonReader.of(FixtureV1Api.fixture('home.response.json')));
    expect(home.midterms.map((m) => m.midtermId), [14, 15, 9, 10]);
    expect(home.pastpapers.map((p) => p.id), [52, 51, 43, 44, 38, 37]);
  });

  testWidgets('MaterialApp has no debug banner and switches routes with no animation', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.debugShowCheckedModeBanner, isFalse);
    await tester.tap(find.descendant(of: find.byType(AppSidebar), matching: find.text('Settings')));
    await tester.pump(); // one frame: a page of the shell is fully on screen
    expect(find.byType(SettingsScreen), findsOneWidget);
    openPastpaperResult(h.services.navigatorKey.currentContext!, attemptId: 8801).ignore();
    await tester.pump(); // one frame: an instant route is fully on screen
    expect(find.byType(PastpaperResultScreen), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('a finished sitting opens its result straight away (past paper and midterm)', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    h.outcome = (r) => switch (r) {
          PastpaperExamRequest() => const ExamOutcome(kind: AttemptKind.pastpaper, attemptId: 8801, finished: true),
          MidtermExamRequest() => const ExamOutcome(kind: AttemptKind.midterm, attemptId: 4410, finished: true),
          _ => null,
        };
    await tester.tap(find.text('Start re-sit'));
    await settleApp(tester);
    expect(find.text('MIDTERM RESULT'), findsOneWidget, reason: 'the finished attempt opens its result');
    h.services.navigatorKey.currentState!.pop();
    await settleApp(tester);

    await openPage(tester, 'Past papers');
    final start = find.text('Start').last;
    await tester.ensureVisible(start);
    await tester.tap(start);
    await settleApp(tester);
    expect(find.text('+50 since your last sitting'), findsOneWidget);
    await h.dispose(tester);
  });
}
