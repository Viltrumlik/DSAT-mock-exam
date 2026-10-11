// TextureIslandHost / WebviewIslandHost over a fake IslandWebview: the protocol half of the
// Windows island host (validation, queue-until-ready, crash recovery, failures, preview).
import 'dart:async';
import 'dart:convert';

import 'package:fake_async/fake_async.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/island/island_host.dart';
import 'package:mastersat_app/island/protocol.dart';
import 'package:mastersat_app/island/texture_island_host.dart';
import 'package:ms_webview2/ms_webview2.dart';

class FakeIslandWebview implements IslandWebview {
  FakeIslandWebview({this.failInitialize, this.preview});

  final Object? failInitialize;
  final Uint8List? preview;
  final List<String> calls = [];
  final List<String> postedJson = [];
  final StreamController<String> messages = StreamController.broadcast(sync: true);
  final StreamController<WebviewProcessFailure> failures = StreamController.broadcast(sync: true);
  final StreamController<WebviewBlockedEvent> blockedEvents = StreamController.broadcast(sync: true);
  final StreamController<String> loadErrorEvents = StreamController.broadcast(sync: true);
  bool disposed = false;
  bool? visible;
  List<String>? allowedHosts;
  String? mappedFolder;
  String? loadedUrl;

  /// The page says something (raw JSON text, exactly as WebMessageReceived would hand it over).
  void say(Object json) {
    if (messages.isClosed) return; // a disposed web view says nothing
    messages.add(json is String ? json : jsonEncode(json));
  }
  void sayReady() => say({'v': 1, 't': 'ready', 'build': 'test', 'protocol': 1});

  List<String> get postedTypes => [for (final j in postedJson) (jsonDecode(j) as Map)['t'] as String];

  @override
  Future<void> initialize() async {
    calls.add('initialize');
    final f = failInitialize;
    if (f != null) throw f;
  }

  @override
  Future<void> mapIslandFolder(String folder) async {
    calls.add('map');
    mappedFolder = folder;
  }

  @override
  Future<void> setAllowedResourceHosts(List<String> hosts) async {
    calls.add('hosts');
    allowedHosts = hosts;
  }

  @override
  Future<void> loadUrl(String url) async {
    calls.add('load');
    loadedUrl = url;
  }

  @override
  Future<void> postWebMessage(String json) async => postedJson.add(json);

  @override
  Stream<String> get webMessages => messages.stream;

  @override
  Stream<WebviewProcessFailure> get processFailures => failures.stream;

  @override
  Stream<WebviewBlockedEvent> get blocked => blockedEvents.stream;

  @override
  Stream<String> get loadErrors => loadErrorEvents.stream;

  @override
  Future<Uint8List?> capturePreview() async {
    if (preview == null) throw PlatformException(code: 'no_preview');
    return preview;
  }

  @override
  Future<void> setVisible(bool visible) async {
    calls.add('visible:$visible');
    this.visible = visible;
  }

  @override
  Future<void> focus() async => calls.add('focus');

  @override
  Future<void> releaseFocus() async => calls.add('releaseFocus');

  @override
  Widget build(BuildContext context) => const SizedBox(key: ValueKey('fake-webview'));

  @override
  Future<void> dispose() async {
    disposed = true;
    calls.add('dispose');
    await Future.wait([messages.close(), failures.close(), blockedEvents.close(), loadErrorEvents.close()]);
  }
}

const _init = InitMessage(
  mode: 'exam',
  kind: 'pastpaper',
  subject: 'rw',
  overlays: 'native',
  zoom: 1,
  split: .5,
  highlighterOn: false,
  eliminatorOn: false,
  calcReservePx: 0,
);

