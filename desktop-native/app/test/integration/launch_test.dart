// How a launch is routed (main.dart launchApp) and which native bridge it runs on
// (core/startup/native_loader.dart):
//  * `--s1-harness` runs windows-host's S1 harness, with lockdown through the real bridge,
//    and never the app;
//  * any other launch runs the app on the loaded bridge;
//  * a release build without mastersat_native shows "MasterSAT needs to be installed again"
//    instead of starting; a development build falls back to the fake bridge.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/startup/native_loader.dart';
import 'package:mastersat_app/island/s1_harness.dart';
import 'package:mastersat_app/main.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';
import 'package:mastersat_app/native/ffi_native_bridge.dart';
import 'package:mastersat_app/native/native_bridge.dart';

class _Launch {
  final List<List<String>> harness = [];
  S1Lockdown? lockdown;
  final List<NativeBridge?> apps = [];
  final List<Widget> missing = [];

  Future<void> run(List<String> args, NativeLoad Function() load) => launchApp(
        args,
        loadNative: load,
        runHarness: (a, {S1Lockdown? lockdown}) async {
          harness.add(a);
          this.lockdown = lockdown;
        },
        runAppMain: ({NativeBridge? native, ExamLauncher? examLauncher}) async => apps.add(native),
        showMissingPart: missing.add,
      );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('--s1-harness routes to the S1 harness, with lockdown over the real bridge, and never the app', () async {
    final bridge = FakeNativeBridge();
    final l = _Launch();
    await l.run(['--s1-harness'], () => loadNativeBridge(appVersion: '0.2.0', open: () => bridge));
    expect(l.harness, [
      ['--s1-harness'],
    ]);
    expect(l.apps, isEmpty);
    expect(l.lockdown, isNotNull, reason: 'S1Lockdown.fromBridge(the loaded bridge)');
    l.lockdown!.enter();
    expect(bridge.locked, isTrue, reason: 'the harness locks through the bridge the app loaded');
    l.lockdown!.exit();
    expect(bridge.locked, isFalse);
  });

  test('the S1 harness on a development fake bridge gets no lockdown (never a fake lock)', () async {
    final l = _Launch();
    await l.run(['--s1-harness'], () => loadNativeBridge(
          appVersion: '0.2.0',
          releaseMode: false,
          open: () => throw const NativeLibraryUnavailable(['mastersat_native.dll: not found']),
        ));
    expect(l.harness, hasLength(1));
    expect(l.lockdown, isNull);
  });

  test('any other launch runs the app on the loaded bridge', () async {
    final bridge = FakeNativeBridge();
    final l = _Launch();
    await l.run(['mastersat://auth?code=x'], () => loadNativeBridge(appVersion: '0.2.0', open: () => bridge));
    expect(l.harness, isEmpty);
    expect(l.apps, [same(bridge)]);
    expect(l.missing, isEmpty);
  });

  test('a release build without the native library shows the reinstall screen and does not start', () async {
    final l = _Launch();
    await l.run(const [], () => loadNativeBridge(
          appVersion: '0.2.0',
          releaseMode: true,
          open: () => throw const NativeLibraryUnavailable(['mastersat_native.dll: not found']),
        ));
    expect(l.apps, isEmpty);
    expect(l.missing.single, isA<MissingPartApp>());
  });

  test('loadNativeBridge: a development build falls back to the fake; a release build never does', () {
    Never fail() => throw const NativeLibraryUnavailable(['x: missing']);
    final dev = loadNativeBridge(appVersion: '0.2.0', releaseMode: false, open: fail);
    expect(dev.bridge, isA<FakeNativeBridge>());
    expect(dev.isFake, isTrue);
    expect(dev.problem, contains('not available'));
    final rel = loadNativeBridge(appVersion: '0.2.0', releaseMode: true, open: fail);
    expect(rel.bridge, isNull);
    expect(rel.canStart, isFalse);
    // A DLL that opens but lacks a symbol (a broken install) is the same: no start in release.
    final broken = loadNativeBridge(appVersion: '0.2.0', releaseMode: true, open: () => throw ArgumentError('ms_prove'));
    expect(broken.bridge, isNull);
  });

  testWidgets('the reinstall screen: plain words and a way to the website', (tester) async {
    final opened = <Uri>[];
    await tester.pumpWidget(MissingPartApp(
      detail: 'mastersat_native is not available',
      openUrl: (u) async {
        opened.add(u);
        return true;
      },
    ));
    expect(find.text(MissingPartScreen.title), findsOneWidget);
    expect(find.text(MissingPartScreen.message), findsOneWidget);
    await tester.tap(find.text('Open mastersat.uz'));
    await tester.pump();
    expect(opened, [Uri.parse('https://mastersat.uz')]);
  });
}
