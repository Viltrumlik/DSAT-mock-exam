// ContentIslandBridge: session state → protocol messages (init, module.load, media.put,
// question.show, state.patch, view.set) and island events → session actions, with the
// authoritative echo after every island-originated change.
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/exam/runner/content_island_bridge.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/island/fake_island_host.dart';
import 'package:mastersat_app/island/protocol.dart';

Future<void> settle() async {
  for (var i = 0; i < 10; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

class Rig {
  Rig(this.session, {bool scripted = true, double reserve = 0})
    : host = FakeIslandHost(IslandKind.content, scripted: scripted) {
    reservePx = reserve;
    bridge = ContentIslandBridge(
      session: session,
      host: host,
      calcReservePx: () => reservePx,
      extraView: extra,
      hideIsland: () => hidden,
      onSelection: selections.add,
      onSelectionClear: () => clears++,
      onAnnotClick: clicks.add,
      onKey: keys.add,
      onFocus: focus.add,
      onDiagnostic: (w, m) => diagnostics.add('$w: $m'),
      selectionTimeout: const Duration(milliseconds: 50),
    )..attach();
  }

  final FakeExamSession session;
  final FakeIslandHost host;
  late final ContentIslandBridge bridge;
  final ChangeNotifier extra = ChangeNotifier();
  double reservePx = 0;
  bool hidden = false;
  final List<SelectionMessage> selections = [];
  int clears = 0;
  final List<AnnotClickMessage> clicks = [];
  final List<String> keys = [];
  final List<bool> focus = [];
  final List<String> diagnostics = [];

  Future<void> open() async {
    await host.open();
    await settle();
  }

  List<String> get types => host.posted.map((m) => m.t).toList();

  T last<T extends IslandMessage>() => host.postedOf<T>().last;

  Future<void> emit(IslandMessage m) async {
    host.emit(m);
    await settle();
  }

  Future<void> dispose() async {
    await bridge.dispose();
    session.dispose();
  }
}

void main() {
  test('ready replays init → view.set (the input lock) → module.load → media.put → question.show', () async {
    final r = Rig(FakeExamSession.math(initialPhase: ExamPhase.running, tick: false));
    await r.open();
    expect(r.bridge.ready, isTrue);
    final types = r.types;
    expect(types.first, 'init');
    expect(types[1], 'view.set');
    expect(r.host.postedOf<ViewSetMessage>().first.inputLocked, isFalse);
    expect(types[2], 'module.load');
    expect(types.where((t) => t == 'media.put'), hasLength(5)); // q4 graph + q6's four choices
    expect(types.last, 'question.show');
    final init = r.host.postedOf<InitMessage>().single;
    expect(init.mode, 'exam');
    expect(init.kind, 'pastpaper');
    expect(init.subject, 'math');
    expect(init.overlays, 'native');
    expect(init.zoom, 1.0);
    final load = r.host.postedOf<ModuleLoadMessage>().single;
    expect(load.moduleId, 301);
    expect(load.questions, hasLength(6));
    final show = r.last<QuestionShowMessage>();
    expect(show.qid, 1001);
    expect(show.index, 0);
    expect(show.total, 6);
    expect(r.bridge.shownQuestionId, 1001);
    await r.dispose();
  });

  test('the R&W resume shows saved answers, flags and highlights in question.show', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    final init = r.host.postedOf<InitMessage>().single;
    expect(init.subject, 'rw');
    final show = r.last<QuestionShowMessage>();
    expect(show.qid, 2001);
    expect(show.answer, 'B');
    expect(show.flagged, isFalse);
    expect(
      show.annotations.passage.length + show.annotations.question.length + show.annotations.choices.length,
      greaterThan(0),
    );
    r.session.goTo(2);
    await settle();
    final third = r.last<QuestionShowMessage>();
    expect(third.qid, 2003);
    expect(third.flagged, isTrue);
    expect(third.answer, isNull);
    await r.dispose();
  });

  test('answer.choose selects, then echoes the authoritative state', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    r.host.posted.clear();
    await r.emit(const AnswerChooseMessage(qid: 2001, key: 'C'));
    expect(r.session.answerFor(2001), 'C');
    final patches = r.host.postedOf<StatePatchMessage>();
    expect(patches, hasLength(1), reason: 'one echo, not an extra diff patch');
    expect(patches.single.qid, 2001);
    expect(patches.single.answer, 'C');
    expect(patches.single.flagged, isFalse);
    expect(patches.single.eliminated, isEmpty);
    await r.dispose();
  });

  test('a refused change (input locked) is painted back by the echo', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    r.session.openReview(); // Check Your Work locks input
    await settle();
    r.host.posted.clear();
    await r.emit(const AnswerChooseMessage(qid: 2001, key: 'D'));
    expect(r.session.answerFor(2001), 'B');
    final echo = r.host.postedOf<StatePatchMessage>().single;
    expect(echo.answer, 'B');
    await r.dispose();
  });

  test('answer.input: a valid grid-in is stored, an invalid one refused, "" clears', () async {
    final r = Rig(FakeExamSession.math(initialPhase: ExamPhase.running, tick: false));
    await r.open();
    r.session.goTo(1); // 1002 is a grid-in
    await settle();
    await r.emit(const AnswerInputMessage(qid: 1002, value: '-3/4'));
    expect(r.session.answerFor(1002), '-3/4');
    await r.emit(const AnswerInputMessage(qid: 1002, value: '123456'));
    expect(r.session.answerFor(1002), '-3/4');
    expect(r.last<StatePatchMessage>().answer, '-3/4');
    await r.emit(const AnswerInputMessage(qid: 1002, value: ''));
    expect(r.session.answerFor(1002), isNull);
    expect(r.last<StatePatchMessage>().answer, '');
    await r.dispose();
  });

  test('answer.eliminate is idempotent per (key, on); flag.toggle flips', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    await r.emit(const AnswerEliminateMessage(qid: 2001, key: 'A', on: true));
    await r.emit(const AnswerEliminateMessage(qid: 2001, key: 'A', on: true));
    expect(r.session.eliminatedFor(2001), {'A'});
    expect(r.last<StatePatchMessage>().eliminated, ['A']);
    await r.emit(const AnswerEliminateMessage(qid: 2001, key: 'A', on: false));
    expect(r.session.eliminatedFor(2001), isEmpty);
    await r.emit(const FlagToggleMessage(qid: 2001));
    expect(r.session.isFlagged(2001), isTrue);
    expect(r.last<StatePatchMessage>().flagged, isTrue);
    await r.dispose();
  });

  test('changes made natively (keyboard A–D, M) go out as a minimal state.patch', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    r.host.posted.clear();
    r.session.select(2001, 'D');
    await settle();
    final p = r.host.postedOf<StatePatchMessage>().single;
    expect(p.answer, 'D');
    expect(p.flagged, isNull);
    expect(p.eliminated, isNull);
    r.session.toggleFlag(2001);
    await settle();
    final f = r.last<StatePatchMessage>();
    expect(f.flagged, isTrue);
    expect(f.answer, isNull);
    await r.dispose();
  });

  test('navigation sends question.show only', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    r.host.posted.clear();
    r.session.next();
    await settle();
    expect(r.types, ['question.show']);
    expect(r.last<QuestionShowMessage>().index, 1);
    await r.dispose();
  });

  test('view.set carries only what changed: zoom, highlighter, eliminator, calcReserve', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    r.host.posted.clear();
    r.session.setZoom(1.2);
    await settle();
    final z = r.last<ViewSetMessage>();
    expect(z.zoom, closeTo(1.2, 1e-9));
    expect(z.highlighterOn, isNull);
    r.session.toggleHighlighter();
    await settle();
    expect(r.last<ViewSetMessage>().highlighterOn, isTrue);
    r.reservePx = 500;
    // ignore: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member
    r.extra.notifyListeners();
    await settle();
    expect(r.last<ViewSetMessage>().calcReservePx, 500);
    await r.dispose();
  });

  test('eliminator.toggle: an accepted toggle sends nothing back, a refused one is reverted', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    r.host.posted.clear();
    await r.emit(const EliminatorToggleMessage());
    expect(r.session.eliminatorOn, isTrue);
    expect(r.host.postedOf<ViewSetMessage>(), isEmpty);
    r.session.openReview();
    await settle();
    r.host.posted.clear();
    await r.emit(const EliminatorToggleMessage());
    expect(r.session.eliminatorOn, isTrue, reason: 'refused while input is locked');
    expect(r.host.postedOf<ViewSetMessage>().last.eliminatorOn, isTrue);
    await r.dispose();
  });

  test('split.changed and annot.changed reach the session', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    r.host.posted.clear();
    await r.emit(const SplitChangedMessage(split: 0.6));
    expect(r.session.split, closeTo(0.6, 1e-9));
    expect(r.host.postedOf<ViewSetMessage>(), isEmpty);
    await r.emit(
      const AnnotChangedMessage(
        qid: 2001,
        container: 'passage',
        list: [IslandAnnotation(start: 2, end: 9, kind: 'highlight', color: 'pink')],
      ),
    );
    final list = r.session.annotationsFor(2001)[AnnotationContainer.passage]!;
    expect(list.single.color, HighlightColor.pink);
    expect(r.session.log.last, 'recordAnnotations 2001 passage');
    // Not a live question: ignored.
    await r.emit(const AnnotChangedMessage(qid: 9999, container: 'passage', list: []));
    expect(r.session.log.last, 'recordAnnotations 2001 passage');
    await r.dispose();
  });

  test('selection, selection.clear, annot.click, key and focus go to the callbacks', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    await r.emit(
      const SelectionMessage(
        selectionId: 's1',
        qid: 2001,
        container: 'passage',
        start: 0,
        end: 4,
        text: 'Mira',
        rect: IslandRect(x: 10, y: 20, w: 30, h: 16),
      ),
    );
    await r.emit(const SelectionClearMessage());
    await r.emit(
      const AnnotClickMessage(
        annotId: 'a1',
        qid: 2001,
        container: 'passage',
        rect: IslandRect(x: 1, y: 2, w: 3, h: 4),
        current: IslandAnnotationStyle(color: 'yellow'),
      ),
    );
    await r.emit(const KeyMessage(key: 'ArrowRight'));
    await r.emit(const FocusMessage(inIsland: true));
    expect(r.selections.single.selectionId, 's1');
    expect(r.clears, 1);
    expect(r.clicks.single.annotId, 'a1');
    expect(r.keys, ['ArrowRight']);
    expect(r.focus, [true]);
    await r.dispose();
  });

  test('applyAnnotation posts annot.apply; currentSelection round-trips selection.get', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    r.bridge.applyAnnotation(selectionId: 's1', op: 'highlight', color: HighlightColor.blue);
    final apply = r.last<AnnotApplyMessage>();
    expect(apply.selectionId, 's1');
    expect(apply.op, 'highlight');
    expect(apply.color, 'blue');
    final sel = await r.bridge.currentSelection();
    expect(sel.qid, 2001);
    expect(sel.isEmpty, isTrue);
    expect(r.host.postedOf<SelectionGetMessage>(), hasLength(1));
    await r.dispose();
  });

  test('currentSelection gives up after the timeout when the page never answers', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false), scripted: false);
    await r.host.open();
    r.host.emit(const ReadyMessage(build: 't', protocol: islandProtocolVersion));
    await settle();
    final sel = await r.bridge.currentSelection();
    expect(sel.isEmpty, isTrue);
    await r.dispose();
  });

  test('a crash resets the island; the next ready replays everything', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    r.session.goTo(3);
    await settle();
    await r.host.simulateCrash();
    await settle();
    expect(r.host.postedOf<InitMessage>(), hasLength(2));
    expect(r.host.postedOf<ModuleLoadMessage>(), hasLength(2));
    expect(r.last<QuestionShowMessage>().qid, 2004);
    expect(r.diagnostics.any((d) => d.contains('crashed')), isTrue);
    await r.dispose();
  });

  test('the island is visible only while answering, and hidden for the freeze-frame', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    expect(r.host.visible, isTrue);
    r.session.openReview();
    await settle();
    expect(r.host.visible, isFalse);
    r.session.goTo(0);
    await settle();
    expect(r.host.visible, isTrue);
    r.hidden = true;
    r.bridge.refresh();
    expect(r.host.visible, isFalse);
    r.hidden = false;
    r.bridge.refresh();
    expect(r.host.visible, isTrue);
    await r.dispose();
  });

  test('inputLocked follows the session (Check Your Work)', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    r.session.openReview();
    await settle();
    expect(r.last<ViewSetMessage>().inputLocked, isTrue);
    r.session.goTo(0);
    await settle();
    expect(r.last<ViewSetMessage>().inputLocked, isFalse);
    await r.dispose();
  });

  test('a runner attaching to a page the last one left locked unlocks it (midterm module 2)', () async {
    // Module 1 ends locked (0:00, the transition); module 2's runner gets the same page, which
    // already said `ready` — the bridge replays without one, and the page keeps its lock
    // through `init`. The 0.3.0 MacBook app left every module-2 choice and highlight dead.
    final first = Rig(FakeExamSession.readingWriting(tick: false));
    await first.open();
    first.session.openReview();
    await settle();
    expect(first.last<ViewSetMessage>().inputLocked, isTrue);
    await first.bridge.dispose();

    final session = FakeExamSession.readingWriting(tick: false);
    final before = first.host.posted.length;
    final second = ContentIslandBridge(session: session, host: first.host)..attach();
    await settle();
    final replay = first.host.posted.skip(before).toList();
    expect(replay.first, isA<InitMessage>());
    expect(replay.whereType<ViewSetMessage>().map((m) => m.inputLocked).whereType<bool>(), [false]);
    await second.dispose();
    session.dispose();
    first.session.dispose();
  });

  test('module 2 is loaded after the hand-in (past paper)', () async {
    final s = FakeExamSession.readingWriting(tick: false);
    final r = Rig(s);
    await r.open();
    unawaited(s.submitModule());
    await Future<void>.delayed(const Duration(milliseconds: 350));
    await settle();
    expect(s.moduleId, 312);
    final loads = r.host.postedOf<ModuleLoadMessage>();
    expect(loads.last.moduleId, 312);
    expect(r.last<QuestionShowMessage>().qid, 2011);
    await r.dispose();
  });

  test('invalid page output and page errors are reported, not acted on', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    r.host.emitRaw({'v': 1, 't': 'answer.choose', 'qid': 'x'});
    await r.emit(const ErrorMessage(where: 'katex', message: 'bad'));
    expect(r.diagnostics.any((d) => d.startsWith('island: dropped')), isTrue);
    expect(r.diagnostics, contains('island:katex: bad'));
    expect(r.session.answerFor(2001), 'B');
    await r.dispose();
  });

  test('nothing is posted after dispose', () async {
    final r = Rig(FakeExamSession.readingWriting(tick: false));
    await r.open();
    await r.bridge.dispose();
    final n = r.host.posted.length;
    r.session.next();
    await settle();
    expect(r.host.posted.length, n);
    r.session.dispose();
  });
}
