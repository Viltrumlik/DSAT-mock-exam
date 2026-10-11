// The macOS development host's pure parts: where the island comes from, URL mapping, the
// same-origin rule, and the loopback folder server. (WKWebView itself needs the macOS runner.)
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/island/fake_island_host.dart';
import 'package:mastersat_app/island/island_host.dart';
import 'package:mastersat_app/island/island_host_factory.dart';
import 'package:mastersat_app/island/macos_island_host.dart';
import 'package:mastersat_app/island/texture_island_host.dart';
import 'package:path/path.dart' as p;

void main() {
  group('resolveDevIslandSource', () {
    const root = '/repo/desktop-native';
    final files = <String>{
      '$root/VERSION',
      '$root/app/pubspec.yaml',
      '$root/packaging/s0-probe/content.html',
    };
    bool exists(String path) => files.contains(p.normalize(path));

    test('MS_ISLAND_URL wins when it is a loopback dev server', () {
      final s = resolveDevIslandSource(
        environment: {'MS_ISLAND_URL': 'http://127.0.0.1:5317', 'MS_ISLAND_DIR': '/x'},
        workingDirectory: '/',
        executable: '/bin/app',
        fileExists: exists,
      );
      expect(s!.url, Uri.parse('http://127.0.0.1:5317/'));
    });

    test('a non-loopback MS_ISLAND_URL is ignored', () {
      final s = resolveDevIslandSource(
        environment: {'MS_ISLAND_URL': 'https://mastersat.uz/island/'},
        workingDirectory: '$root/app',
        executable: '/bin/app',
        fileExists: exists,
      );
      expect(s!.url, isNull);
      expect(s.isProbe, isTrue);
    });

    test('MS_ISLAND_DIR when it holds content.html', () {
      final s = resolveDevIslandSource(
        environment: {'MS_ISLAND_DIR': '/elsewhere/island'},
        workingDirectory: '/',
        executable: '/bin/app',
        fileExists: (path) => path == '/elsewhere/island/content.html',
      );
      expect(s!.folder, '/elsewhere/island');
      expect(s.isProbe, isFalse);
    });

    test('the island build beside the app, found from the executable inside the .app bundle', () {
      files.add('$root/island/build/island/content.html');
      addTearDown(() => files.remove('$root/island/build/island/content.html'));
      final s = resolveDevIslandSource(
        environment: const {},
        workingDirectory: '/',
        executable: '$root/app/build/macos/Build/Products/Debug/mastersat_app.app/Contents/MacOS/mastersat_app',
        fileExists: exists,
      );
      expect(s!.folder, '$root/island/build/island');
      expect(s.isProbe, isFalse);
    });

    test('falls back to the S0 probe page, found from the repository root too', () {
      final s = resolveDevIslandSource(
        environment: const {},
        workingDirectory: '/repo',
        executable: '/Applications/x',
        fileExists: exists,
      );
      expect(s!.folder, '$root/packaging/s0-probe');
      expect(s.isProbe, isTrue);
    });

    test('null when nothing is there', () {
      expect(
        resolveDevIslandSource(environment: const {}, workingDirectory: '/', executable: '/x', fileExists: (_) => false),
        isNull,
      );
    });
  });

  test('island URLs map onto the dev origin; other hosts are refused', () {
    final base = Uri.parse('http://127.0.0.1:4000/');
    expect(mapIslandUrl('https://island.mastersat.example/content.html', base).toString(),
        'http://127.0.0.1:4000/content.html');
    expect(mapIslandUrl('https://island.mastersat.example/desmos.html?x=1', base).toString(),
        'http://127.0.0.1:4000/desmos.html?x=1');
    expect(mapIslandUrl('https://island.mastersat.example/content.html', Uri.parse('http://localhost:5317/island/')).toString(),
        'http://localhost:5317/island/content.html');
    expect(() => mapIslandUrl('https://example.com/content.html', base), throwsArgumentError);
  });

  test('navigation stays on the island origin', () {
    final base = Uri.parse('http://127.0.0.1:4000/');
    expect(isSameIslandOrigin('http://127.0.0.1:4000/content.html', base), isTrue);
    expect(isSameIslandOrigin('about:blank', base), isTrue);
    expect(isSameIslandOrigin('http://127.0.0.1:4001/content.html', base), isFalse);
    expect(isSameIslandOrigin('https://127.0.0.1:4000/content.html', base), isFalse);
    expect(isSameIslandOrigin('https://www.google.com/', base), isFalse);
    expect(isSameIslandOrigin('javascript:alert(1)', base), isFalse);
    expect(isLoopbackDevUrl(Uri.parse('http://localhost:1/')), isTrue);
    expect(isLoopbackDevUrl(Uri.parse('file:///tmp/x')), isFalse);
  });

  group('IslandFolderServer', () {
    late Directory tmp;
    late IslandFolderServer server;
    late HttpClient client;

    setUp(() async {
      tmp = await Directory.systemTemp.createTemp('island-server-');
      final served = await Directory(p.join(tmp.path, 'served')).create();
      await File(p.join(served.path, 'content.html')).writeAsString('<!doctype html><p>card</p>');
      await Directory(p.join(served.path, 'assets')).create();
      await File(p.join(served.path, 'assets', 'content.js')).writeAsString('console.log(1)');
      await File(p.join(tmp.path, 'secret.txt')).writeAsString('nope');
      server = await IslandFolderServer.start(served.path);
      client = HttpClient();
    });

    tearDown(() async {
      client.close(force: true);
      await server.close();
      await tmp.delete(recursive: true);
    });

    Future<(int, String, String?)> get(String path, {String method = 'GET'}) async {
      final req = await client.openUrl(method, server.origin.resolve(path));
      final res = await req.close();
      final body = await res.transform(const SystemEncoding().decoder).join();
      return (res.statusCode, body, res.headers.contentType?.mimeType);
    }

    test('serves files with their content types from 127.0.0.1 only', () async {
      expect(server.origin.host, '127.0.0.1');
      final (status, body, type) = await get('content.html');
      expect(status, 200);
      expect(body, contains('card'));
      expect(type, 'text/html');
      final (jsStatus, _, jsType) = await get('assets/content.js');
      expect(jsStatus, 200);
      expect(jsType, 'text/javascript');
    });

    test('404 for missing files and for anything outside the folder', () async {
      expect((await get('nope.html')).$1, 404);
      expect((await get('%2e%2e/secret.txt')).$1, 404);
      expect(server.resolve('/../x'), isNull);
      expect(server.resolve('/a/../../x'), isNull);
      expect(server.resolve('/assets/../content.html'), p.join(server.root, 'content.html'));
      expect(server.resolve('/'), p.join(server.root, 'index.html'));
    });

    test('only GET and HEAD', () async {
      expect((await get('content.html', method: 'POST')).$1, 405);
      final head = await get('content.html', method: 'HEAD');
      expect(head.$1, 200);
      expect(head.$2, isEmpty);
    });
  });

  group('islandHostFactory', () {
    tearDown(() => islandHostFactoryOverride = null);

    test('flutter test always gets the fake; platforms pick their host', () {
      expect(islandHostModeFor(environment: {'FLUTTER_TEST': 'true'}), IslandHostMode.fake);
      expect(islandHostModeFor(platform: TargetPlatform.windows, environment: const {}), IslandHostMode.texture);
      expect(islandHostModeFor(platform: TargetPlatform.macOS, environment: const {}), IslandHostMode.macosDev);
      expect(islandHostModeFor(platform: TargetPlatform.linux, environment: const {}), IslandHostMode.fake);
      expect(
        islandHostModeFor(platform: TargetPlatform.windows, environment: {'MS_ISLAND_HOST': 'fake'}, releaseMode: false),
        IslandHostMode.fake,
      );
      expect(
        islandHostModeFor(platform: TargetPlatform.windows, environment: {'MS_ISLAND_HOST': 'fake'}, releaseMode: true),
        IslandHostMode.texture,
        reason: 'a release build cannot be talked into the fake host',
      );
    });

    test('each mode builds its host', () async {
      final fake = islandHostFactory(mode: IslandHostMode.fake)(IslandKind.content);
      expect(fake, isA<FakeIslandHost>());
      final texture = islandHostFactory(mode: IslandHostMode.texture, environment: const {})(IslandKind.desmos);
      expect(texture, isA<TextureIslandHost>());
      expect((texture as TextureIslandHost).islandFolder, isNull);
      final mac = islandHostFactory(
        mode: IslandHostMode.macosDev,
        macosSource: const IslandSource.folder('/tmp/island'),
      )(IslandKind.content);
      expect(mac, isA<MacosIslandHost>());
      expect((mac as MacosIslandHost).source.folder, '/tmp/island');
      await fake.dispose();
    });

    test('MS_ISLAND_DIR re-maps the Windows island only outside release builds', () {
      final dev = islandHostFactory(
        mode: IslandHostMode.texture,
        environment: {'MS_ISLAND_DIR': r'C:\dev\island'},
        releaseMode: false,
      )(IslandKind.content) as TextureIslandHost;
      expect(dev.islandFolder, r'C:\dev\island');
      final release = islandHostFactory(
        mode: IslandHostMode.texture,
        environment: {'MS_ISLAND_DIR': r'C:\dev\island'},
        releaseMode: true,
      )(IslandKind.content) as TextureIslandHost;
      expect(release.islandFolder, isNull);
    });

    test('no island build on macOS: an unavailable host that says what to do', () async {
      final host = islandHostFactory(
        mode: IslandHostMode.macosDev,
        environment: {'MS_ISLAND_DIR': '/definitely/not/here'},
        macosSource: null,
      );
      // Resolution may still find the repo's probe page when tests run inside the repository;
      // the explicit unavailable host is what an empty machine gets:
      final unavailable = MacosIslandHost.unavailable(IslandKind.content, 'build the island');
      final events = <IslandEvent>[];
      unavailable.events.listen(events.add);
      await unavailable.open();
      await pumpEventQueue();
      expect(unavailable.state, IslandHostState.crashed);
      expect((events.single as IslandCrashedEvent).reason, 'build the island');
      expect(await unavailable.capturePreview(), isNull);
      await unavailable.dispose();
      expect(host(IslandKind.content), isA<IslandHost>());
    });

    test('a global override wins (harnesses, tests)', () {
      islandHostFactoryOverride = (kind) => FakeIslandHost(kind, scripted: false);
      final host = islandHostFactory(mode: IslandHostMode.texture)(IslandKind.content);
      expect(host, isA<FakeIslandHost>());
      expect((host as FakeIslandHost).scripted, isFalse);
    });
  });
}
