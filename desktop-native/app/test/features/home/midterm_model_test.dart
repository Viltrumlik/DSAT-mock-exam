// Midterm rules on Home, ported with the website's tests (frontend/src/features/desktop/
// __tests__/homeModel.test.ts → midtermBuckets.ts) plus the app's badges, countdown and poll rule.
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/features/home/midterm_model.dart';

import '../../core/harness/app_harness.dart';

MidtermRow midterm({
  int id = 1,
  String subject = 'MATH',
  int? attemptId,
  String state = 'NOT_STARTED',
  bool submitted = false,
  bool resitOpen = false,
  bool isOpen = true,
  bool isBeforeStart = false,
  bool awaitingCode = false,
  DateTime? availableAt,
  DateTime? deadline,
  bool resultsVisible = false,
  int? score,
}) =>
    MidtermRow(
      midtermId: id,
      title: 'Math Midterm',
      subject: subject,
      scoringScale: 'SCALE_100',
      scoreCeiling: 100,
      durationMinutes: 60,
      questionCount: 20,
      flavor: 'CLASSROOM',
      attemptId: attemptId,
      state: state,
      submitted: submitted,
      resitOpen: resitOpen,
      isOpen: isOpen,
      isBeforeStart: isBeforeStart,
      awaitingCode: awaitingCode,
      availableAt: availableAt,
      deadline: deadline,
      resultsVisible: resultsVisible,
      score: score,
      requiresCode: true,
    );

