import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/store/app_paths.dart';
import 'package:mastersat_app/core/store/settings_store.dart';
import 'package:mastersat_app/core/store/user_store.dart';

HomeResponse fixtureHome() => HomeResponse.fromJson(JsonReader.of(FixtureV1Api.fixture('home.response.json')));

void main() {
  // Two students' databases open at once is deliberate in these tests.
  setUpAll(() => driftRuntimeOptions.dontWarnAboutMultipleDatabases = true);

  group('HomeCache', () {
    test('is empty at first, then returns what was written, ETag included', () async {
      final store = await UserStore.memory(77);
      addTearDown(store.close);
      expect(await store.homeCache.read(), isNull);

      final at = DateTime.utc(2026, 10, 11, 9, 0, 0);
      await store.homeCache.write(fixtureHome(), '"sha256:abc"', at);
      final cached = await store.homeCache.read();
      expect(cached, isNotNull);
      expect(cached!.etag, '"sha256:abc"');
      expect(cached.fetchedAt, at);
      expect(cached.home.student.fullName, 'Aziza Karimova');
      expect(cached.home.pastpapers.length, fixtureHome().pastpapers.length);
      expect(cached.home.toJson(), fixtureHome().toJson());
    });

    test('a 304 moves the timestamp but keeps the payload', () async {
      final store = await UserStore.memory(77);
      addTearDown(store.close);
      await store.homeCache.write(fixtureHome(), '"e1"', DateTime.utc(2026, 10, 11, 9));
      await store.homeCache.touch(DateTime.utc(2026, 10, 11, 10));
      final cached = (await store.homeCache.read())!;
      expect(cached.fetchedAt, DateTime.utc(2026, 10, 11, 10));
      expect(cached.etag, '"e1"');
      await store.homeCache.touch(DateTime.utc(2026, 10, 11, 11), etag: '"e2"');
      expect((await store.homeCache.read())!.etag, '"e2"');
    });

    test('a payload that no longer parses reads as no cache', () async {
      final store = await UserStore.memory(77);
      addTearDown(store.close);
      await store.db.customStatement(
          "INSERT INTO home_cache (id, etag, payload, fetched_wall_ms) VALUES (1, NULL, '{\"schema\":1}', 0)");
      expect(await store.homeCache.read(), isNull);
    });
  });

  group('SettingsStore', () {
    test('round-trips JSON values and survives a reload', () async {
      final store = await UserStore.memory(5);
      addTearDown(store.close);
      expect(store.settings.updateChannel, UpdateChannel.stable);
      await store.settings.setUpdateChannel(UpdateChannel.beta);
      await store.settings.write(SettingsKeys.libraryFilters, {'region': 'US'});
      const placement = WindowPlacement(x: 10, y: 20, width: 1280, height: 820, maximized: true);
      await store.settings.setWindowPlacement(placement);

      await store.settings.load();
      expect(store.settings.updateChannel, UpdateChannel.beta);
      expect(store.settings.readMap(SettingsKeys.libraryFilters), {'region': 'US'});
      expect(store.settings.windowPlacement, placement);

      await store.settings.write(SettingsKeys.libraryFilters, null);
      await store.settings.load();
      expect(store.settings.readMap(SettingsKeys.libraryFilters), isNull);
    });
  });

  group('on disk', () {
    late Directory dir;
    setUp(() async => dir = await Directory.systemTemp.createTemp('ms-store-'));
    tearDown(() async {
      if (await dir.exists()) await dir.delete(recursive: true);
    });

    test('one file per student, in WAL mode, removable once closed', () async {
      final paths = AppPaths(dir.path);
      final a = await UserStore.open(paths, 77);
      final b = await UserStore.open(paths, 78);
      await a.homeCache.write(fixtureHome(), null, DateTime.utc(2026));
      expect(await b.homeCache.read(), isNull, reason: 'students never share a cache');
      final mode = await a.db.customSelect('PRAGMA journal_mode').getSingle();
      expect(mode.data.values.first.toString().toLowerCase(), 'wal');
      await a.close();
      await b.close();

      final reopened = await UserStore.open(paths, 77);
      expect((await reopened.homeCache.read())?.home.student.id, 77);
      await reopened.close();

      expect(paths.storeFile(77).existsSync(), isTrue);
      await UserStore.removeFiles(paths, 77);
      expect(paths.storeFile(77).existsSync(), isFalse);
      expect(paths.storeFile(78).existsSync(), isTrue);
    });

    test('writeFileAtomically replaces the whole file', () async {
      final f = File('${dir.path}/x/auth.bin');
      await writeFileAtomically(f, [1, 2, 3]);
      await writeFileAtomically(f, [4]);
      expect(await f.readAsBytes(), [4]);
      expect(File('${f.path}.tmp').existsSync(), isFalse);
    });
  });
}
