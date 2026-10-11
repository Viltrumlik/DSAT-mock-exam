// The small pieces the integration adds, each on its own:
//  * the first proxy lookup per host runs off the UI isolate (ProxyResolver.prepare);
//  * images: fixture URLs in development only, never a header, https only, never the API;
//  * More → Full screen over the runner's `mastersat/window` channel;
//  * the per-student runtime: the 'exam outbox' unsent counter, close, Delete data;
//  * diagnostics carry the islands section.
import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/clock/clock.dart';
import 'package:mastersat_app/core/diagnostics/diagnostics.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/http/http_transport.dart';
import 'package:mastersat_app/core/http/proxy.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/store/unsent_work.dart';
import 'package:mastersat_app/exam/engine/exam_runtime.dart';
import 'package:mastersat_app/exam/engine/exam_store.dart';
import 'package:mastersat_app/exam/launch/exam_runtime_host.dart';
import 'package:mastersat_app/exam/launch/island_guard.dart';
import 'package:mastersat_app/exam/launch/media_fetch.dart';
import 'package:mastersat_app/exam/launch/window_controls.dart';
import 'package:mastersat_app/island/fake_island_host.dart';
import 'package:mastersat_app/island/island_host.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';

class _RecordingTransport implements Transport {
  final List<TransportRequest> sent = [];
  int status = 200;

