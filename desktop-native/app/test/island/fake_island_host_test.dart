import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/island/fake_island_host.dart';
import 'package:mastersat_app/island/island_host.dart';
import 'package:mastersat_app/island/protocol.dart';
import 'package:mastersat_app/island/protocol_convert.dart';

void main() {
  test('scripted content island: ready, module.loaded, question.shown, selection.current', () async {
    final host = FakeIslandHost(IslandKind.content);
    final events = <IslandEvent>[];
    host.events.listen(events.add);
    await host.open();
    expect(host.state, IslandHostState.ready);
    expect((events.single as IslandMessageEvent).message, isA<ReadyMessage>());

    final session = FakeExamSession.readingWriting(tick: false);
    host.post(moduleLoadMessage(session.moduleId, session.questions));
    host.post(QuestionShowMessage(
      qid: session.currentQuestion.id,
      index: 0,
      total: session.questions.length,
      answer: session.answerFor(session.currentQuestion.id),
      eliminated: const [],
      flagged: false,
      annotations: islandAnnotationSet(session.annotationsFor(session.currentQuestion.id)),
    ));
    host.post(const SelectionGetMessage(req: 7));
    final types = events.whereType<IslandMessageEvent>().map((e) => e.message.t).toList();
    expect(types, ['ready', 'module.loaded', 'question.shown', 'selection.current']);
    expect(host.postedOf<QuestionShowMessage>().single.annotations.passage, hasLength(2));
    session.dispose();
    await host.dispose();
  });

  test('wrong-direction or wrong-island posts are refused', () async {
    final host = FakeIslandHost(IslandKind.desmos);
    await host.open();
    expect(() => host.post(const InitMessage(mode: 'exam', kind: 'pastpaper', subject: 'rw', overlays: 'native',
        zoom: 1, split: .5, highlighterOn: false, eliminatorOn: false, calcReservePx: 0)), throwsA(isA<AssertionError>()));
    expect(host.posted, isEmpty);
    await host.dispose();
  });

  test('invalid page output is dropped, never delivered as a message', () async {
    final host = FakeIslandHost(IslandKind.content, scripted: false);
    final events = <IslandEvent>[];
    host.events.listen(events.add);
    host.emitRaw({'v': 1, 't': 'answer.choose', 'qid': 1, 'key': 'Z'});
    host.emitRaw('not json');
    host.emitRaw({'v': 1, 't': 'answer.choose', 'qid': 1, 'key': 'B'});
    expect(events.whereType<IslandDroppedEvent>(), hasLength(2));
    expect(events.whereType<IslandMessageEvent>().single.message, isA<AnswerChooseMessage>());
    await host.dispose();
  });

  test('crash → crashed event → ready again (owner replays)', () async {
    final host = FakeIslandHost(IslandKind.content);
    final events = <IslandEvent>[];
    host.events.listen(events.add);
    await host.open();
    await host.simulateCrash();
    expect(events.map((e) => e.runtimeType.toString()), ['IslandMessageEvent', 'IslandCrashedEvent', 'IslandMessageEvent']);
    expect(host.opens, 2);
    await host.dispose();
  });

  test('desmos state round trip through the scripted page', () async {
    final host = FakeIslandHost(IslandKind.desmos);
    final got = <IslandMessage>[];
    host.messages.listen(got.add);
    await host.open();
    host.post(const DesmosInitMessage(mode: 'graphing', state: {'version': 11}));
    host.post(const DesmosGetStateMessage(req: 3));
    expect(got.last, isA<DesmosStateMessage>().having((m) => m.state, 'state', {'version': 11}));
    await host.dispose();
  });

  testWidgets('build() renders a labelled placeholder', (tester) async {
    final host = FakeIslandHost(IslandKind.content);
    await host.open();
    host.post(const QuestionShowMessage(qid: 9, index: 2, total: 27, answer: null, eliminated: [], flagged: false,
        annotations: IslandAnnotationSet(passage: [], question: [], choices: [])));
    await tester.pumpWidget(Directionality(textDirection: TextDirection.ltr, child: Builder(builder: host.build)));
    expect(find.text('Content island — Question 3 of 27 (#9)'), findsOneWidget);
    await host.dispose();
  });

  test('annotation conversions are lossless', () {
    const a = Annotation(start: 3, end: 9, kind: AnnotationKind.underline, underline: UnderlineStyle.dotted);
    expect(a.toIsland().toModel(), a);
    expect(a.toIsland().toJson(), a.toJson());
  });
}
