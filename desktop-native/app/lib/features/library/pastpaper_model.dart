// The past-paper library as plain data + the pure rules that shape it (architecture §8).
//
// Ported from desktop/app/src/lib/model.ts (0.1.0) and its website originals:
//   names + grouping ← frontend/src/features/pastpapers/pastpaperLabels.ts,
//                      frontend/src/features/desktop/homeModel.ts `groupPastpapers`
//   card state       ← frontend/src/features/pastpapers/pastpaperCardState.ts — the RULE now
//                      runs on the server (home.pastpapers[].state); [PastpaperCardState] reads
//                      that state into the same shape the website's card renders from
//   filters + search ← frontend/src/app/(main)/pastpapers/page.tsx (Region, Year, Status,
//                      search), plus Subject (an app addition) and per-chip counts.
import 'package:intl/intl.dart';

import '../../core/models/models.dart';
import '../home/midterm_model.dart' show isReadingWriting, subjectLabelOf;

// ---------------------------------------------------------------------------------------------
// Names (pastpaperLabels.ts)
// ---------------------------------------------------------------------------------------------

/// `YYYY-MM-DD` as a calendar date (no time-zone shift — the website's `new Date("2025-10-01")`
/// would show September west of UTC; a practice date is a date, not an instant).
DateTime? parsePracticeDate(String? s) {
  if (s == null || s.isEmpty) return null;
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(s);
  if (m == null) return null;
  return DateTime.utc(int.parse(m.group(1)!), int.parse(m.group(2)!), int.parse(m.group(3)!));
}

/// `October 2025`, or `Undated`.
String fmtMonth(String? practiceDate) {
  final d = parsePracticeDate(practiceDate);
  if (d == null) return practiceDate == null || practiceDate.isEmpty ? 'Undated' : practiceDate;
  return DateFormat('MMMM y', 'en_US').format(d);
}

/// `Sep 28, 2026` for an instant, in the PC's time zone (the website's `fmtDay`).
String fmtDay(DateTime? t) => t == null ? '' : DateFormat('MMM d, y', 'en_US').format(t.toLocal());

/// `2025`, or null.
String? yearOf(String? practiceDate) => parsePracticeDate(practiceDate)?.year.toString();

bool isRW(String subject) => isReadingWriting(subject);

String subjectLabel(String subject) => subjectLabelOf(subject);

/// The short subject chip label ("R&W" / "Math").
String subjectShortLabel(String subject) => isRW(subject) ? 'R&W' : 'Math';

bool isUS(PastpaperRow p) => p.formType == 'US';

String regionLabel(PastpaperRow p) => isUS(p) ? 'US' : 'International';

/// The form letter from `label`, falling back to the last token of `collection_name`.
String formLetter(PastpaperRow p) {
  final lbl = p.label.trim();
  if (RegExp(r'^[A-Za-z]$').hasMatch(lbl)) return lbl.toUpperCase();
  final parts = p.collectionName.trim().split(RegExp(r'\s+'));
  final last = parts.isEmpty ? '' : parts.last;
  return RegExp(r'^[A-Za-z]$').hasMatch(last) ? last.toUpperCase() : '';
}

/// `International Form A`, `US Form B`, or just the region.
String variantLabel(PastpaperRow p) {
  final letter = formLetter(p);
  return letter.isNotEmpty ? '${regionLabel(p)} Form $letter' : regionLabel(p);
}

/// The card title: the paper's own title when set, else its variant.
String sectionTitle(PastpaperRow p) => p.title.trim().isNotEmpty ? p.title.trim() : variantLabel(p);

/// The group header: the sitting month.
String collectionLabel(PastpaperRow p) => fmtMonth(p.practiceDate);

// ---------------------------------------------------------------------------------------------
// Card state (pastpaperCardState.ts shape, from the server's state)
// ---------------------------------------------------------------------------------------------

/// What one card shows. Field for field the website's `CardState`.
class PastpaperCardState {
  const PastpaperCardState({
    required this.status,
    this.score,
    this.completedAt,
    this.completedAttemptId,
    this.openAttemptId,
    required this.sittings,
    this.reopenedBy,
  });

  factory PastpaperCardState.fromRow(PastpaperRow p) {
    final s = p.state;
    // The server only reports `reopened` with a finished sitting behind it, but the website's
    // rule is the authority: "reopened" needs a last finished attempt, else it is "new".
    var status = s.status;
    if (status == PastpaperStatus.reopened && s.lastAttemptId == null) status = PastpaperStatus.newPaper;
    if (status == PastpaperStatus.progress && s.openAttemptId == null) {
      status = s.lastAttemptId != null ? PastpaperStatus.completed : PastpaperStatus.newPaper;
    }
    return PastpaperCardState(
      status: status,
      score: s.lastScore,
      completedAt: s.lastCompletedAt,
      completedAttemptId: s.lastAttemptId,
      openAttemptId: status == PastpaperStatus.progress ? s.openAttemptId : null,
      sittings: s.sittings,
      reopenedBy: status == PastpaperStatus.reopened ? s.reopened : null,
    );
  }

