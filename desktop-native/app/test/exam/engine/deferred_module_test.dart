// Adaptive past papers: module 2 is DEFERRED at open (the server picks it from module 1's
// score) and arrives as `submit.next_module` (contracts: pastpaper_open.response.deferred,
// pastpaper_submit.response.deferred). The fixture server sends every module up front, so this
// file wraps it to behave like an adaptive paper.
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/session_contract.dart';

import 'support/engine_harness.dart';

/// The fixture server, adaptive: module 2's questions only once module 1 is handed in.
class AdaptiveFixtureApi extends FixtureV1Api {
  AdaptiveFixtureApi({super.now});

  Map<String, Object?>? _module2;
  List<Object?> _module2Media = const [];

  /// While set, a module-1 hand-in reply leaves `next_module` out (the module is fetched by
  /// reopening instead — what a lost reply looks like after a replay).
  bool dropNextModule = false;

  static bool _isModule2(Object? m) => (m! as Map)['order'] == 2;

  @override
  Future<ExamBundle> pastpaperOpen(int practiceTestId, PastpaperOpenRequest body) async {
    final b = await super.pastpaperOpen(practiceTestId, body);
    final json = b.toJson();
    final modules = (json['modules']! as List).cast<Map<String, Object?>>();
    final m2 = modules.firstWhere(_isModule2);
    if (m2['questions'] != null) _module2 = Map.of(m2);
    final m2Keys = <String>{
      for (final q in ((m2['questions'] as List?) ?? const []).cast<Map<String, Object?>>()) ...[
        if (q['question_image_key'] != null) q['question_image_key']! as String,
      ],
    };
    final media = (json['media']! as List).cast<Map<String, Object?>>();
    _module2Media = [for (final r in media) if (m2Keys.contains(r['key'])) r];
    if (b.attempt.state != AttemptState.module2Active) {
      // Not chosen yet: no questions, no images for module 2.
      m2['questions'] = null;
      m2['deferred'] = true;
      m2['unchanged'] = false;
      json['media'] = [for (final r in media) if (!m2Keys.contains(r['key'])) r];
    }
    return ExamBundle.fromJson(JsonReader.of(json));
  }

  @override
  Future<SubmitOutcome> pastpaperSubmit(int attemptId, SyncRequest body, {required String idempotencyKey}) async {
    final s = await super.pastpaperSubmit(attemptId, body, idempotencyKey: idempotencyKey);
    if (s.transitionedTo != AttemptState.module2Active || dropNextModule || _module2 == null) return s;
    final json = s.toJson();
    json['next_module'] = {..._module2!, 'deferred': false, 'unchanged': false};
    json['media'] = _module2Media;
    return SubmitOutcome.fromJson(JsonReader.of(json));
  }
}

FixtureApiFactory get adaptive => (now) => AdaptiveFixtureApi(now: now);

