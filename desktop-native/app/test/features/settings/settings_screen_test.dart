// Settings / Diagnostics: version, update channel (saved per student, re-checks the feed),
// updates, Copy diagnostics (no secrets), and Delete data on this computer (blocked while
// anything is unsent).
import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/auth/auth_controller.dart';
import 'package:mastersat_app/core/store/settings_store.dart';
import 'package:mastersat_app/core/store/user_store.dart';
import 'package:mastersat_app/features/settings/settings_screen.dart';
import 'package:mastersat_app/features/shell/app_shell.dart';
import 'package:mastersat_app/features/signin/sign_in_screen.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import '../../core/harness/app_harness.dart';

Future<AppHarness> openSettingsScreen(WidgetTester tester, {UserStore? store}) async {
  final h = await AppHarness.start(openStore: store == null ? null : (_) async => store);
  await h.pump(tester);
  unawaited(openSettings(h.services.navigatorKey.currentContext!));
  await settleApp(tester);
  expect(find.byType(SettingsScreen), findsOneWidget);
  return h;
}

void main() {
  testWidgets('shows the version, the channel, the update state and the data status', (tester) async {
    final h = await openSettingsScreen(tester);
    expect(find.descendant(of: find.byType(SettingsScreen), matching: find.text('Settings')), findsOneWidget);
    expect(find.descendant(of: find.byType(AppSidebar), matching: find.text('Settings')), findsOneWidget,
        reason: 'a page of the shell, its sidebar beside it');
    expect(find.text('0.2.0'), findsOneWidget);
    expect(find.text('Stable'), findsOneWidget);
    expect(find.text('Beta'), findsOneWidget);
    expect(find.text("You're up to date"), findsOneWidget, reason: 'Home checked at launch');
    expect(find.text('Everything you did has reached MasterSAT.'), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('Beta is saved for this student and the feed is checked on that channel', (tester) async {
    final store = await UserStore.memory(77);
    final h = await openSettingsScreen(tester, store: store);
    await tester.tap(find.text('Beta'));
    await settleApp(tester);
    expect(store.settings.updateChannel, UpdateChannel.beta);
    // The MacBook app's packages are on the feed's `osx` channels.
    expect(h.native.calls.last, Platform.isMacOS ? 'updateCheck osx-beta' : 'updateCheck beta');
    await h.dispose(tester);
  });

  testWidgets('Check for updates downloads a new version, then offers Restart to update', (tester) async {
    final h = await openSettingsScreen(tester);
    h.native.update = const UpdateInfo(available: true, version: '0.3.0');
    await tester.tap(find.text('Check for updates'));
    await settleApp(tester);
    expect(find.text('Version 0.3.0 is ready to install'), findsOneWidget);
    await tester.tap(find.text('Restart to update').last);
    await tester.pump();
    expect(h.native.applied, isTrue);
    await h.dispose(tester);
  });

  testWidgets('Copy diagnostics puts JSON on the clipboard — and never a token', (tester) async {
    final h = await openSettingsScreen(tester);
    h.services.log.add('auth', 'Bearer ${h.services.auth.accessToken}');
    await tester.tap(find.text('Copy diagnostics'));
    await settleApp(tester);
    final text = h.clipboard.single;
    final json = jsonDecode(text) as Map<String, Object?>;
    expect((json['app']! as Map)['version'], '0.2.0');
    expect((json['session']! as Map)['user_id'], 77);
    expect((json['home']! as Map)['pastpapers'], 6);
    expect(text, isNot(contains(h.services.auth.accessToken!)));
    expect(text, isNot(contains(h.tokens.session!.refresh)));
    expect(find.text('Diagnostics copied — paste them into your message to support.'), findsOneWidget);
    await h.dispose(tester);
  });

  testWidgets('Delete data is refused while answers are waiting to be sent', (tester) async {
    final h = await openSettingsScreen(tester);
    final off = h.services.unsentWork.register('exam outbox', () => 2);
    await tester.ensureVisible(find.text('Delete data on this computer'));
    await tester.tap(find.text('Delete data on this computer'));
    await settleApp(tester);
    expect(find.text("Some answers haven't been sent yet"), findsOneWidget);
    expect(find.text('Delete and sign out'), findsNothing, reason: 'there is no way through');
    await tester.tap(find.text('Keep my data'));
    await settleApp(tester);
    expect(find.text('2 items are waiting to be sent. Keep the app open while you are online.'), findsOneWidget);
    expect(h.services.auth.isSignedIn, isTrue);
    off();
    await h.dispose(tester);
  });

  testWidgets('Delete data: confirm, then the student is signed out and their data is gone', (tester) async {
    final h = await openSettingsScreen(tester);
    await tester.ensureVisible(find.text('Delete data on this computer'));
    await tester.tap(find.text('Delete data on this computer'));
    await settleApp(tester);
    expect(find.text('Delete data on this computer?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await settleApp(tester);
    expect(h.services.auth.isSignedIn, isTrue);

    await tester.ensureVisible(find.text('Delete data on this computer'));
    await tester.tap(find.text('Delete data on this computer'));
    await settleApp(tester);
    await tester.tap(find.text('Delete and sign out'));
    // Real file deletes (under a path that does not exist) need real time between frames.
    for (var i = 0; i < 50 && h.services.auth.isSignedIn; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
      await tester.pump();
    }
    await settleApp(tester);
    expect(h.services.auth.status, AuthStatus.signedOut);
    expect(h.tokens.session, isNull);
    expect(h.services.home.home, isNull);
    expect(find.byType(SignInScreen), findsOneWidget);
    await h.dispose(tester);
  });
}