  final PastpaperStatus status;

  /// The newest finished sitting's score.
  final int? score;
  final DateTime? completedAt;

  /// The newest finished sitting (See score, report, history open from it).
  final int? completedAttemptId;

  /// The open sitting a Resume continues.
  final int? openAttemptId;

  /// Finished sittings (History · N attempts).
  final int sittings;

  /// The homework that set the paper again.
  final ReopenedInfo? reopenedBy;

  /// The Status filter bucket: a paper set again is work to start, so it counts as New.
  StatusFilter get filterBucket => switch (status) {
        PastpaperStatus.newPaper || PastpaperStatus.reopened => StatusFilter.newPaper,
        PastpaperStatus.progress => StatusFilter.progress,
        PastpaperStatus.completed => StatusFilter.completed,
      };

  /// Whether the card offers "History · N attempts" (the website's rules per status).
  bool get showsHistory => switch (status) {
        PastpaperStatus.completed => sittings > 1,
        PastpaperStatus.reopened => sittings > 0,
        PastpaperStatus.progress => sittings > 0,
        PastpaperStatus.newPaper => false,
      };

  /// The score block's label, or null when the card shows no score.
  String? get scoreLabel => switch (status) {
        PastpaperStatus.completed => 'YOUR SCORE',
        PastpaperStatus.reopened => 'LAST SCORE',
        PastpaperStatus.progress => sittings > 0 ? 'LAST SCORE' : null,
        PastpaperStatus.newPaper => null,
      };
}

/// The card's main action.
enum PaperAction { start, resume, startAgain, seeScore }

/// homeModel.ts `paperAction`.
({PaperAction action, String label, bool finished}) paperAction(PastpaperCardState s) => switch (s.status) {
      PastpaperStatus.progress => (action: PaperAction.resume, label: 'Resume', finished: false),
      PastpaperStatus.reopened => (action: PaperAction.startAgain, label: 'Start again', finished: false),
      PastpaperStatus.completed => (action: PaperAction.seeScore, label: 'See score', finished: true),
      PastpaperStatus.newPaper => (action: PaperAction.start, label: 'Start', finished: false),
    };

/// The website's status badge text.
String statusBadgeLabel(PastpaperStatus s) => switch (s) {
      PastpaperStatus.newPaper => 'Not started',
      PastpaperStatus.progress => 'In progress',
      PastpaperStatus.reopened => 'Assigned again',
      PastpaperStatus.completed => 'Completed',
    };

// ---------------------------------------------------------------------------------------------
// Grouping (homeModel.ts groupPastpapers)
// ---------------------------------------------------------------------------------------------

class PaperItem {
  const PaperItem(this.paper, this.state);
  final PastpaperRow paper;
  final PastpaperCardState state;
}

class PaperGroup {
  const PaperGroup(this.name, this.items);
  final String name;
  final List<PaperItem> items;
}

/// JS `localeCompare` for plain titles: case-insensitive first, then case as the tiebreak.
int _localeCompare(String a, String b) {
  final c = a.toLowerCase().compareTo(b.toLowerCase());
  return c != 0 ? c : a.compareTo(b);
}

/// By month of `practice_date`, newest first; within a month by `collection_name`, then
/// Reading & Writing before Math.
List<PaperGroup> groupPastpapers(Iterable<PastpaperRow> papers) {
  final groups = <String, ({List<PaperItem> items, String sortKey})>{};
  for (final p in papers) {
    final name = collectionLabel(p);
    final g = groups.putIfAbsent(name, () => (items: <PaperItem>[], sortKey: p.practiceDate ?? ''));
    g.items.add(PaperItem(p, PastpaperCardState.fromRow(p)));
  }
  int subjectRank(PastpaperRow p) => isRW(p.subject) ? 0 : 1;
  final list = groups.entries.map((e) {
    final items = e.value.items
      ..sort((a, b) {
        final c = _localeCompare(a.paper.collectionName, b.paper.collectionName);
        return c != 0 ? c : subjectRank(a.paper) - subjectRank(b.paper);
      });
    return (name: e.key, sortKey: e.value.sortKey, items: items);
  }).toList()
    ..sort((a, b) => b.sortKey.compareTo(a.sortKey));
  return [for (final g in list) PaperGroup(g.name, g.items)];
}

// ---------------------------------------------------------------------------------------------
// Filters and search (architecture §8)
// ---------------------------------------------------------------------------------------------

enum RegionFilter {
  all('ALL', 'All'),
  us('US', 'US'),
  international('INTL', 'International');

