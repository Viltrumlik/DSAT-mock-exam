// Result loading: SCORING is polled at the server's pace (clamped 1–10 s), offline waits for
// "Try again", errors say what happened; PDFs are saved where the student picks.
import 'dart:typed_data';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/features/results/results_controller.dart';

void main() {
  group('PastpaperResultController', () {
    test('a cached completed result loads straight to ready', () async {
      final api = FixtureV1Api();
      final c = PastpaperResultController(api: api, attemptId: 8801);
      await c.load();
      expect(c.phase, ResultPhase.ready);
      expect(c.result!.score, 640);
      expect(c.result!.scoreDelta, 50);
      c.dispose();
    });

    test('SCORING polls after poll_after_ms until the score is in', () {
      fakeAsync((fa) {
        final api = FixtureV1Api()..scoringPolls = 2;
        // Finish a paper so the attempt is SCORING.
        late int attempt;
        () async {
          final b = await api.pastpaperOpen(52, const PastpaperOpenRequest(start: true));
          attempt = b.attempt.id;
          var module = b.attempt.module!.id;
          for (var i = 0; i < 2; i++) {
            final out = await api.pastpaperSubmit(attempt, SyncRequest(moduleId: module, seq: i + 1, answers: const {}, flagged: const []),
                idempotencyKey: IdempotencyKeys.submit(attempt, module));
            module = out.attempt.module?.id ?? module;
          }
        }();
        fa.flushMicrotasks();

        final c = PastpaperResultController(api: api, attemptId: attempt);
        c.load();
        fa.flushMicrotasks();
        expect(c.phase, ResultPhase.scoring);
        fa.elapse(const Duration(milliseconds: 1999));
        expect(api.calls.where((x) => x.method == 'pastpaperResult'), hasLength(1));
        fa.elapse(const Duration(milliseconds: 1));
        expect(api.calls.where((x) => x.method == 'pastpaperResult'), hasLength(2));
        expect(c.phase, ResultPhase.scoring);
        fa.elapse(const Duration(seconds: 2));
        expect(c.phase, ResultPhase.ready);
        expect(c.result!.isCompleted, isTrue);
        fa.elapse(const Duration(minutes: 1));
        expect(api.calls.where((x) => x.method == 'pastpaperResult'), hasLength(3), reason: 'no polling once ready');
        c.dispose();
      });
    });

    test('offline → offline state; Try again re-sends', () async {
      final api = FixtureV1Api()..offline = true;
      final c = PastpaperResultController(api: api, attemptId: 8801);
      await c.load();
      expect(c.phase, ResultPhase.offline);
      api.offline = false;
      await c.load();
      expect(c.phase, ResultPhase.ready);
      c.dispose();
    });

    test('a result that is not the student\'s says so', () async {
      final c = PastpaperResultController(api: FixtureV1Api(), attemptId: 1);
      await c.load();
      expect(c.phase, ResultPhase.failed);
      expect(c.error, "This result isn't available to you.");
      c.dispose();
    });
  });

  group('MidtermResultController', () {
    test('released and awaiting-release results are both "ready" (the card says which)', () async {
      final api = FixtureV1Api();
      final c = MidtermResultController(api: api, attemptId: 4410);
      await c.load();
      expect(c.phase, ResultPhase.ready);
      expect(c.result!.released, isTrue);
      expect(c.result!.totalScore, 680);
      c.dispose();
    });

    test('a server error keeps its words', () async {
      final api = FixtureV1Api()..failNext(ApiError(status: 503, body: ApiErrorBody(detail: 'Back soon.')));
      final c = MidtermResultController(api: api, attemptId: 4410);
      await c.load();
      expect(c.phase, ResultPhase.failed);
      expect(c.error, 'Back soon.');
      c.dispose();
    });
  });

  group('DocumentSaver', () {
    test('asks where first; cancelling downloads nothing', () async {
      var fetched = 0;
      final saver = DocumentSaver(pick: (_) async => null, write: (_, _) async => fail('nothing to write'));
      final path = await saver.save(
          suggestedName: 'MasterSAT-certificate-1.pdf',
          fetch: () async {
            fetched++;
            return Uint8List(0);
          });
      expect(path, isNull);
      expect(fetched, 0);
    });

    test('adds .pdf when the student leaves it off and writes the bytes', () async {
      final written = <String, Uint8List>{};
      final suggested = <String>[];
      final saver = DocumentSaver(
        pick: (name) async {
          suggested.add(name);
          return r'C:\Users\Aziza\Documents\my certificate';
        },
        write: (p, b) async => written[p] = b,
      );
      final path = await saver.save(suggestedName: 'MasterSAT-certificate-8801.pdf', fetch: () async => Uint8List.fromList([37, 80]));
      expect(suggested, ['MasterSAT-certificate-8801.pdf']);
      expect(path, r'C:\Users\Aziza\Documents\my certificate.pdf');
      expect(written[path], [37, 80]);
    });

    test('a failed download surfaces as the API error (the screen shows its message)', () async {
      final saver = DocumentSaver(pick: (_) async => '/tmp/x.pdf', write: (_, _) async {});
      await expectLater(
        saver.save(suggestedName: 'x.pdf', fetch: () async => throw const NetworkError('offline')),
        throwsA(isA<NetworkError>()),
      );
    });
  });
}
