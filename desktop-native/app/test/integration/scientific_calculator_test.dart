// A Scientific-only paper (a junior Math midterm) with the app's wiring
// (`nativeScientificOnly: false`, passed by both sittings): the calculator is Desmos's
// Scientific calculator, as on the website — the native scientific calculator appears only
// when Desmos cannot load (offline, script error, timeout). The default (true) is shown too,
// so the difference the flag makes is pinned.
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/island/protocol.dart';

import '../exam/runner/support/runner_harness.dart';

FakeExamSession juniorMidterm() {
  final json = jsonDecode(jsonEncode(FixtureV1Api.fixture('midterm_open.response.json'))) as Map<String, Object?>;
  ((json['test']! as Map)['tools']! as Map)['calculator'] = 'scientific';
  return FakeExamSession(
    bundle: ExamBundle.fromJson(JsonReader.of(json)),
    initialPhase: ExamPhase.running,
    tick: false,
  );
}

void main() {
  setUpAll(loadRunnerFonts);

  testWidgets('nativeScientificOnly: false → Desmos Scientific; the native one only when Desmos fails', (tester) async {
    final session = juniorMidterm();
    expect(session.scientificOnly, isTrue);
    final h = await RunnerHarness.pump(tester, session: session, nativeScientificOnly: false);

    await tester.tap(find.byKey(const ValueKey('header.calculator')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(h.desmosHosts, hasLength(1), reason: 'the Desmos island is created');
    final desmos = h.desmosHosts.single;
    expect(desmos.postedOf<DesmosInitMessage>().single.mode, 'scientific');
    expect(find.text('Scientific Calculator'), findsOneWidget);
    expect(find.byKey(const ValueKey('calc.tab.graphing')), findsNothing, reason: 'no Graphing tab');
    expect(find.byKey(const ValueKey('calc.island')), findsOneWidget);
    expect(find.byKey(const ValueKey('calc.scientific')), findsNothing);

    // Offline: Desmos says it failed → the native scientific calculator takes over.
    desmos.emit(const DesmosFailedMessage(reason: 'offline'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byKey(const ValueKey('calc.scientific')), findsOneWidget);
    expect(find.byKey(const ValueKey('calc.island')), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    session.dispose();
  });

  testWidgets('the default (true) skips Desmos on a Scientific-only paper', (tester) async {
    final session = juniorMidterm();
    final h = await RunnerHarness.pump(tester, session: session);
    await tester.tap(find.byKey(const ValueKey('header.calculator')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(h.desmosHosts.where((d) => d.opens > 0), isEmpty);
    expect(find.byKey(const ValueKey('calc.scientific')), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    session.dispose();
  });
}