  const RegionFilter(this.wire, this.label);
  final String wire;
  final String label;
  static RegionFilter fromWire(Object? s) => values.firstWhere((v) => v.wire == s, orElse: () => all);
}

enum StatusFilter {
  all('ALL', 'All'),
  newPaper('new', 'New'),
  progress('progress', 'In progress'),
  completed('completed', 'Completed');

  const StatusFilter(this.wire, this.label);
  final String wire;
  final String label;
  static StatusFilter fromWire(Object? s) => values.firstWhere((v) => v.wire == s, orElse: () => all);
}

enum SubjectFilter {
  all('ALL', 'All'),
  readingWriting('RW', 'R&W'),
  math('MATH', 'Math');

  const SubjectFilter(this.wire, this.label);
  final String wire;
  final String label;
  static SubjectFilter fromWire(Object? s) => values.firstWhere((v) => v.wire == s, orElse: () => all);
}

/// "All years".
const String allYears = 'ALL';

class LibraryFilters {
  const LibraryFilters({
    this.region = RegionFilter.all,
    this.year = allYears,
    this.status = StatusFilter.all,
    this.subject = SubjectFilter.all,
    this.query = '',
  });

  /// Restores the saved chips (the search text is not saved).
  factory LibraryFilters.fromJson(Map<String, Object?>? j) {
    if (j == null) return const LibraryFilters();
    final y = j['year'];
    return LibraryFilters(
      region: RegionFilter.fromWire(j['region']),
      year: y is String && (y == allYears || RegExp(r'^\d{4}$').hasMatch(y)) ? y : allYears,
      status: StatusFilter.fromWire(j['status']),
      subject: SubjectFilter.fromWire(j['subject']),
    );
  }

  final RegionFilter region;
  final String year;
  final StatusFilter status;
  final SubjectFilter subject;
  final String query;

  bool get hasFilter =>
      region != RegionFilter.all ||
      year != allYears ||
      status != StatusFilter.all ||
      subject != SubjectFilter.all ||
      query.trim().isNotEmpty;

  LibraryFilters copyWith({RegionFilter? region, String? year, StatusFilter? status, SubjectFilter? subject, String? query}) =>
      LibraryFilters(
        region: region ?? this.region,
        year: year ?? this.year,
        status: status ?? this.status,
        subject: subject ?? this.subject,
        query: query ?? this.query,
      );

  /// Saved per user: the chips only.
  Map<String, Object?> toJson() => {'region': region.wire, 'year': year, 'status': status.wire, 'subject': subject.wire};

  @override
  bool operator ==(Object other) =>
      other is LibraryFilters &&
      other.region == region &&
      other.year == year &&
      other.status == status &&
      other.subject == subject &&
      other.query == query;

  @override
  int get hashCode => Object.hash(region, year, status, subject, query);
}

const Map<String, String> _accentFold = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ā': 'a', 'ă': 'a', 'ą': 'a', 'æ': 'ae',
  'ç': 'c', 'ć': 'c', 'č': 'c', 'ĉ': 'c', 'ċ': 'c',
  'ď': 'd', 'đ': 'd', 'ð': 'd',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e', 'ĕ': 'e', 'ė': 'e', 'ę': 'e', 'ě': 'e',
  'ĝ': 'g', 'ğ': 'g', 'ġ': 'g', 'ģ': 'g',
  'ĥ': 'h', 'ħ': 'h',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ĩ': 'i', 'ī': 'i', 'ĭ': 'i', 'į': 'i', 'ı': 'i',
  'ĵ': 'j', 'ķ': 'k',
  'ĺ': 'l', 'ļ': 'l', 'ľ': 'l', 'ŀ': 'l', 'ł': 'l',
  'ñ': 'n', 'ń': 'n', 'ņ': 'n', 'ň': 'n',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', 'ō': 'o', 'ŏ': 'o', 'ő': 'o', 'œ': 'oe',
  'ŕ': 'r', 'ŗ': 'r', 'ř': 'r',
  'ś': 's', 'ŝ': 's', 'ş': 's', 'š': 's', 'ș': 's', 'ß': 'ss',
  'ţ': 't', 'ť': 't', 'ŧ': 't', 'ț': 't',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ũ': 'u', 'ū': 'u', 'ŭ': 'u', 'ů': 'u', 'ű': 'u', 'ų': 'u',
  'ŵ': 'w', 'ý': 'y', 'ÿ': 'y', 'ŷ': 'y',
  'ź': 'z', 'ż': 'z', 'ž': 'z',
  // Uzbek Latin apostrophes (oʻ, gʻ) and typographic quotes fold to nothing.
  'ʻ': '', 'ʼ': '', '’': '', '‘': '', "'": '', '`': '',
};

