// Midterms on Home, as plain data + the pure rules that shape it.
//
// Ported from desktop/app/src/lib/model.ts (0.1.0), which ports the website's
// frontend/src/lib/midtermBuckets.ts and frontend/src/features/desktop/homeModel.ts verbatim.
// Keep these in step with their originals: a midterm must be "available" in exactly the same
// cases in the app and on the site. Badges and the re-sit wording follow the website's
// app/(main)/midterm/MidtermList.tsx.
import 'package:intl/intl.dart';

import '../../core/models/models.dart';

/// The four lists Home shows.
class MidtermBuckets {
  const MidtermBuckets({required this.available, required this.scheduled, required this.missed, required this.past});

  final List<MidtermRow> available;
  final List<MidtermRow> scheduled;
  final List<MidtermRow> missed;
  final List<MidtermRow> past;

  bool get isEmpty => available.isEmpty && scheduled.isEmpty && missed.isEmpty && past.isEmpty;
}

/// A started-but-unfinished attempt is always resumable (even past the deadline).
bool isResumable(MidtermRow m) => !m.submitted && m.attemptId != null && m.state != 'NOT_STARTED';

/// midtermBuckets.ts `bucketMidterms`, rule for rule.
MidtermBuckets bucketMidterms(List<MidtermRow> midterms) {
  // A granted re-sit lifts the once-only rule: it belongs in "available" and outranks the
  // schedule/deadline buckets (the backend exempts a re-sit from the class window).
  return MidtermBuckets(
    available: midterms.where((m) => m.resitOpen || (!m.submitted && (isResumable(m) || m.isOpen))).toList(),
    scheduled: midterms
        .where((m) =>
            !m.resitOpen && !m.submitted && !m.isOpen && !isResumable(m) && (m.isBeforeStart || m.awaitingCode))
        .toList(),
    missed: midterms
        .where((m) =>
            !m.resitOpen && !m.submitted && !m.isOpen && !isResumable(m) && !m.isBeforeStart && !m.awaitingCode)
        .toList(),
    past: midterms.where((m) => m.submitted && !m.resitOpen).toList(),
  );
}

enum MidtermCardKind { available, scheduled, missed, past }

/// homeModel.ts `midtermStatus`: the one line under a midterm's title, or its button label
/// when it can be opened.
({String label, bool actionable}) midtermStatus(MidtermRow m, MidtermCardKind kind) {
  switch (kind) {
    case MidtermCardKind.available:
      return (label: isResumable(m) ? 'Resume' : 'Start', actionable: true);
    case MidtermCardKind.scheduled:
      if (m.awaitingCode) return (label: 'Waiting for your teacher to start it', actionable: false);
      final at = m.availableAt;
      return (label: at != null ? 'Opens ${formatWhen(at)}' : 'Opens soon', actionable: false);
    case MidtermCardKind.past:
      if (m.resultsVisible && m.score != null) {
        return (label: 'Score ${m.score} / ${m.scoreCeiling}', actionable: false);
      }
      return (label: 'Finished — your result is on its way', actionable: false);
    case MidtermCardKind.missed:
      return (label: 'Not taken', actionable: false);
  }
}

/// A re-sit: they finished this paper and hold a granted permission to sit it once more.
/// Starting creates a FRESH attempt, so the label must not say "Resume".
bool isResit(MidtermRow m, MidtermCardKind kind) => kind == MidtermCardKind.available && m.resitOpen;

/// The action button's label on an available row ("Start", "Resume", "Start re-sit").
String midtermActionLabel(MidtermRow m) {
  if (m.resitOpen) return 'Start re-sit';
  return isResumable(m) ? 'Resume' : 'Start';
}

/// MidtermList.tsx badges.
String midtermBadgeLabel(MidtermRow m, MidtermCardKind kind) {
  switch (kind) {
    case MidtermCardKind.available:
      if (m.resitOpen) return 'Re-sit available';
      return isResumable(m) ? 'In progress' : 'Available';
    case MidtermCardKind.scheduled:
      return m.awaitingCode ? 'Not started' : 'Scheduled';
    case MidtermCardKind.missed:
      return 'Missed';
    case MidtermCardKind.past:
      return 'Completed';
  }
}

/// `Sun, Oct 12, 2:00 PM` — the website's `toLocaleString("en-US", {weekday:"short",
/// month:"short", day:"numeric", hour:"numeric", minute:"2-digit"})`, in the PC's time zone.
String formatWhen(DateTime t) => DateFormat('EEE, MMM d, h:mm a', 'en_US').format(t.toLocal());

/// `Oct 12, 2:00 PM` (the "closed …" line under a missed row).
String formatClosed(DateTime t) => DateFormat('MMM d, h:mm a', 'en_US').format(t.toLocal());

/// MidtermList.tsx countdown: `1d 4h 5m`, `4h 5m 10s`, `5m 10s`. Null once [target] passed.
String? countdownLabel(DateTime target, DateTime now) {
  final ms = target.difference(now).inMilliseconds;
  if (ms <= 0) return null;
  final total = ms ~/ 1000;
  final d = total ~/ 86400;
  final h = (total % 86400) ~/ 3600;
  final m = (total % 3600) ~/ 60;
  final s = total % 60;
  if (d > 0) return '${d}d ${h}h ${m}m';
  if (h > 0) return '${h}h ${m}m ${s}s';
  return '${m}m ${s}s';
}

/// `Mathematics · 70 min · 44 questions`.
String midtermMeta(MidtermRow m) => [
      subjectLabelOf(m.subject),
      '${m.durationMinutes} min',
      if (m.questionCount > 0) '${m.questionCount} questions',
    ].join(' · ');

bool isReadingWriting(String subject) => subject == 'READING_WRITING' || subject.toLowerCase().contains('reading');

/// pastpaperLabels.ts `subjectLabel`.
String subjectLabelOf(String subject) {
  if (isReadingWriting(subject)) return 'Reading & Writing';
  if (subject == 'MATH' || subject.toLowerCase().contains('math')) return 'Mathematics';
  return subject;
}

/// Home polls `home` every 30 s only while a midterm could change state on its own
/// (design §2.a): upcoming, awaiting a code, or open and not started.
bool midtermsNeedPolling(List<MidtermRow> midterms) => midterms.any((m) =>
    !m.submitted && (m.isBeforeStart || m.awaitingCode || (m.isOpen && m.state == 'NOT_STARTED')));