void main() {
  late List<FakeIslandWebview> made;
  FakeIslandWebview Function() factoryOf({Object? failFirst, Uint8List? preview}) {
    var n = 0;
    return () {
      final w = FakeIslandWebview(failInitialize: n++ == 0 ? failFirst : null, preview: preview);
      made.add(w);
      return w;
    };
  }

  setUp(() => made = []);

  test('open: initialize, allowed hosts, then the island page; ready flips the state', () async {
    final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf());
    final events = <IslandEvent>[];
    host.events.listen(events.add);
    expect(host.state, IslandHostState.idle);
    expect(host.canDrawOverIsland, isTrue);
    await host.open();
    final w = made.single;
    expect(w.calls, ['initialize', 'hosts', 'load']);
    expect(w.allowedHosts, isEmpty, reason: 'the content island loads nothing from the network');
    expect(w.loadedUrl, 'https://island.mastersat.example/content.html');
    expect(host.state, IslandHostState.loading);
    w.sayReady();
    await pumpEventQueue();
    expect(host.state, IslandHostState.ready);
    expect((events.single as IslandMessageEvent).message, isA<ReadyMessage>());
    await host.dispose();
    expect(w.disposed, isTrue);
    expect(host.state, IslandHostState.disposed);
  });

  test('the Desmos island may load the Desmos hosts and is ready on desmos.ready', () async {
    final host = TextureIslandHost(IslandKind.desmos, webviewFactory: factoryOf());
    await host.open();
    expect(made.single.allowedHosts, ['www.desmos.com', '*.desmos.com']);
    expect(made.single.loadedUrl, 'https://island.mastersat.example/desmos.html');
    made.single.say({'v': 1, 't': 'ready', 'build': 'x', 'protocol': 1});
    await pumpEventQueue();
    expect(host.state, IslandHostState.loading, reason: '`ready` is a content-island message');
    made.single.say({'v': 1, 't': 'desmos.ready', 'apiVersion': 'v1.11'});
    await pumpEventQueue();
    expect(host.state, IslandHostState.ready);
    await host.dispose();
  });

  test('a development islandFolder is mapped before the page loads', () async {
    final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf(), islandFolder: r'C:\dev\island');
    await host.open();
    expect(made.single.calls, ['initialize', 'map', 'hosts', 'load']);
    expect(made.single.mappedFolder, r'C:\dev\island');
    await host.dispose();
  });

  test('messages posted before ready wait in order, then go out once', () async {
    final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf());
    host.post(_init);
    await host.open();
    host.post(const QuestionShowMessage(
      qid: 7,
      index: 0,
      total: 3,
      eliminated: [],
      flagged: false,
      annotations: IslandAnnotationSet(passage: [], question: [], choices: []),
    ));
    expect(made.single.postedJson, isEmpty);
    expect(host.queuedMessages, 2);
    made.single.sayReady();
    await pumpEventQueue();
    expect(made.single.postedTypes, ['init', 'question.show']);
    host.post(const ViewSetMessage(zoom: 1.2));
    expect(made.single.postedTypes, ['init', 'question.show', 'view.set']);
    // The wire text is exactly the protocol encoding.
    expect(jsonDecode(made.single.postedJson.last), {'v': 1, 't': 'view.set', 'zoom': 1.2});
    await host.dispose();
  });

  test('the queue is bounded: the oldest message is dropped first', () async {
    final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf(), maxQueuedMessages: 2);
    host
      ..post(const ViewSetMessage(zoom: 1))
      ..post(const ViewSetMessage(zoom: 1.1))
      ..post(const ViewSetMessage(zoom: 1.2));
    await host.open();
    made.single.sayReady();
    await pumpEventQueue();
    expect([for (final j in made.single.postedJson) (jsonDecode(j) as Map)['zoom']], [1.1, 1.2]);
    await host.dispose();
  });

  test('wrong-island and wrong-direction posts are refused (assert in debug)', () async {
    final host = TextureIslandHost(IslandKind.desmos, webviewFactory: factoryOf());
    await host.open();
    expect(() => host.post(_init), throwsA(isA<AssertionError>()));
    expect(() => host.post(const ReadyMessage(build: 'x', protocol: 1)), throwsA(isA<AssertionError>()));
    expect(host.queuedMessages, 0);
    await host.dispose();
  });

  test('invalid page output is dropped, never delivered as a message', () async {
    final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf());
    final events = <IslandEvent>[];
    host.events.listen(events.add);
    await host.open();
    final w = made.single
      ..sayReady()
      ..say({'v': 1, 't': 'answer.choose', 'qid': 4, 'key': 'Z'})
      ..say('{not json')
      ..say({'v': 1, 't': 'desmos.ready', 'apiVersion': 'v1'})
      ..say({'v': 1, 't': 'answer.choose', 'qid': 4, 'key': 'C'});
    await pumpEventQueue();
    expect(events.whereType<IslandDroppedEvent>(), hasLength(3));
    final answers = events.whereType<IslandMessageEvent>().map((e) => e.message).whereType<AnswerChooseMessage>();
    expect(answers.single.key, 'C');
    expect(w.postedJson, isEmpty);
    await host.dispose();
  });

  test('a renderer crash recreates the island; the owner replays after the new ready', () async {
    final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf());
    final events = <IslandEvent>[];
    host.events.listen(events.add);
    await host.open();
    made.first.sayReady();
    await pumpEventQueue();
    made.first.failures.add(WebviewProcessFailure(WebviewProcessFailedKind.renderProcessExited.index, 0, 1));
    await pumpEventQueue();
    expect(events.whereType<IslandCrashedEvent>(), hasLength(1));
    expect(made, hasLength(2));
    expect(made.first.disposed, isTrue);
    expect(host.state, IslandHostState.loading);
    expect(host.recoveries, 1);
    // Messages for the dead page do not leak into the new one; new posts wait for ready.
    host.post(_init);
    // The old web view's late output is ignored.
    made.first.sayReady();
    await pumpEventQueue();
    expect(host.state, IslandHostState.loading);
    made.last.sayReady();
    await pumpEventQueue();
    expect(host.state, IslandHostState.ready);
    expect(made.last.postedTypes, ['init']);
    await host.dispose();
  });

  test('GPU or utility process exits are left to WebView2 (no recreation)', () async {
    final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf());
    await host.open();
    made.single.sayReady();
    for (final kind in [
      WebviewProcessFailedKind.gpuProcessExited,
      WebviewProcessFailedKind.utilityProcessExited,
      WebviewProcessFailedKind.frameRenderProcessExited,
    ]) {
      made.single.failures.add(WebviewProcessFailure(kind.index, 0, 0));
    }
    await pumpEventQueue();
    expect(made, hasLength(1));
    expect(host.state, IslandHostState.ready);
    await host.dispose();
  });

  test('crash loops stop after maxRecoveries within the window', () async {
    var clock = DateTime(2026, 10, 11, 9);
    final host = TextureIslandHost(
      IslandKind.content,
      webviewFactory: factoryOf(),
      maxRecoveries: 2,
      now: () => clock,
    );
    await host.open();
    for (var i = 0; i < 3; i++) {
      made.last.failures.add(WebviewProcessFailure(WebviewProcessFailedKind.browserProcessExited.index, 0, 0));
      await pumpEventQueue();
      clock = clock.add(const Duration(seconds: 5));
    }
    expect(made, hasLength(3), reason: 'two recreations, then it stays down');
    expect(host.state, IslandHostState.crashed);
    expect(host.problem.value, contains('crashed 2 times'));
    // After the window passes, a later crash recovers again.
    clock = clock.add(const Duration(minutes: 2));
    made.last.failures.add(WebviewProcessFailure(WebviewProcessFailedKind.renderProcessExited.index, 0, 0));
    await pumpEventQueue();
    expect(made, hasLength(4));
    await host.dispose();
  });

  test('initialize failure (no WebView2 runtime): crashed, reported, rethrown', () async {
    final host = TextureIslandHost(
      IslandKind.content,
      webviewFactory: factoryOf(failFirst: PlatformException(code: 'environment_creation_failed')),
    );
    final events = <IslandEvent>[];
    host.events.listen(events.add);
    await expectLater(host.open(), throwsA(isA<PlatformException>()));
    await pumpEventQueue();
    expect(host.state, IslandHostState.crashed);
    expect(events.single, isA<IslandCrashedEvent>());
    expect(host.problem.value, contains('could not start'));
    expect(() => host.open(), throwsStateError, reason: 'a host is opened once');
    await host.dispose();
  });

  test('no ready within readyTimeout: problem says so, state stays loading', () {
    fakeAsync((async) {
      final host = TextureIslandHost(
        IslandKind.content,
        webviewFactory: factoryOf(),
        readyTimeout: const Duration(seconds: 15),
      );
      host.open();
      async.flushMicrotasks();
      made.single.loadErrorEvents.add('load error: connectionAborted');
      expect(host.problem.value, 'load error: connectionAborted');
      async.elapse(const Duration(seconds: 16));
      expect(host.state, IslandHostState.loading);
      expect(host.problem.value, 'load error: connectionAborted', reason: 'the first problem is kept');
      made.single.sayReady();
      async.flushMicrotasks();
      expect(host.problem.value, isNull);
      expect(host.state, IslandHostState.ready);
      host.dispose();
      async.flushMicrotasks();
    });
  });

  test('ready timeout alone is reported', () {
    fakeAsync((async) {
      final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf());
      host.open();
      async.elapse(const Duration(seconds: 14));
      expect(host.problem.value, isNull);
      async.elapse(const Duration(seconds: 2));
      expect(host.problem.value, contains('did not say ready'));
      host.dispose();
      async.flushMicrotasks();
    });
  });

  test('setVisible before open is applied before the page loads; focus calls pass through', () async {
    final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf());
    await host.setVisible(false);
    await host.open();
    expect(made.single.calls, ['initialize', 'hosts', 'visible:false', 'load']);
    await host.setVisible(true);
    expect(made.single.visible, isTrue);
    made.single.sayReady();
    await pumpEventQueue();
    await host.focus();
    await host.releaseFocus();
    expect(made.single.calls, containsAllInOrder(['focus', 'releaseFocus']));
    expect(made.single.postedTypes, ['focus.release'], reason: 'the page drops its own focus too');
    await host.dispose();
  });

  test('capturePreview: PNG bytes, or null when the platform cannot', () async {
    final png = Uint8List.fromList([0x89, 0x50, 0x4E, 0x47]);
    final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf(preview: png));
    expect(await host.capturePreview(), isNull, reason: 'nothing to capture before open');
    await host.open();
    expect(await host.capturePreview(), png);
    await host.dispose();
    expect(await host.capturePreview(), isNull);

    made.clear();
    final noPreview = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf());
    await noPreview.open();
    expect(await noPreview.capturePreview(), isNull);
    await noPreview.dispose();
  });

  test('policy refusals are kept for diagnostics (at most 50)', () async {
    final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf());
    await host.open();
    for (var i = 0; i < 60; i++) {
      made.single.blockedEvents.add(WebviewBlockedEvent('navigation', 'https://example.com/$i'));
    }
    await pumpEventQueue();
    expect(host.blocked, hasLength(50));
    expect(host.blocked.first.uri, 'https://example.com/10');
    await host.dispose();
  });

  testWidgets('build shows the web view on the page background; nothing before open', (tester) async {
    final host = TextureIslandHost(IslandKind.content, webviewFactory: factoryOf());
    await tester.pumpWidget(Directionality(textDirection: TextDirection.ltr, child: Builder(builder: host.build)));
    expect(find.byKey(const ValueKey('fake-webview')), findsNothing);
    await tester.runAsync(host.open);
    await tester.pump();
    expect(find.byKey(const ValueKey('fake-webview')), findsOneWidget);
    final box = tester.widget<ColoredBox>(find.byType(ColoredBox).first);
    expect(box.color, const Color(0xFFFFFFFF));
    await tester.runAsync(host.dispose);
    await tester.pump();
    expect(find.byKey(const ValueKey('fake-webview')), findsNothing);
  });

  test('the island never shows a hand cursor', () {
    expect(islandCursorFor(SystemMouseCursors.click), SystemMouseCursors.basic);
    expect(islandCursorFor(SystemMouseCursors.text), SystemMouseCursors.text);
    expect(islandCursorFor(SystemMouseCursors.resizeColumn), SystemMouseCursors.resizeColumn);
  });
}
