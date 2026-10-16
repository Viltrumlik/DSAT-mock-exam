// buildAppServices wires the real pieces together the way main() does, and "Delete data on
// this computer" really removes the student's files.
import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/http_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/http/http_transport.dart';
import 'package:mastersat_app/core/store/app_paths.dart';
import 'package:mastersat_app/main.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() => driftRuntimeOptions.dontWarnAboutMultipleDatabases = true);

  late Directory dir;
  setUp(() async => dir = await Directory.systemTemp.createTemp('ms-services-'));
  tearDown(() async {
    if (await dir.exists()) await dir.delete(recursive: true);
  });

  test('over HTTP: the API gets the token source, the 426 hook and the server clock', () async {
    final config = ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0');
    final s = await buildAppServices(config: config, paths: AppPaths(dir.path), native: FakeNativeBridge());
    addTearDown(s.dispose);
    final api = s.api as HttpV1Api;
    expect(identical(api.tokens, s.auth), isTrue);
    api.onUpdateRequired!(const UpdateRequired(updateUrl: 'u'));
    expect(s.updates.required.value, isNotNull);
    api.onServerNow!(DateTime.now().toUtc().add(const Duration(minutes: 3)));
    expect(s.serverClock.offset.inMinutes, inInclusiveRange(2, 3));
    (api.transport as HttpTransport).close();
  });

  test('in-process fixtures need no network', () async {
    final fixtures = await buildAppServices(
      config: ApiConfig.fromDefine('fixture:', appVersion: '0.2.0'),
      paths: AppPaths(dir.path),
      native: FakeNativeBridge(),
    );
    addTearDown(fixtures.dispose);
    expect(fixtures.api, isA<FixtureV1Api>());
  });

  test('sign in, Home cached on disk, then Delete data removes the database and the session', () async {
    final paths = AppPaths(dir.path);
    final s = await buildAppServices(
      config: ApiConfig.fromDefine('fixture:', appVersion: '0.2.0'),
      paths: paths,
      native: FakeNativeBridge(),
    );
    addTearDown(s.dispose);
    await s.auth.restore();
    await s.auth.signIn('aziza', 'fixture-password');
    expect(s.auth.isSignedIn, isTrue);
    expect(paths.authFile.existsSync(), isTrue);
    await s.home.refresh();
    await s.home.loadCached();
    expect(s.home.store, isNotNull);
    expect(paths.storeFile(77).existsSync(), isTrue);
    await Directory('${paths.mediaDir.path}/x').create(recursive: true);

    final unsentOff = s.unsentWork.register('exam outbox', () => 1);
    expect((await s.deleteLocalData())!.total, 1, reason: 'blocked while unsent');
    expect(paths.storeFile(77).existsSync(), isTrue);
    unsentOff();

    expect(await s.deleteLocalData(), isNull);
    expect(s.auth.isSignedIn, isFalse);
    expect(paths.authFile.existsSync(), isFalse);
    expect(paths.storeFile(77).existsSync(), isFalse);
    expect(paths.mediaDir.existsSync(), isFalse);
  });
}
