// The library's pure rules (architecture §8), ported from desktop/app/src/lib/model.ts and the
// website's homeModel.test.ts / pastpaperLabels.ts, plus the app's filters and search.
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/features/library/pastpaper_model.dart';

import '../../core/harness/app_harness.dart';

PastpaperRow paper(
  int id, {
  String date = '2025-10-04',
  String subject = 'MATH',
  String title = '',
  String label = 'A',
  String form = 'INTERNATIONAL',
  String collection = 'Oct A',
  PastpaperStatus status = PastpaperStatus.newPaper,
  int? openAttemptId,
  int? lastAttemptId,
  int? lastScore,
  int sittings = 0,
  ReopenedInfo? reopened,
}) =>
    PastpaperRow(
      id: id,
      title: title,
      practiceDate: date,
      subject: subject,
      label: label,
      formType: form,
      collectionName: collection,
      modules: const [],
      state: PastpaperState(
        status: status,
        openAttemptId: openAttemptId,
        lastAttemptId: lastAttemptId,
        lastScore: lastScore,
        sittings: sittings,
        reopened: reopened,
      ),
      history: const [],
    );

const _reopened = ReopenedInfo(assignmentId: 5, assignmentTitle: 'Retake: August Math', classroomName: 'SAT Evening B');

void main() {
  group('names (pastpaperLabels.ts)', () {
    test('a paper is titled by its own title, else "<region> Form <letter>"', () {
      expect(sectionTitle(paper(1, title: '  June practice — Math ')), 'June practice — Math');
      expect(sectionTitle(paper(1, form: 'US', label: 'b')), 'US Form B');
      expect(sectionTitle(paper(1, label: '', collection: 'August 2025 International C')), 'International Form C');
      expect(sectionTitle(paper(1, label: 'Main', collection: 'Practice')), 'International');
    });

    test('months are calendar dates (no time-zone drift) and an undated paper says so', () {
      expect(fmtMonth('2025-10-01'), 'October 2025');
      expect(fmtMonth(null), 'Undated');
      expect(fmtMonth(''), 'Undated');
      expect(yearOf('2025-10-01'), '2025');
      expect(yearOf(null), isNull);
    });

    test('subjects read like the website', () {
      expect(subjectLabel('READING_WRITING'), 'Reading & Writing');
      expect(subjectLabel('MATH'), 'Mathematics');
      expect(subjectShortLabel('READING_WRITING'), 'R&W');
      expect(subjectShortLabel('MATH'), 'Math');
    });
  });

  group('grouping (homeModel.test.ts)', () {
    test('groups by month, newest first, Reading & Writing before Math', () {
      final groups = groupPastpapers([
        paper(1, date: '2025-08-23'),
        paper(2, date: '2025-10-04'),
        paper(3, date: '2025-10-04', subject: 'READING_WRITING'),
      ]);
      expect(groups.map((g) => g.name), ['October 2025', 'August 2025']);
      expect(groups.first.items.map((i) => i.paper.id), [3, 2]);
    });

    test('within a month, by collection name first (case-insensitive), then subject', () {
      final groups = groupPastpapers([
        paper(1, collection: 'October US'),
        paper(2, collection: 'october International'),
        paper(3, collection: 'October US', subject: 'READING_WRITING'),
      ]);
      expect(groups.single.items.map((i) => i.paper.id), [2, 3, 1]);
    });

    test('the fixture Home groups into its three months', () {
      final groups = groupPastpapers(fixtureHome().pastpapers);
      expect(groups.map((g) => g.name), ['October 2025', 'August 2025', 'June 2025']);
      expect(groups.first.items.map((i) => i.paper.id), [51, 52]);
    });
  });

  group('card state and action (pastpaperCardState.ts)', () {
    test('names the button for every state', () {
      PastpaperCardState s(PastpaperStatus st, {int? last, int? open}) =>
          PastpaperCardState.fromRow(paper(1, status: st, lastAttemptId: last, openAttemptId: open, reopened: _reopened));
      expect(paperAction(s(PastpaperStatus.newPaper)).label, 'Start');
      expect(paperAction(s(PastpaperStatus.progress, open: 9)).label, 'Resume');
      expect(paperAction(s(PastpaperStatus.reopened, last: 8)).label, 'Start again');
      expect(paperAction(s(PastpaperStatus.completed, last: 8)).label, 'See score');
      expect(paperAction(s(PastpaperStatus.completed, last: 8)).finished, isTrue);
    });

    test('an inconsistent server state falls back to the website rule', () {
      // "reopened" needs a finished sitting behind it.
      expect(PastpaperCardState.fromRow(paper(1, status: PastpaperStatus.reopened)).status, PastpaperStatus.newPaper);
      // "progress" needs an open attempt.
      expect(PastpaperCardState.fromRow(paper(1, status: PastpaperStatus.progress, lastAttemptId: 4)).status,
          PastpaperStatus.completed);
    });

    test('history shows per the website: >1 finished, or any sitting behind a re-set/in-progress paper', () {
      bool shows(PastpaperStatus st, int sittings) => PastpaperCardState.fromRow(
              paper(1, status: st, sittings: sittings, lastAttemptId: 7, openAttemptId: 9, reopened: _reopened))
          .showsHistory;
      expect(shows(PastpaperStatus.completed, 1), isFalse);
      expect(shows(PastpaperStatus.completed, 2), isTrue);
      expect(shows(PastpaperStatus.reopened, 1), isTrue);
      expect(shows(PastpaperStatus.progress, 0), isFalse);
      expect(shows(PastpaperStatus.progress, 1), isTrue);
    });

    test('assigned again counts as New in the Status filter but keeps its own badge', () {
      final s = PastpaperCardState.fromRow(paper(1, status: PastpaperStatus.reopened, lastAttemptId: 3, reopened: _reopened));
      expect(s.filterBucket, StatusFilter.newPaper);
      expect(statusBadgeLabel(s.status), 'Assigned again');
      expect(s.scoreLabel, 'LAST SCORE');
    });
  });

  group('search', () {
    test('ignores case and accents, and folds Uzbek apostrophes', () {
      expect(foldForSearch('Ôctobér  REGIÓN'), 'october region');
      expect(foldForSearch('Oʻzbekiston'), 'ozbekiston');
      expect(foldForSearch('Café'), 'cafe');
    });

    test('matches the website fields: title, month, form letter, region, subject', () {
      final papers = [
        paper(1, title: 'June practice — Math', date: '2025-06-07', form: 'US', label: 'C'),
        paper(2, date: '2025-08-23', subject: 'READING_WRITING', label: 'B'),
      ];
      List<int> q(String text) =>
          LibraryView.compute(papers, LibraryFilters(query: text)).groups.expand((g) => g.items).map((i) => i.paper.id).toList();
      expect(q('june PRACTICE'), [1]);
      expect(q('ÁUGUST'), [2]);
      expect(q('form b'), [2]);
      expect(q('international'), [2]);
      expect(q('reading & writing'), [2]);
      expect(q('r&w'), [2]);
      expect(q('mathematics'), [1]);
      expect(q('nothing like this'), isEmpty);
      expect(q('   '), [2, 1], reason: 'blank search shows everything (August newest first)');
    });
  });

  group('filters and chip counts', () {
    final papers = fixtureHome().pastpapers;

    test('every chip counts what it would show with the other filters kept', () {
      final v = LibraryView.compute(papers, const LibraryFilters());
      expect(v.total, 6);
      expect(v.shown, 6);
      expect(v.years, ['2025']);
      expect(v.regionCounts, {RegionFilter.all: 6, RegionFilter.us: 4, RegionFilter.international: 2});
      // 52 new + 44 reopened = New 2; 51 + 37 in progress; 43 + 38 completed.
      expect(v.statusCounts, {
        StatusFilter.all: 6,
        StatusFilter.newPaper: 2,
        StatusFilter.progress: 2,
        StatusFilter.completed: 2,
      });
      expect(v.subjectCounts, {SubjectFilter.all: 6, SubjectFilter.readingWriting: 3, SubjectFilter.math: 3});

      final us = LibraryView.compute(papers, const LibraryFilters(region: RegionFilter.us));
      expect(us.shown, 4);
      expect(us.regionCounts[RegionFilter.international], 2, reason: 'a region chip ignores the region filter');
      expect(us.statusCounts[StatusFilter.completed], 1, reason: 'other chips respect it');
      expect(us.subjectCounts[SubjectFilter.math], 2);
    });

    test('filters combine; Status New includes "assigned again"', () {
      final v = LibraryView.compute(
          papers, const LibraryFilters(status: StatusFilter.newPaper, subject: SubjectFilter.math));
      expect(v.groups.expand((g) => g.items).map((i) => i.paper.id), [52, 44]);
    });

    test('a saved year that no longer has papers falls back to All', () {
      final v = LibraryView.compute(papers, const LibraryFilters(year: '2023'));
      expect(v.filters.year, allYears);
      expect(v.shown, 6);
    });

    test('saved chips round-trip; the search text is not saved; junk is ignored', () {
      const f = LibraryFilters(
          region: RegionFilter.international, year: '2025', status: StatusFilter.completed, subject: SubjectFilter.readingWriting, query: 'x');
      final back = LibraryFilters.fromJson(f.toJson());
      expect(back, f.copyWith(query: ''));
      expect(LibraryFilters.fromJson({'region': 'MARS', 'year': 'abcd', 'status': 7}), const LibraryFilters());
      expect(LibraryFilters.fromJson(null), const LibraryFilters());
      expect(const LibraryFilters().hasFilter, isFalse);
      expect(const LibraryFilters(query: ' a ').hasFilter, isTrue);
    });
  });
}
