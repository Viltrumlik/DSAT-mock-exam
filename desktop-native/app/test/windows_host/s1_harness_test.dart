// The S1 harness over FakeIslandHost: the timing run, the results JSON, protocol echoes, crash
// replay, power events, lockdown, and the screen.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' hide KeyMessage;
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/island/fake_island_host.dart';
import 'package:mastersat_app/island/protocol.dart';
import 'package:mastersat_app/island/s1_harness.dart';
import 'package:mastersat_app/native/native_bridge.dart';
import 'package:path/path.dart' as p;

class FakeLockdown implements S1Lockdown {
  FakeLockdown({this.failWith});
  final NativeBridgeException? failWith;
  final List<String> calls = [];
  bool lockedNative = false;
  bool watchdogReleased = false;

  @override
  String get description => 'fake lockdown';

  @override
  String enter() {
    calls.add('enter');
    final f = failWith;
    if (f != null) throw f;
    lockedNative = true;
    return '{"ok":true,"displays":1,"remote":false,"vm":false,"apps":[]}';
  }

  @override
  void exit() {
    calls.add('exit');
    lockedNative = false;
  }

  @override
  bool heartbeat() {
    calls.add('heartbeat');
    return lockedNative && !watchdogReleased;
  }
}

/// Answers the first question.show late (after the harness gave up on it) and later ones on time.
class LateIslandHost extends FakeIslandHost {
  LateIslandHost(super.kind) : super(scripted: false);
  int shows = 0;

  @override
  Future<void> open() async {
    await super.open();
    emit(const ReadyMessage(build: 'late', protocol: 1));
  }