void main() {
  test('open: only module 1 is downloaded; Welcome; start', () {
    withHarness((h) {
      final e = h.pastpaper();
      h.run(e.open);
      expect(e.phase, ExamPhase.welcome);
      expect(e.questions.map((q) => q.id), P52.m1Questions);
      expect(e.content[P52.m2]?.questions, isNull, reason: 'deferred until module 1 is in');
      h.run(e.start);
      expect(e.phase, ExamPhase.running);
      e.dispose();
    }, apiFactory: adaptive);
  });

  test('Submit: waiting for the server, then module 2 from the reply, its clock in full', () {
    withHarness((h) {
      final e = h.pastpaper();
      h.run(e.open);
      h.run(e.start);
      e.select(1001, 'A');
      h.api.latency = const Duration(milliseconds: 800);
      e.openReview();
      h.run(e.submitModule);
      expect(e.phase, ExamPhase.transition);
      expect(e.transition, const ModuleTransition(fromOrder: 1, toOrder: 2, waitingForServer: true));
      expect(e.inputLocked, isTrue);
      h.elapse(const Duration(seconds: 2));
      expect(e.phase, ExamPhase.running);
      expect(e.moduleId, P52.m2);
      expect(e.questions.map((q) => q.id), P52.m2Questions);
      expect(e.remaining.value, greaterThan(const Duration(minutes: P52.minutes) - const Duration(seconds: 3)));
      e.select(1012, 'C');
      h.elapse(const Duration(seconds: 12));
      expect(h.serverAnswers(P52.attempt, P52.m2), {1012: 'C'});
      // Module 2 is now cached for an offline reopen.
      final rec = h.run(() => h.store.loadAttempt(P52.attempt));
      expect(rec!.contentHashes.keys, containsAll([P52.m1, P52.m2]));
      e.dispose();
    }, apiFactory: adaptive);
  });

  test('offline at the hand-in: "waiting" offline, then module 2 on reconnect', () {
    withHarness((h) {
      final e = h.pastpaper();
      h.run(e.open);
      h.run(e.start);
      h.api.offline = true;
      e.openReview();
      h.run(e.submitModule);
      h.elapse(const Duration(seconds: 2));
      expect(e.phase, ExamPhase.offlineWaiting);
      h.api.offline = false;
      h.elapse(const Duration(seconds: 35));
      expect(e.phase, ExamPhase.running);
      expect(e.moduleId, P52.m2);
      e.dispose();
    }, apiFactory: adaptive);
  });

  test('a kill between the hand-in and module 2: the reopen gets module 2 from open', () {
    withHarness((h) {
      var e = h.pastpaper();
      h.run(e.open);
      h.run(e.start);
      e.select(1001, 'B');
      (h.api as AdaptiveFixtureApi).dropNextModule = true; // the reply that carried it is lost
      e.openReview();
      h.run(e.submitModule);
      h.elapse(const Duration(seconds: 2));
      expect(h.api.stateOf(P52.attempt), AttemptState.module2Active);
      h.kill(e);
      e = h.pastpaper();
      h.run(e.open);
      expect(e.phase, ExamPhase.running);
      expect(e.moduleId, P52.m2);
      expect(e.questions.map((q) => q.id), P52.m2Questions);
      expect(h.serverAnswers(P52.attempt, P52.m1), {1001: 'B'});
      e.dispose();
    }, apiFactory: adaptive, fileDb: true);
  });

  test('a hand-in reply without the module while the app stays open: module 2 is fetched again', () {
    withHarness((h) {
      final e = h.pastpaper();
      h.run(e.open);
      h.run(e.start);
      (h.api as AdaptiveFixtureApi).dropNextModule = true;
      e.openReview();
      h.run(e.submitModule);
      h.elapse(const Duration(seconds: 2));
      // The reply said "module 2" with no questions: the engine asked for them at once.
      expect(e.phase, ExamPhase.running, reason: 'never stuck on "waiting" while the server has moved on');
      expect(e.moduleId, P52.m2);
      expect(e.questions.map((q) => q.id), P52.m2Questions);
      expect(h.callNames().where((n) => n == 'pastpaperOpen'), hasLength(2));
      e.dispose();
    }, apiFactory: adaptive);
  });

  test('if fetching the module fails too, the wait retries on its own until it lands', () {
    withHarness((h) {
      final e = h.pastpaper();
      h.run(e.open);
      h.run(e.start);
      final api = h.api as AdaptiveFixtureApi;
      api.dropNextModule = true;
      api.latency = const Duration(seconds: 1);
      e.openReview();
      h.run(e.submitModule);
      h.elapse(const Duration(milliseconds: 1500)); // the reply is in; the refetch is on the wire…
      api.offline = true; // …and fails
      h.elapse(const Duration(seconds: 20));
      expect(e.moduleId, P52.m2);
      expect(e.questions, isEmpty);
      api.offline = false;
      h.elapse(const Duration(seconds: 20));
      expect(e.phase, ExamPhase.running);
      expect(e.questions.map((q) => q.id), P52.m2Questions);
      e.dispose();
    }, apiFactory: adaptive);
  });
}