/// Lower-case, accents removed: the search "ignores case and accents".
String foldForSearch(String s) {
  final lower = s.toLowerCase();
  final out = StringBuffer();
  for (final rune in lower.runes) {
    // Combining diacritical marks (U+0300–U+036F) are dropped.
    if (rune >= 0x300 && rune <= 0x36F) continue;
    final ch = String.fromCharCode(rune);
    out.write(_accentFold[ch] ?? ch);
  }
  return out.toString().replaceAll(RegExp(r'\s+'), ' ');
}

/// The text a search matches against: the website's fields (`page.tsx:100-103`) — title,
/// collection label, form letter, region, subject label, month — plus the subject's short
/// chip label so "R&W" finds what the chip says.
String searchBlob(PastpaperRow p) => foldForSearch([
      sectionTitle(p),
      collectionLabel(p),
      p.label,
      p.formType,
      regionLabel(p),
      subjectLabel(p.subject),
      subjectShortLabel(p.subject),
      fmtMonth(p.practiceDate),
    ].join(' '));

bool _matchesRegion(PastpaperRow p, RegionFilter r) => switch (r) {
      RegionFilter.all => true,
      RegionFilter.us => isUS(p),
      RegionFilter.international => !isUS(p),
    };

bool _matchesSubject(PastpaperRow p, SubjectFilter s) => switch (s) {
      SubjectFilter.all => true,
      SubjectFilter.readingWriting => isRW(p.subject),
      SubjectFilter.math => !isRW(p.subject),
    };

bool _matchesStatus(PastpaperCardState st, StatusFilter s) => s == StatusFilter.all || st.filterBucket == s;

bool _matchesYear(PastpaperRow p, String year) => year == allYears || yearOf(p.practiceDate) == year;

bool _matchesQuery(PastpaperRow p, String foldedQuery) => foldedQuery.isEmpty || searchBlob(p).contains(foldedQuery);

/// One chip's count.
typedef ChipCounts<T> = Map<T, int>;

/// The filtered, grouped library and every chip's count.
class LibraryView {
  const LibraryView({
    required this.groups,
    required this.total,
    required this.shown,
    required this.years,
    required this.regionCounts,
    required this.yearCounts,
    required this.statusCounts,
    required this.subjectCounts,
    required this.filters,
  });

  /// Applies [filters] to [papers]. Each chip's count is how many papers that chip would show
  /// with the OTHER filters (and the search) kept as they are.
  factory LibraryView.compute(List<PastpaperRow> papers, LibraryFilters requested) {
    final years = {for (final p in papers) ?yearOf(p.practiceDate)}.toList()
      ..sort((a, b) => int.parse(b).compareTo(int.parse(a)));
    // A saved year that no longer has papers falls back to "All" instead of an empty list.
    final filters =
        requested.year != allYears && !years.contains(requested.year) ? requested.copyWith(year: allYears) : requested;
    final q = foldForSearch(filters.query.trim());
    final items = [for (final p in papers) PaperItem(p, PastpaperCardState.fromRow(p))];

    bool passes(PaperItem i, {bool region = true, bool year = true, bool status = true, bool subject = true}) =>
        (!region || _matchesRegion(i.paper, filters.region)) &&
        (!year || _matchesYear(i.paper, filters.year)) &&
        (!status || _matchesStatus(i.state, filters.status)) &&
        (!subject || _matchesSubject(i.paper, filters.subject)) &&
        _matchesQuery(i.paper, q);

    final regionCounts = {
      for (final r in RegionFilter.values) r: items.where((i) => passes(i, region: false) && _matchesRegion(i.paper, r)).length,
    };
    final yearCounts = {
      for (final y in [allYears, ...years]) y: items.where((i) => passes(i, year: false) && _matchesYear(i.paper, y)).length,
    };
    final statusCounts = {
      for (final s in StatusFilter.values) s: items.where((i) => passes(i, status: false) && _matchesStatus(i.state, s)).length,
    };
    final subjectCounts = {
      for (final s in SubjectFilter.values)
        s: items.where((i) => passes(i, subject: false) && _matchesSubject(i.paper, s)).length,
    };

    final shown = items.where((i) => passes(i)).map((i) => i.paper).toList();
    return LibraryView(
      groups: groupPastpapers(shown),
      total: papers.length,
      shown: shown.length,
      years: years,
      regionCounts: regionCounts,
      yearCounts: yearCounts,
      statusCounts: statusCounts,
      subjectCounts: subjectCounts,
      filters: filters,
    );
  }

  final List<PaperGroup> groups;
  final int total;
  final int shown;

  /// Distinct years, newest first.
  final List<String> years;
  final ChipCounts<RegionFilter> regionCounts;
  final ChipCounts<String> yearCounts;
  final ChipCounts<StatusFilter> statusCounts;
  final ChipCounts<SubjectFilter> subjectCounts;
  final LibraryFilters filters;
}