  @override
  void post(IslandMessage message) {
    super.post(message);
    switch (message) {
      case ModuleLoadMessage(:final moduleId):
        emit(ModuleLoadedMessage(moduleId: moduleId, ms: 1, failed: const []));
      case QuestionShowMessage(:final qid):
        final n = ++shows;
        Timer(Duration(milliseconds: n == 1 ? 45 : 20), () => emit(QuestionShownMessage(qid: qid, ms: n.toDouble())));
      default:
        break;
    }
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tmp;
  late List<FakeIslandHost> hosts;
  final png = Uint8List.fromList([0x89, 0x50, 0x4E, 0x47, 1, 2, 3]);

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('s1-');
    hosts = [];
  });
  tearDown(() async => tmp.delete(recursive: true));

  S1Controller controller({S1Lockdown? lockdown, int next = 6, Uint8List? preview}) => S1Controller(
    hostFactory: (kind) {
      final h = FakeIslandHost(kind, preview: preview);
      hosts.add(h);
      return h;
    },
    lockdown: lockdown,
    resultsDirectory: tmp,
    nextIterations: next,
    waitTimeout: const Duration(milliseconds: 200),
    lockdownAutoRelease: const Duration(seconds: 30),
  );

  Map<String, Object?> results() =>
      (jsonDecode(File(p.join(tmp.path, s1ResultsFileName)).readAsStringSync()) as Map).cast<String, Object?>();

  test('flag, fixtures, percentiles, mime types', () {
    expect(isS1HarnessLaunch(['--s1-harness']), isTrue);
    expect(isS1HarnessLaunch(['mastersat://auth?code=1']), isFalse);
    final modules = S1Module.fixtures();
    expect([for (final m in modules) m.subject], ['rw', 'math']);
    expect(modules.first.questions, hasLength(6));
    expect(modules.last.questions, hasLength(6));
    expect(modules.first.media, isNotEmpty, reason: 'the R&W fixture carries a chart image');
    expect(modules.last.media.length, greaterThanOrEqualTo(5));
    expect(modules.last.media.values.first.bytes.sublist(0, 4), [0x89, 0x50, 0x4E, 0x47]);
    expect(s1Percentile([], .95), isNull);
    expect(s1Percentile([5], .95), 5);
    expect(s1Percentile([for (var i = 1; i <= 100; i++) i.toDouble()], .95), 95);
    expect(s1Percentile([for (var i = 1; i <= 40; i++) i.toDouble()], .95), 38);
    expect(s1Percentile([3, 1, 2], .5), 2);
    expect(s1MimeFor('a/b.png'), 'image/png');
    expect(s1MimeFor('a/b.JPG'), 'image/jpeg');
    expect(s1MimeFor('x.svg'), 'image/svg+xml');
  });

  testWidgets('the timing run drives both subjects and writes the results + island pixels', (tester) async {
    final c = controller(preview: png);
    await tester.runAsync(c.start);
    expect(c.phase, S1Phase.interactive, reason: c.problems.join('\n'));
    final host = hosts.single;
    expect(host.opens, 1);

    // Each subject: init, its media, module.load, then 1 + 6 question.show.
    final inits = host.postedOf<InitMessage>();
    expect([for (final i in inits) i.subject], ['rw', 'math', 'rw']);
    expect(host.postedOf<ModuleLoadMessage>().map((m) => m.moduleId), [311, 301, 311]);
    expect(host.postedOf<MediaPutMessage>().length, greaterThanOrEqualTo(6));
    expect(host.postedOf<QuestionShowMessage>().length, 2 * 7 + 1);
    // Media goes before the module that uses it.
    final firstLoad = host.posted.indexWhere((m) => m is ModuleLoadMessage);
    expect(host.posted.take(firstLoad).whereType<MediaPutMessage>(), isNotEmpty);

    final r = results();
    expect(r['harness'], 's1');
    expect(r['host'], 'FakeIslandHost');
    final timings = r['timings']! as Map;
    expect(timings['readyMs'], isA<num>());
    final subjects = timings['subjects']! as Map;
    expect(subjects.keys, ['rw', 'math']);
    final rwNext = (subjects['rw']! as Map)['next']! as Map;
    expect(rwNext['n'], 6);
    expect(rwNext['p95'], isA<num>());
    expect(rwNext['timeouts'], 0);
    expect((r['pass']! as Map)['started'], isTrue);
    expect((r['pass']! as Map)['nextP95'], isTrue, reason: 'a fake island answers at once');
    expect((r['lockdown']! as Map)['available'], isFalse);
    expect((r['manual']! as Map).length, s1Checklist.length);
    expect(r['problems'], isEmpty);
    final preview = r['preview']! as Map;
    expect(File(preview['path']! as String).readAsBytesSync(), png);
    expect(p.basename(preview['path']! as String), s1PreviewFileName);
    c.dispose();
  });

  testWidgets('an island that never answers: timeouts are counted, not hung on', (tester) async {
    final c = S1Controller(
      hostFactory: (kind) {
        final h = FakeIslandHost(kind, scripted: false);
        hosts.add(h);
        // Say ready, then nothing else.
        Future<void>.delayed(Duration.zero, () => h.emit(const ReadyMessage(build: 'mute', protocol: 1)));
        return h;
      },
      lockdown: null,
      resultsDirectory: tmp,
      nextIterations: 2,
      waitTimeout: const Duration(milliseconds: 20),
    );
    await tester.runAsync(c.start);
    final rw = c.timings['rw']!;
    expect(rw.timeouts, 2);
    expect(rw.firstRenderMs, isNull);
    expect(c.problems.any((t) => t.contains('no module.loaded')), isTrue);
    expect((results()['pass']! as Map)['nextP95'], isNull);
    c.dispose();
  });

  testWidgets('a late question.shown belongs to its own show, not to a newer show of the same question', (
    tester,
  ) async {
    final rw = S1Module.fixtures().first;
    final c = S1Controller(
      hostFactory: LateIslandHost.new,
      lockdown: null,
      resultsDirectory: tmp,
      modules: [
        S1Module(
          subject: 'rw',
          label: 'One question',
          moduleId: rw.moduleId,
          questions: [rw.questions.first],
          media: const {},
        ),
      ],
      nextIterations: 1,
      waitTimeout: const Duration(milliseconds: 30),
    );
    await tester.runAsync(() async {
      await c.start();
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    final t = c.timings['rw']!;
    expect(t.firstRenderMs, isNull, reason: 'show 1 was answered after the 30 ms wait');
    expect(t.islandNextMs, [2.0], reason: "show 2 got show 2's answer, not show 1's late one");
    c.dispose();
  });

  testWidgets('no ready at all: failed, and the results still say why', (tester) async {
    final c = S1Controller(
      hostFactory: (kind) => FakeIslandHost(kind, scripted: false),
      lockdown: null,
      resultsDirectory: tmp,
      readyTimeout: const Duration(milliseconds: 50),
    );
    await tester.runAsync(c.start);
    expect(c.phase, S1Phase.failed);
    expect((results()['pass']! as Map)['started'], isFalse);
    expect(results()['problems'], isNotEmpty);
    c.dispose();
  });

  testWidgets('page actions are echoed as state.patch / view.set, like the engine will', (tester) async {
    final c = controller(next: 1);
    await tester.runAsync(c.start);
    final host = hosts.single;
    final qid = c.question.id;
    host.emit(AnswerChooseMessage(qid: qid, key: 'B'));
    host.emit(AnswerEliminateMessage(qid: qid, key: 'C', on: true));
    host.emit(FlagToggleMessage(qid: qid));
    host.emit(const EliminatorToggleMessage());
    final patches = host.postedOf<StatePatchMessage>();
    expect(patches[0].answer, 'B');
    expect(patches[1].eliminated, ['C']);
    expect(patches[2].flagged, isTrue);
    expect(host.postedOf<ViewSetMessage>().last.eliminatorOn, isTrue);

    // The answer, elimination and flag come back with the question.
    await tester.runAsync(c.next);
    await tester.runAsync(c.back);
    final shown = host.postedOf<QuestionShowMessage>().last;
    expect(shown.qid, qid);
    expect(shown.answer, 'B');
    expect(shown.eliminated, ['C']);
    expect(shown.flagged, isTrue);

    // A selection gets the marker; Highlight applies it; the island's merged list is kept.
    host.emit(
      SelectionMessage(
        selectionId: 's1',
        qid: qid,
        container: 'passage',
        start: 3,
        end: 9,
        text: 'sample',
        rect: const IslandRect(x: 10, y: 20, w: 30, h: 12),
      ),
    );
    expect(c.selection?.selectionId, 's1');
    c.highlightSelection();
    final apply = host.postedOf<AnnotApplyMessage>().single;
    expect((apply.selectionId, apply.op, apply.color), ('s1', 'highlight', 'yellow'));
    host.emit(
      AnnotChangedMessage(
        qid: qid,
        container: 'passage',
        list: const [IslandAnnotation(start: 3, end: 9, kind: 'highlight', color: 'yellow')],
      ),
    );
    await tester.runAsync(c.next);
    await tester.runAsync(c.back);
    expect(host.postedOf<QuestionShowMessage>().last.annotations.passage.single.end, 9);

    // Arrow keys from the island move between questions.
    final before = c.questionIndex;
    host.emit(const KeyMessage(key: 'ArrowRight'));
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    expect(c.questionIndex, (before + 1) % c.module.questions.length);

    // Highlighter and zoom reach the island; zoom stays in the website's range.
    c.toggleHighlighter();
    expect(host.postedOf<ViewSetMessage>().last.highlighterOn, isTrue);
    c.setZoom(2.4);
    expect(c.zoom, 1.6);
    expect(host.postedOf<ViewSetMessage>().last.zoom, 1.6);
    c.dispose();
  });

  testWidgets('after a crash the island is replayed from the harness state', (tester) async {
    final c = controller(next: 1);
    await tester.runAsync(c.start);
    final host = hosts.single;
    await tester.runAsync(c.next);
    final index = c.questionIndex;
    final loadsBefore = host.postedOf<ModuleLoadMessage>().length;
    await tester.runAsync(() async {
      await host.simulateCrash();
      await Future<void>.delayed(const Duration(milliseconds: 10));
    });
    expect(c.crashes, 1);
    expect(host.postedOf<ModuleLoadMessage>().length, loadsBefore + 1);
    expect(host.postedOf<QuestionShowMessage>().last.index, index);
    c.dispose();
  });

  testWidgets('power events are recorded and the island is checked after wake', (tester) async {
    final c = controller(next: 1);
    await tester.runAsync(c.start);
    final call = const StandardMethodCodec().encodeMethodCall(
      const MethodCall('resumed', {'event': 'resumed', 'wallClockMs': 1, 'tickMs': 2}),
    );
    await tester.runAsync(() async {
      await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.handlePlatformMessage(
        'mastersat/power',
        call,
        (_) {},
      );
      await Future<void>.delayed(const Duration(milliseconds: 2300));
    });
    expect(c.powerEvents.single.event, 'resumed');
    expect(c.powerEvents.single.islandAnswered, isTrue);
    await tester.runAsync(c.writeResults);
    expect(((results()['powerEvents']! as List).single as Map)['islandAnswered'], isTrue);
    c.dispose();
  });

  testWidgets('lockdown: on with a heartbeat, off by hand, by the watchdog, or after the time limit', (tester) async {
    final lock = FakeLockdown();
    final c = controller(lockdown: lock, next: 1);
    await tester.runAsync(c.start);
    await c.toggleLockdown();
    expect(c.locked, isTrue);
    expect(c.precheck, contains('"ok":true'));
    await tester.pump(const Duration(seconds: 7));
    expect(lock.calls.where((x) => x == 'heartbeat'), hasLength(2));
    await c.toggleLockdown();
    expect(c.locked, isFalse);
    expect(lock.calls.last, 'exit');

    // The watchdog released it (no heartbeat answered): the harness notices.
    await c.toggleLockdown();
    lock.watchdogReleased = true;
    await tester.pump(const Duration(seconds: 3));
    expect(c.locked, isFalse);
    lock.watchdogReleased = false;

    // Two-minute safety (30 s here).
    await c.toggleLockdown();
    expect(c.locked, isTrue);
    await tester.pump(const Duration(seconds: 31));
    expect(c.locked, isFalse);
    expect(lock.lockedNative, isFalse);
    c.dispose();
  });

  testWidgets('lockdown refused by the pre-check says so; disposing never leaves it on', (tester) async {
    final refused = FakeLockdown(
      failWith: const NativeBridgeException(NativeStatus.errPrecheck, 'ms_lock_enter', '{"ok":false,"vm":true}'),
    );
    final c = controller(lockdown: refused, next: 1);
    await tester.runAsync(c.start);
    await c.toggleLockdown();
    expect(c.locked, isFalse);
    expect(c.lockdownError, startsWith('This computer is not ready for lockdown'));
    c.dispose();

    final lock = FakeLockdown();
    final c2 = controller(lockdown: lock, next: 1);
    await tester.runAsync(c2.start);
    await c2.toggleLockdown();
    c2.dispose();
    expect(lock.lockedNative, isFalse);
  });

  testWidgets('the screen: toolbar, timing, checklist ticks saved into the results', (tester) async {
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final c = controller(next: 2);
    await tester.pumpWidget(S1HarnessApp(controller: c, autoStart: false));
    await tester.runAsync(c.start);
    await tester.pump();
    expect(find.text('S1 harness'), findsOneWidget);
    expect(find.text('Reading and Writing'), findsWidgets);
    expect(find.text('Lockdown not in this build'), findsOneWidget);
    expect(find.text('Drawn by Flutter over the card'), findsOneWidget);
    expect(find.textContaining('Next question p95'), findsNWidgets(2));
    for (final item in s1Checklist) {
      expect(find.text(item.text), findsOneWidget);
    }
    await tester.ensureVisible(find.text(s1Checklist.first.text));
    await tester.pump();
    await tester.tap(find.text(s1Checklist.first.text));
    await tester.pump();
    expect(c.manual[s1Checklist.first.id], isTrue);

    await tester.tap(find.text('Next'));
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();
    expect(find.text('Question 2 of 6'), findsOneWidget);

    await tester.tap(find.descendant(of: find.byType(SegmentedButton<int>), matching: find.text('Math')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 10)));
    await tester.pump();
    expect(c.module.subject, 'math');

    final savedBefore = File(p.join(tmp.path, s1ResultsFileName)).lastModifiedSync();
    await tester.tap(find.text('Save results'));
    // The write started inside the test's fake zone: let real I/O and the fake clock both run.
    for (
      var i = 0;
      i < 20 && results()['manual'] is Map && (results()['manual']! as Map)[s1Checklist.first.id] != true;
      i++
    ) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump(const Duration(milliseconds: 20));
    }
    expect(File(p.join(tmp.path, s1ResultsFileName)).lastModifiedSync().isBefore(savedBefore), isFalse);
    expect((results()['manual']! as Map)[s1Checklist.first.id], isTrue);
    await tester.pumpWidget(const SizedBox());
  });
}