void main() {
  group('midtermStatus (homeModel.test.ts)', () {
    test('offers Start, or Resume for a sitting already under way', () {
      expect(midtermStatus(midterm(), MidtermCardKind.available), (label: 'Start', actionable: true));
      expect(midtermStatus(midterm(attemptId: 9, state: 'MODULE_1_ACTIVE'), MidtermCardKind.available).label, 'Resume');
    });

    test("says why a scheduled one can't open yet", () {
      expect(midtermStatus(midterm(isOpen: false, awaitingCode: true), MidtermCardKind.scheduled).label,
          'Waiting for your teacher to start it');
      expect(midtermStatus(midterm(isOpen: false, isBeforeStart: true), MidtermCardKind.scheduled).label, 'Opens soon');
      expect(
        midtermStatus(midterm(isOpen: false, isBeforeStart: true, availableAt: DateTime.utc(2026, 10, 12, 9)),
                MidtermCardKind.scheduled)
            .label,
        startsWith('Opens '),
      );
    });

    test('shows a score only once it is released', () {
      expect(midtermStatus(midterm(submitted: true, score: 80), MidtermCardKind.past).label,
          'Finished — your result is on its way');
      expect(midtermStatus(midterm(submitted: true, score: 80, resultsVisible: true), MidtermCardKind.past).label,
          'Score 80 / 100');
      expect(midtermStatus(midterm(isOpen: false), MidtermCardKind.missed).label, 'Not taken');
    });
  });

  group('bucketMidterms (midtermBuckets.ts)', () {
    test("buckets exactly as the site's Midterms page does", () {
      final b = bucketMidterms([
        midterm(id: 1),
        midterm(id: 2, isOpen: false, awaitingCode: true),
        midterm(id: 3, submitted: true),
        midterm(id: 4, submitted: true, resitOpen: true),
        midterm(id: 5, isOpen: false),
        midterm(id: 6, isOpen: false, attemptId: 3, state: 'MODULE_1_ACTIVE'),
      ]);
      expect(b.available.map((m) => m.midtermId), [1, 4, 6]);
      expect(b.scheduled.map((m) => m.midtermId), [2]);
      expect(b.past.map((m) => m.midtermId), [3]);
      expect(b.missed.map((m) => m.midtermId), [5]);
    });

    test('every row lands in exactly one bucket', () {
      final rows = <MidtermRow>[];
      var id = 0;
      for (final submitted in [false, true]) {
        for (final resit in [false, true]) {
          for (final open in [false, true]) {
            for (final before in [false, true]) {
              for (final awaiting in [false, true]) {
                for (final started in [false, true]) {
                  rows.add(midterm(
                    id: ++id,
                    submitted: submitted,
                    resitOpen: resit,
                    isOpen: open,
                    isBeforeStart: before,
                    awaitingCode: awaiting,
                    attemptId: started ? 70 : null,
                    state: started ? 'MODULE_2_ACTIVE' : 'NOT_STARTED',
                  ));
                }
              }
            }
          }
        }
      }
      final b = bucketMidterms(rows);
      final all = [...b.available, ...b.scheduled, ...b.missed, ...b.past].map((m) => m.midtermId).toList();
      expect(all.length, rows.length);
      expect(all.toSet().length, rows.length);
    });

    test('the fixture Home: two open (one a re-sit), one scheduled, one past', () {
      final b = bucketMidterms(fixtureHome().midterms);
      expect(b.available.map((m) => m.midtermId), [14, 10]);
      expect(b.scheduled.map((m) => m.midtermId), [15]);
      expect(b.past.map((m) => m.midtermId), [9]);
      expect(b.missed, isEmpty);
    });
  });

  group('labels', () {
    test('a granted re-sit starts a fresh attempt: never "Resume"', () {
      final resit = midterm(submitted: true, resitOpen: true, attemptId: 4, state: 'COMPLETED');
      expect(midtermActionLabel(resit), 'Start re-sit');
      expect(midtermBadgeLabel(resit, MidtermCardKind.available), 'Re-sit available');
      expect(isResit(resit, MidtermCardKind.available), isTrue);
      expect(midtermActionLabel(midterm(attemptId: 4, state: 'MODULE_1_ACTIVE')), 'Resume');
      expect(midtermBadgeLabel(midterm(attemptId: 4, state: 'MODULE_1_ACTIVE'), MidtermCardKind.available), 'In progress');
    });

    test('MidtermList badges', () {
      expect(midtermBadgeLabel(midterm(), MidtermCardKind.available), 'Available');
      expect(midtermBadgeLabel(midterm(awaitingCode: true), MidtermCardKind.scheduled), 'Not started');
      expect(midtermBadgeLabel(midterm(isBeforeStart: true), MidtermCardKind.scheduled), 'Scheduled');
      expect(midtermBadgeLabel(midterm(), MidtermCardKind.missed), 'Missed');
      expect(midtermBadgeLabel(midterm(), MidtermCardKind.past), 'Completed');
    });

    test('countdown: d h m, then h m s, then m s; null once it has passed', () {
      final now = DateTime.utc(2026, 10, 11, 9);
      expect(countdownLabel(now.add(const Duration(days: 1, hours: 4, minutes: 5, seconds: 9)), now), '1d 4h 5m');
      expect(countdownLabel(now.add(const Duration(hours: 4, minutes: 5, seconds: 10)), now), '4h 5m 10s');
      expect(countdownLabel(now.add(const Duration(minutes: 5, seconds: 10)), now), '5m 10s');
      expect(countdownLabel(now, now), isNull);
      expect(countdownLabel(now.subtract(const Duration(seconds: 1)), now), isNull);
    });

    test('meta line', () {
      expect(midtermMeta(midterm()), 'Mathematics · 60 min · 20 questions');
      expect(subjectLabelOf('READING_WRITING'), 'Reading & Writing');
    });
  });

  group('polling', () {
    test('Home polls only while a midterm could change on its own', () {
      expect(midtermsNeedPolling([midterm(submitted: true)]), isFalse);
      expect(midtermsNeedPolling([midterm(isOpen: false)]), isFalse, reason: 'missed: nothing will change');
      expect(midtermsNeedPolling([midterm(isOpen: false, isBeforeStart: true)]), isTrue);
      expect(midtermsNeedPolling([midterm(isOpen: false, awaitingCode: true)]), isTrue);
      expect(midtermsNeedPolling([midterm()]), isTrue, reason: 'open, not started');
      expect(midtermsNeedPolling([midterm(attemptId: 2, state: 'MODULE_1_ACTIVE')]), isFalse);
    });
  });
}
