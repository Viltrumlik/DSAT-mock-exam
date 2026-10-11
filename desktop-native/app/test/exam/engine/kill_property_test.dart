// Property: a process kill at any point between two clicks loses ZERO answers.
//
// 200 random sequences (seeded, reproducible). Each one sits a paper on a real SQLite file —
// past papers mostly, every fourth one a midterm — doing random selects, clears, flags,
// navigation, time passing, the network dropping and coming back, slow replies (so kills land
// with requests on the wire), module hand-ins, and kills: the engine, its outbox senders and the
// database connection all die without a goodbye, and a fresh engine is rebuilt from the file.
//
// After every rebuild the reopened sitting must show exactly the work the student did (answers
// and flags, every module); at the end, back online, the SERVER must hold exactly that work too.
// A failure prints the seed and the operation log, so it can be replayed alone.
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/engine/exam_engine.dart';
import 'package:mastersat_app/exam/engine/midterm_engine.dart';
import 'package:mastersat_app/exam/engine/pastpaper_engine.dart';
import 'package:mastersat_app/exam/session_contract.dart';

import 'support/engine_harness.dart';

const _sprValues = ['12', '3/4', '-1.5', '0', '7', '.25', '-2/3'];

/// What the student did, as they saw it accepted.
class Model {
  final Map<int, Map<int, String>> answers = {};
  final Map<int, Set<int>> flags = {};

  Map<int, String> answersOf(int m) => answers[m] ?? const {};
  Set<int> flagsOf(int m) => flags[m] ?? const {};
  Iterable<int> get modules => {...answers.keys, ...flags.keys};
}

class Sequence {
  Sequence(this.h, this.seed) : rnd = Random(seed * 7919 + 13), midterm = seed % 4 == 0;

  final EngineHarness h;
  final int seed;
  final Random rnd;
  final bool midterm;
  final Model model = Model();
  final List<String> log = [];
  late ExamEngine e;
  int kills = 0;

  String get where => 'seed $seed (${midterm ? 'midterm' : 'past paper'})\n  ${log.join('\n  ')}';

  void open() {
    if (midterm) {
      final m = h.midterm();
      h.run(() => m.prepare(code: fixtureMidtermCode));
      h.run(m.lockAndBind);
      h.run(m.openPaper);
      e = m;
    } else {
      final p = h.pastpaper();
      h.run(p.open);
      if (p.phase == ExamPhase.welcome) h.run(p.start);
      e = p;
    }
    h.flush();
  }

  void reopen() {
    kills++;
    log.add('KILL #$kills');
    h.flush(); // the click's transaction is on disk (≤ 30 ms in production)
    h.kill(e);
    if (midterm) {
      h.native.lockExit(); // the process died: the DLL's watchdog released the machine
      // A midterm cannot be opened without the network (its paper is never on disk).
      h.api.offline = false;
    }
    open();
    expectWorkIntact('after kill #$kills');
  }

  void expectWorkIntact(String when) {
    for (final m in model.modules) {
      expect(e.answersOf(m), model.answersOf(m), reason: 'answers of module $m $when — $where');
      expect(e.flags[m] ?? const <int>{}, model.flagsOf(m), reason: 'flags of module $m $when — $where');
    }
  }

  bool get canEdit => !e.inputLocked && e.phase == ExamPhase.running;

  void step() {
    final r = rnd.nextInt(100);
    final qs = e.questions;
    if (qs.isEmpty) {
      h.elapse(const Duration(seconds: 1));
      return;
    }
    final q = qs[rnd.nextInt(qs.length)];
    final m = e.moduleId;
    if (r < 38) {
      final v = q.isMathInput ? _sprValues[rnd.nextInt(_sprValues.length)] : q.choiceKeys[rnd.nextInt(q.choiceKeys.length)];
      final ok = canEdit;
      e.select(q.id, v);
      log.add('select ${q.id}=$v${ok ? '' : ' (locked)'}');
      if (ok) model.answers.putIfAbsent(m, () => {})[q.id] = v;
    } else if (r < 46) {
      final ok = canEdit;
      e.clearAnswer(q.id);
      log.add('clear ${q.id}${ok ? '' : ' (locked)'}');
      if (ok) model.answers[m]?.remove(q.id);
    } else if (r < 55) {
      final ok = canEdit;
      e.toggleFlag(q.id);
      log.add('flag ${q.id}${ok ? '' : ' (locked)'}');
      if (ok) {
        final set = model.flags.putIfAbsent(m, () => {});
        if (!set.remove(q.id)) set.add(q.id);
      }
    } else if (r < 60) {
      e.goTo(rnd.nextInt(qs.length));
      if (rnd.nextBool()) e.next();
      log.add('navigate');
    } else if (r < 75) {
      final d = Duration(milliseconds: rnd.nextInt(20000));
      log.add('elapse ${d.inMilliseconds} ms');
      h.elapse(d);
    } else if (r < 83) {
      h.api.offline = !h.api.offline;
      log.add(h.api.offline ? 'offline' : 'online');
    } else if (r < 87) {
      final latencies = [Duration.zero, const Duration(milliseconds: 300), const Duration(seconds: 2)];
      h.api.latency = latencies[rnd.nextInt(latencies.length)];
      log.add('latency ${h.api.latency.inMilliseconds} ms');
    } else if (r < 90 && !midterm && e.moduleOrder == 1 && e.phase == ExamPhase.running) {
      log.add('hand in module 1');
      e.openReview();
      h.run((e as PastpaperEngine).submitModule);
    } else {
      reopen();
    }
    // Whatever happened, what the screen shows is what the student did.
    if (e.phase == ExamPhase.running || e.phase == ExamPhase.review) {
      for (final mod in model.modules) {
        expect(e.answersOf(mod), model.answersOf(mod), reason: 'live answers of module $mod — $where');
      }
    }
  }

  void run() {
    open();
    final steps = 25 + rnd.nextInt(20);
    for (var i = 0; i < steps; i++) {
      step();
    }
    // A last kill, then back online for good: the server must end up with every answer.
    reopen();
    h.api.offline = false;
    h.api.latency = Duration.zero;
    log.add('online for good');
    h.elapse(const Duration(seconds: 90));
    expectWorkIntact('at the end');
    for (final m in model.modules) {
      expect(h.serverAnswers(e.attemptId, m), model.answersOf(m), reason: 'server answers of module $m — $where');
      expect(h.api.serverFlags(e.attemptId, m), model.flagsOf(m), reason: 'server flags of module $m — $where');
    }
    e.dispose();
    if (e is MidtermEngine) h.native.lockExit();
  }
}

void main() {
  test('random kill points lose zero answers across 200 random sequences', () {
    var kills = 0;
    var answersChecked = 0;
    for (var seed = 1; seed <= 200; seed++) {
      withHarness((h) {
        final s = Sequence(h, seed);
        s.run();
        kills += s.kills;
        answersChecked += s.model.answers.values.fold<int>(0, (n, m) => n + m.length);
      }, fileDb: true, seed: seed);
    }
    // The property ran with real teeth: many kills, many answers.
    expect(kills, greaterThan(400));
    expect(answersChecked, greaterThan(600));
    // ignore: avoid_print
    print('kill property: 200 sequences, $kills kills, $answersChecked answers intact');
  }, timeout: const Timeout(Duration(minutes: 10)));
}
