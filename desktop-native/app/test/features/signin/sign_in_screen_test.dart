// The sign-in form in every state: empty (Sign in disabled), typing, Enter, show/hide, busy,
// each problem banner (the password clears on a refusal and stays when the form can retry),
// signing in landing on Home, and a session the server ended.
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/auth/auth_controller.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/theme/controls.dart';
import 'package:mastersat_app/features/home/home_screen.dart';
import 'package:mastersat_app/features/signin/sign_in_screen.dart';

import '../../core/harness/app_harness.dart';

Future<AppHarness> signedOut() => AppHarness.start(signedIn: false);

Finder get loginField => find.byType(TextField).first;
Finder get passwordField => find.byType(TextField).last;
Finder get signInButton => find.widgetWithText(AppButton, 'Sign in');

String fieldText(WidgetTester tester, Finder f) => tester.widget<TextField>(f).controller!.text;
bool obscured(WidgetTester tester) => tester.widget<EditableText>(find.byType(EditableText).last).obscureText;
bool canPress(WidgetTester tester) => tester.widget<AppButton>(signInButton).onPressed != null;

Future<void> fill(WidgetTester tester, String login, String password) async {
  await tester.enterText(loginField, login);
  await tester.enterText(passwordField, password);
  await tester.pump();
}

Future<void> submit(WidgetTester tester) async {
  await tester.tap(signInButton);
  await settleApp(tester);
}

