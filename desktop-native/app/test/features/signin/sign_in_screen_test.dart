// The sign-in screen in every state: signed out, waiting for the browser, exchanging,
// offline with "Try again" (re-sends), an expired link, and the browser hand-off landing on Home.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/auth/auth_controller.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/features/home/home_screen.dart';
import 'package:mastersat_app/features/signin/sign_in_screen.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';

import '../../core/harness/app_harness.dart';

/// The real browser hand-off (no dev shortcut): a production-shaped config, the API injected.
Future<AppHarness> signedOut() => AppHarness.start(
      signedIn: false,
      config: ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0'),
    );

void main() {
  testWidgets('signed out: the brand panel and "Sign in with your browser"', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    expect(find.byType(SignInScreen), findsOneWidget);
    expect(find.text('Your digital SAT, mastered.'), findsOneWidget);
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Sign in with your browser'), findsOneWidget);
    expect(find.textContaining('Google, Telegram or your email'), findsOneWidget);
    expect(find.text('© 2026 MasterSAT Center'), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('a narrow window hides the brand panel and shows the logo instead', (tester) async {
    final h = await signedOut();
    await h.pump(tester, size: const Size(900, 700));
    expect(find.byType(BrandPanel), findsNothing);
    expect(find.text('MasterSAT'), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('pressing it opens the browser on /desktop/link and waits; the link signs in', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await tester.tap(find.text('Sign in with your browser'));
    await settleApp(tester);
    expect(h.openedUrls.single.toString(),
        'https://mastersat.uz/desktop/link?challenge=${FakeNativeBridge.pkceChallenge(FakeNativeBridge.fixedVerifier)}');
    expect(find.text('Waiting for your browser…'), findsOneWidget);
    expect(find.textContaining('this screen updates on its own'), findsOneWidget);
    expect(find.text('Open the browser again'), findsOneWidget);

    await h.services.auth.handleLink('mastersat://auth?code=from-the-website');
    await settleApp(tester);
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.text('Welcome back, Aziza'), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('Cancel returns to the button', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await tester.tap(find.text('Sign in with your browser'));
    await settleApp(tester);
    await tester.tap(find.text('Cancel'));
    await settleApp(tester);
    expect(h.services.auth.status, AuthStatus.signedOut);
    expect(find.text('Sign in with your browser'), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('offline: the notice offers Try again, which re-sends the same exchange', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await tester.tap(find.text('Sign in with your browser'));
    await settleApp(tester);
    h.api.offline = true;
    await h.services.auth.handleLink('mastersat://auth?code=c1');
    await settleApp(tester);
    expect(find.text("You're offline"), findsOneWidget);
    expect(find.text('No connection to MasterSAT. Check your internet, then press Try again.'), findsOneWidget);

    h.api.offline = false;
    await tester.tap(find.text('Try again'));
    await settleApp(tester);
    expect(find.byType(HomeScreen), findsOneWidget);
    final exchanges = h.api.calls.where((c) => c.method == 'authExchange').toList();
    expect(exchanges.map((c) => c.args['code']), ['c1', 'c1']);
    expect(h.openedUrls, hasLength(1), reason: 'no second trip to the browser');
    await h.dispose(tester);
  });

  testWidgets('"Signing you in…" while the exchange is in flight', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await tester.tap(find.text('Sign in with your browser'));
    await settleApp(tester);
    h.api.latency = const Duration(milliseconds: 500);
    final done = h.services.auth.handleLink('mastersat://auth?code=c');
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('Signing you in…'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 600));
    await done;
    h.api.latency = Duration.zero;
    await tester.pump(const Duration(milliseconds: 600)); // Home's first request
    await settleApp(tester);
    expect(find.byType(HomeScreen), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('an expired link asks to start again (no Try again)', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await tester.tap(find.text('Sign in with your browser'));
    await settleApp(tester);
    h.api.failNext(ApiError(status: 400, body: ApiErrorBody(detail: 'This sign-in link has expired.')));
    await h.services.auth.handleLink('mastersat://auth?code=old');
    await settleApp(tester);
    expect(find.text('That sign-in link has expired'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
    expect(find.text('Sign in with your browser'), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('a session the server ended brings the student back here with a note', (tester) async {
    final h = await AppHarness.start();
    await h.pump(tester);
    h.api.failNext(ApiError(status: 401, body: ApiErrorBody(detail: 'Token is invalid or expired')));
    await h.services.auth.refreshNow();
    await settleApp(tester);
    expect(find.byType(SignInScreen), findsOneWidget);
    expect(find.text('Please sign in again'), findsOneWidget);
    expect(find.text('Your session ended. Please sign in again.'), findsOneWidget);
    await h.dispose(tester);
  });
}