  @override
  Future<TransportResponse> send(TransportRequest request) async {
    sent.add(request);
    return TransportResponse(status: status, headers: const {}, body: Uint8List.fromList([1, 2, 3]));
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ProxyResolver.prepare (off the UI isolate)', () {
    test('a cache miss is looked up in the background once; findProxy then hits the cache', () async {
      var syncLookups = 0;
      var background = 0;
      final r = ProxyResolver(
        (_) {
          syncLookups++;
          return 'DIRECT';
        },
        backgroundLookup: (url) async {
          background++;
          return 'PROXY corp:8080';
        },
      );
      final u = Uri.parse('https://mastersat.uz/api/desktop/v1/home');
      await Future.wait([r.prepare(u), r.prepare(u)]);
      expect(background, 1, reason: 'concurrent prepares share one lookup');
      expect(r.findProxy(u), 'PROXY corp:8080; DIRECT');
      expect(syncLookups, 0, reason: 'the UI isolate never waited on WinHTTP');
      await r.prepare(Uri.parse('http://127.0.0.1:8765/'));
      expect(background, 1, reason: 'loopback is always DIRECT');
    });

    test('a failing or slow background lookup means DIRECT', () async {
      final failing = ProxyResolver((_) => 'PROXY x:1', backgroundLookup: (_) async => throw StateError('winhttp'));
      final u = Uri.parse('https://r2.example.com/a.png');
      await failing.prepare(u);
      expect(failing.findProxy(u), 'DIRECT');
      final slow = ProxyResolver(
        (_) => 'PROXY x:1',
        backgroundLookup: (_) => Future<String>.delayed(const Duration(seconds: 5), () => 'PROXY y:2'),
        backgroundTimeout: const Duration(milliseconds: 10),
      );
      await slow.prepare(u);
      expect(slow.findProxy(u), 'DIRECT');
    });

    test('the transport asks prepare() before it opens a request', () async {
      final seen = <Uri>[];
      final proxy = ProxyResolver((_) => 'DIRECT', backgroundLookup: (url) async {
        seen.add(Uri.parse(url));
        return 'DIRECT';
      });
      final config = ApiConfig(origin: Uri.parse('https://127.0.0.2'), appVersion: '0.2.0', connectTimeout: const Duration(milliseconds: 50));
      final t = HttpTransport(config: config, proxy: proxy);
      try {
        await t.send(TransportRequest(method: 'GET', url: Uri.parse('https://unreachable.invalid/x'), timeout: const Duration(seconds: 5)));
      } on Object {
        // no network in tests: only the order matters
      }
      expect(seen.map((u) => u.host), ['unreachable.invalid']);
      t.close(force: true);
    });
  });

  group('media fetch', () {
    final config = ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0');

    test('development: fixture URLs are answered from the embedded images', () async {
      final fetch = mediaFetcherFor(config: config, transport: null, releaseMode: false);
      final key = FixtureV1Api.fixture('media.response.json')['media'] as List;
      final url = Uri.parse((key.first as Map)['url']! as String);
      expect(url.host, fixtureMediaHost);
      expect(await fetch(url), isNotEmpty);
    });

    test('a release build never serves fixtures, sends no header, and refuses http and API URLs', () async {
      final t = _RecordingTransport();
      final fetch = mediaFetcherFor(config: config, transport: t, releaseMode: true);
      final signed = Uri.parse('https://r2.example.com/mastersat-media/q.png?X-Amz-Signature=abc');
      expect(await fetch(signed), [1, 2, 3]);
      expect(t.sent.single.headers, isEmpty, reason: 'no Bearer token ever goes to the storage host');
      expect(t.sent.single.url, signed);
      await expectLater(fetch(Uri.parse('https://$fixtureMediaHost/mastersat-media/a.png')), completes,
          reason: 'in release a fixture host is just another https host');
      await expectLater(fetch(Uri.parse('http://r2.example.com/a.png')), throwsA(isA<HttpException>()));
      await expectLater(fetch(Uri.parse('https://mastersat.uz/api/desktop/v1/home')), throwsA(isA<HttpException>()));
      t.status = 403;
      await expectLater(fetch(signed), throwsA(isA<HttpException>()));
    });
  });

  group('More → Full screen', () {
    const channel = MethodChannel('mastersat/window');
    final calls = <MethodCall>[];
    var answer = true;

    setUp(() {
      calls.clear();
      answer = true;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return answer;
      });
    });
    tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));

    test('setFullscreen goes to the runner and the state follows its answer; restore leaves it', () async {
      final w = NativeRunnerWindowControls();
      expect(w.fullscreenSupported, isTrue);
      await w.setFullscreen(true);
      expect(calls.single.method, 'setFullscreen');
      expect(calls.single.arguments, {'on': true});
      expect(w.isFullscreen.value, isTrue);
      await w.restore();
      expect(calls.last.arguments, {'on': false});
      expect(w.isFullscreen.value, isFalse);
      w.dispose();
    });

    test('a refusal (lockdown owns the window) throws and changes nothing', () async {
      answer = false;
      final w = NativeRunnerWindowControls();
      await expectLater(w.setFullscreen(true), throwsStateError);
      expect(w.isFullscreen.value, isFalse);
      w.dispose();
    });

    test('macOS (development) has no full screen control', () {
      expect(platformWindowControls(isWindows: false), isNull);
    });
  });

  group('ExamRuntimeHost', () {
    late Directory dir;
    setUp(() {
      driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
      dir = Directory.systemTemp.createTempSync('runtime-host-');
    });
    tearDown(() {
      try {
        dir.deleteSync(recursive: true);
      } on FileSystemException {
        // best effort
      }
    });

    test("one runtime per student: the 'exam outbox' counter while open, gone after close", () async {
      final unsent = UnsentWork();
      final api = FixtureV1Api();
      final host = ExamRuntimeHost(
        opener: (userId) => ExamRuntime.open(
          dataDir: dir,
          userId: userId,
          api: api,
          native: FakeNativeBridge(),
          fetchMedia: (_) async => Uint8List(0),
          background: false,
        ),
        unsentWork: unsent,
        settleWidgets: () async {},
      );
      final a = await host.openFor(77);
      expect(await host.openFor(77), same(a), reason: 'opened once');
      expect(unsent.sources, contains(examOutboxSource));
      expect((await unsent.check()).isEmpty, isTrue);
      await a.store.enqueue(OutboxItem(
        attemptId: 1,
        attemptKind: AttemptKind.pastpaper,
        lane: OutboxLane.exam,
        kind: OutboxKind.sync,
        idemKey: 'sync.1.1.1',
        payload: const {},
        createdWallMs: 0,
      ));
      expect((await unsent.check()).bySource[examOutboxSource], 1);

      final b = await host.openFor(78);
      expect(a.closed, isTrue, reason: "another student's runtime closes the first");
      expect(host.runtime, same(b));
      await host.close();
      expect(b.closed, isTrue);
      expect(host.runtime, isNull);
      expect(unsent.sources, isNot(contains(examOutboxSource)));

      expect(File('${dir.path}/${ExamStore.fileNameFor(77)}').existsSync(), isTrue);
      await ExamRuntimeHost.removeFiles(dir, 77);
      expect(File('${dir.path}/${ExamStore.fileNameFor(77)}').existsSync(), isFalse);
      expect(File('${dir.path}/${ExamStore.fileNameFor(78)}').existsSync(), isTrue, reason: 'only that student');
      host.dispose();
    });
  });

  group('islands', () {
    test('the guard reports a content island that cannot start, and diagnostics say so', () async {
      final diagnostics = IslandDiagnostics(runtimeVersion: () async => '153.0.4234.48');
      final guard = ContentIslandGuard(factory: (kind) => _NoWebView(kind), diagnostics: diagnostics)..start();
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      expect(guard.unavailable.value, isTrue);
      final snap = await diagnostics.snapshot();
      expect(snap['webview2_runtime'], '153.0.4234.48');
      expect(snap['unavailable'], 1);
      expect(snap['last_problem'], contains('could not start'));
      final json = buildDiagnostics(DiagnosticsInput(
        appVersion: '0.2.0',
        buildMode: 'debug',
        apiOrigin: 'x',
        clientHeader: 'windows/0.2.0',
        nativeLibraryVersion: 'x',
        signedIn: false,
        online: true,
        unsent: const {},
        updateChannel: 'stable',
        updateState: 'idle',
        events: const [],
        now: DateTime.utc(2026),
        islands: snap,
      ));
      expect((json['islands']! as Map)['webview2_runtime'], '153.0.4234.48');
      await guard.dispose();
    });

    test('an island that opens fine is never reported', () async {
      final guard = ContentIslandGuard(factory: FakeIslandHost.new)..start();
      await Future<void>.delayed(Duration.zero);
      expect(guard.host.state, IslandHostState.ready);
      expect(guard.unavailable.value, isFalse);
      await guard.dispose();
      expect(guard.host.state, IslandHostState.disposed);
    });
  });

  test('a clock-only sanity check of FunctionClock (used by the rigs)', () {
    final c = FunctionClock(() => DateTime.utc(2026, 10, 11, 9));
    expect(c.now(), DateTime.utc(2026, 10, 11, 9));
  });
}

class _NoWebView extends FakeIslandHost {
  _NoWebView(super.kind);

  @override
  Future<void> open() async => throw StateError('WebView2 runtime not found');
}