void main() {
  testWidgets('signed out: the brand panel and the login form', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    expect(find.byType(SignInScreen), findsOneWidget);
    expect(find.text('Your digital SAT, mastered.'), findsOneWidget);
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Login'), findsOneWidget);
    expect(find.text('Email, username or phone'), findsOneWidget);
    expect(find.text('Password'), findsWidgets); // the label and the hint
    expect(signInButton, findsOneWidget);
    expect(find.text('Forgot your password? Ask your teacher.'), findsOneWidget);
    expect(find.text('Sign in with your browser'), findsNothing);
    expect(find.text('© 2026 MasterSAT Center'), findsOneWidget);
    expect(obscured(tester), isTrue);
    final login = tester.widget<EditableText>(find.byType(EditableText).first);
    expect(login.focusNode.hasFocus, isTrue, reason: 'the login field has the focus');
    expect(login.textInputAction, TextInputAction.next);
    await h.dispose(tester);
  });

  testWidgets('a narrow window hides the brand panel and shows the logo instead', (tester) async {
    final h = await signedOut();
    await h.pump(tester, size: const Size(900, 700));
    expect(find.byType(BrandPanel), findsNothing);
    expect(find.text('MasterSAT'), findsOneWidget);
    expect(signInButton, findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('Sign in stays disabled until both fields are filled', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    expect(canPress(tester), isFalse);
    await tester.enterText(loginField, 'aziza');
    await tester.pump();
    expect(canPress(tester), isFalse);
    await tester.enterText(passwordField, 'p');
    await tester.pump();
    expect(canPress(tester), isTrue);
    await tester.enterText(loginField, '   ');
    await tester.pump();
    expect(canPress(tester), isFalse, reason: 'a blank login is no login');
    await tester.tap(signInButton);
    await settleApp(tester);
    expect(h.api.calls.where((c) => c.method == 'authLogin'), isEmpty);
    await h.dispose(tester);
  });

  testWidgets('typing and pressing Sign in signs in and lands on Home', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await fill(tester, ' aziza@example.com ', 'my-password');
    await submit(tester);
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.text('Welcome back, Aziza'), findsOneWidget);
    final login = h.api.calls.singleWhere((c) => c.method == 'authLogin');
    expect(login.args, {'identifier': 'aziza@example.com'});
    expect(h.tokens.session, isNotNull);
    await h.dispose(tester);
  });

  testWidgets('Enter in the password field signs in', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await fill(tester, 'aziza', 'my-password');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settleApp(tester);
    expect(find.byType(HomeScreen), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('Enter in the login field goes on to the password; with both filled it signs in', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await tester.enterText(loginField, 'aziza');
    await tester.testTextInput.receiveAction(TextInputAction.next);
    await tester.pump();
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'password');
    expect(h.api.calls.where((c) => c.method == 'authLogin'), isEmpty);

    await tester.enterText(passwordField, 'my-password');
    await tester.showKeyboard(loginField);
    await tester.testTextInput.receiveAction(TextInputAction.next);
    await settleApp(tester);
    expect(find.byType(HomeScreen), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('the eye shows and hides the password', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await tester.enterText(passwordField, 'secret');
    expect(obscured(tester), isTrue);
    await tester.tap(find.byTooltip('Show password'));
    await tester.pump();
    expect(obscured(tester), isFalse);
    expect(find.byTooltip('Hide password'), findsOneWidget);
    await tester.tap(find.byTooltip('Hide password'));
    await tester.pump();
    expect(obscured(tester), isTrue);
    expect(fieldText(tester, passwordField), 'secret');
    await h.dispose(tester);
  });

  testWidgets('"Signing in…" while the request is in flight', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    h.api.latency = const Duration(milliseconds: 500);
    await fill(tester, 'aziza', 'my-password');
    await tester.tap(signInButton);
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('Signing in…'), findsOneWidget);
    expect(h.services.auth.status, AuthStatus.signingIn);
    expect(tester.widget<AppButton>(find.widgetWithText(AppButton, 'Signing in…')).busy, isTrue);
    await tester.testTextInput.receiveAction(TextInputAction.done); // Enter again: nothing more is sent
    await tester.pump(const Duration(milliseconds: 600));
    h.api.latency = Duration.zero;
    await tester.pump(const Duration(milliseconds: 600)); // Home's first request
    await settleApp(tester);
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(h.api.calls.where((c) => c.method == 'authLogin'), hasLength(1));
    await h.dispose(tester);
  });

  testWidgets('a wrong password: the notice, the password cleared, the login kept', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await fill(tester, 'aziza', FixtureV1Api.wrongPassword);
    await submit(tester);
    expect(find.byType(SignInScreen), findsOneWidget);
    expect(find.text("Couldn't sign you in"), findsOneWidget);
    expect(find.text('That login or password is not right.'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
    expect(fieldText(tester, loginField), 'aziza');
    expect(fieldText(tester, passwordField), isEmpty);
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'password', reason: 'ready to retype');
    expect(canPress(tester), isFalse);

    await tester.enterText(passwordField, 'the-right-one');
    await tester.pump();
    await submit(tester);
    expect(find.byType(HomeScreen), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets("an account without a password: the server's own words", (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await fill(tester, FixtureV1Api.passwordNotSetLogin, '4567');
    await submit(tester);
    expect(find.text('Set your password first'), findsOneWidget);
    expect(find.text('Set your password on mastersat.uz first, then sign in here.'), findsOneWidget);
    expect(fieldText(tester, passwordField), isEmpty);
    await h.dispose(tester);
  });

  testWidgets('every refusal has its notice, and none of them offers Try again', (tester) async {
    final cases = <ApiException, (String, String)>{
      ApiError(status: 403, body: ApiErrorBody(detail: 'This app is for learning center students.')):
          ("This account can't sign in here", 'This app is for learning center students.'),
      ApiError(status: 429, body: ApiErrorBody(detail: 'throttled')):
          ('Too many tries', 'Too many tries. Wait a few minutes and try again.'),
      const UpdateRequired(updateUrl: 'https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe'):
          ('Update required', 'Update the MasterSAT app to continue.'),
    };
    for (final MapEntry(key: error, value: (title, message)) in cases.entries) {
      final h = await signedOut();
      await h.pump(tester);
      h.api.failNext(error);
      await fill(tester, 'aziza', 'my-password');
      await submit(tester);
      expect(find.text(title), findsOneWidget, reason: '$error');
      expect(find.text(message), findsOneWidget, reason: '$error');
      expect(find.text('Try again'), findsNothing, reason: '$error');
      expect(fieldText(tester, passwordField), isEmpty, reason: '$error');
      await h.dispose(tester);
    }
  });

  testWidgets('offline: the password stays and "Try again" sends the same login again', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    h.api.offline = true;
    await fill(tester, 'aziza', 'my-password');
    await submit(tester);
    expect(find.text("You're offline"), findsOneWidget);
    expect(find.text('No connection to MasterSAT. Check your internet, then press Try again.'), findsOneWidget);
    expect(fieldText(tester, passwordField), 'my-password');

    h.api.offline = false;
    await tester.tap(find.text('Try again'));
    await settleApp(tester);
    expect(find.byType(HomeScreen), findsOneWidget);
    final logins = h.api.calls.where((c) => c.method == 'authLogin').map((c) => c.args).toList();
    expect(logins, [
      {'identifier': 'aziza'},
      {'identifier': 'aziza'},
    ]);
    await h.dispose(tester);
  });

  testWidgets('a server failure offers Try again too', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    h.api.failNext(ApiError(status: 503, body: ApiErrorBody(detail: 'x')));
    await fill(tester, 'aziza', 'my-password');
    await submit(tester);
    expect(find.text("Couldn't sign you in"), findsOneWidget);
    expect(find.text("MasterSAT couldn't finish signing you in. Press Try again in a moment."), findsOneWidget);
    expect(fieldText(tester, passwordField), 'my-password');
    await tester.tap(find.text('Try again'));
    await settleApp(tester);
    expect(find.byType(HomeScreen), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('right-clicking the password opens no context menu', (tester) async {
    final h = await signedOut();
    await h.pump(tester);
    await tester.enterText(passwordField, 'secret');
    await tester.tap(passwordField, buttons: kSecondaryMouseButton, kind: PointerDeviceKind.mouse);
    await settleApp(tester);
    expect(find.byType(AdaptiveTextSelectionToolbar), findsNothing);
    expect(find.text('Paste'), findsNothing);
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
