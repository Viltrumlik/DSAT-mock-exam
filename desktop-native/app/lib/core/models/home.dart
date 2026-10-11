// `GET /api/desktop/v1/home` (design_data_server.md §2.a + architecture §4.3-B history trim).
import 'json.dart';

class Student {
  const Student({required this.id, required this.firstName, required this.lastName});

  factory Student.fromJson(JsonReader r) =>
      Student(id: r.integer('id'), firstName: r.string('first_name'), lastName: r.string('last_name'));

  final int id;
  final String firstName;
  final String lastName;

  String get fullName => [firstName, lastName].where((s) => s.isNotEmpty).join(' ');

  Map<String, Object?> toJson() => {'id': id, 'first_name': firstName, 'last_name': lastName};
}

/// `app.update`: what Home should offer.
enum AppUpdate {
  none('none'),
  available('available'),
  required('required');

  const AppUpdate(this.wire);
  final String wire;
  static AppUpdate fromWire(String s, [String path = r'$']) => enumFromWire(values, s, (v) => v.wire, path);
}

/// `app` — the Windows release policy (mobile.policy "windows").
class AppPolicy {
  const AppPolicy({
    this.latestVersion,
    this.minimumVersion,
    required this.updateUrl,
    required this.update,
    required this.message,
  });

  factory AppPolicy.fromJson(JsonReader r) => AppPolicy(
        latestVersion: r.stringOrNull('latest_version'),
        minimumVersion: r.stringOrNull('minimum_version'),
        updateUrl: r.string('update_url'),
        update: AppUpdate.fromWire(r.string('update'), '${r.path}.update'),
        message: r.string('message'),
      );

  final String? latestVersion;
  final String? minimumVersion;
  final String updateUrl;
  final AppUpdate update;

  /// Console-provided text; "" when none.
  final String message;

  Map<String, Object?> toJson() => {
        'latest_version': latestVersion,
        'minimum_version': minimumVersion,
        'update_url': updateUrl,
        'update': update.wire,
        'message': message,
      };
}

/// `certificate` on a midterm row / result.
class MidtermCertificate {
  const MidtermCertificate({
    required this.available,
    required this.code,
    required this.downloadUrl,
    this.rank,
    this.cohortSize,
  });

  factory MidtermCertificate.fromJson(JsonReader r) => MidtermCertificate(
        available: r.boolean('available'),
        code: r.string('code'),
        downloadUrl: r.string('download_url'),
        rank: r.integerOrNull('rank'),
        cohortSize: r.integerOrNull('cohort_size'),
      );

  final bool available;
  final String code;

  /// Relative to `/api` (e.g. `/classes/certificates/midterm/<code>/download/`).
  final String downloadUrl;
  final int? rank;
  final int? cohortSize;

  Map<String, Object?> toJson() =>
      {'available': available, 'code': code, 'download_url': downloadUrl, 'rank': rank, 'cohort_size': cohortSize};
}

/// One row of `midterms` — exactly the `/api/midterms/mine/` row plus `requires_code`.
class MidtermRow {
  const MidtermRow({
    required this.midtermId,
    required this.title,
    required this.subject,
    required this.scoringScale,
    required this.scoreCeiling,
    required this.durationMinutes,
    required this.questionCount,
    required this.flavor,
    this.attemptId,
    required this.state,
    required this.submitted,
    required this.resitOpen,
    required this.isOpen,
    required this.isBeforeStart,
    required this.awaitingCode,
    this.availableAt,
    this.deadline,
    required this.resultsVisible,
    this.score,
    this.certificate,
    required this.requiresCode,
  });

  factory MidtermRow.fromJson(JsonReader r) => MidtermRow(
        midtermId: r.integer('midterm_id'),
        title: r.string('title'),
        subject: r.string('subject'),
        scoringScale: r.string('scoring_scale'),
        scoreCeiling: r.integer('score_ceiling'),
        durationMinutes: r.integer('duration_minutes'),
        questionCount: r.integer('question_count'),
        flavor: r.string('flavor'),
        attemptId: r.integerOrNull('attempt_id'),
        state: r.string('state'),
        submitted: r.boolean('submitted'),
        resitOpen: r.boolean('resit_open'),
        isOpen: r.boolean('is_open'),
        isBeforeStart: r.boolean('is_before_start'),
        awaitingCode: r.boolean('awaiting_code'),
        availableAt: r.timestampOrNull('available_at'),
        deadline: r.timestampOrNull('deadline'),
        resultsVisible: r.boolean('results_visible'),
        score: r.integerOrNull('score'),
        certificate: r.objectOrNull('certificate')?.let(MidtermCertificate.fromJson),
        requiresCode: r.boolean('requires_code'),
      );

  final int midtermId;
  final String title;
  final String subject;

  /// `SCALE_100` | `SCALE_800`.
  final String scoringScale;
  final int scoreCeiling;
  final int durationMinutes;
  final int questionCount;

  /// `CLASSROOM` | `STANDALONE`.
  final String flavor;
  final int? attemptId;

  /// Attempt wire state, `NOT_STARTED` when there is no attempt.
  final String state;
  final bool submitted;
  final bool resitOpen;
  final bool isOpen;
  final bool isBeforeStart;
  final bool awaitingCode;
  final DateTime? availableAt;
  final DateTime? deadline;
  final bool resultsVisible;
  final int? score;
  final MidtermCertificate? certificate;

  /// Whether the 6-digit code screen is needed (skip it when false).
  final bool requiresCode;

  Map<String, Object?> toJson() => {
        'midterm_id': midtermId,
        'title': title,
        'subject': subject,
        'scoring_scale': scoringScale,
        'score_ceiling': scoreCeiling,
        'duration_minutes': durationMinutes,
        'question_count': questionCount,
        'flavor': flavor,
        'attempt_id': attemptId,
        'state': state,
        'submitted': submitted,
        'resit_open': resitOpen,
        'is_open': isOpen,
        'is_before_start': isBeforeStart,
        'awaiting_code': awaitingCode,
        'available_at': formatTimestampOrNull(availableAt),
        'deadline': formatTimestampOrNull(deadline),
        'results_visible': resultsVisible,
        'score': score,
        'certificate': certificate?.toJson(),
        'requires_code': requiresCode,
      };
}

/// `pastpapers[].modules[]`.
class PastpaperModuleMeta {
  const PastpaperModuleMeta({required this.order, required this.timeLimitMinutes, required this.questionCount});

  factory PastpaperModuleMeta.fromJson(JsonReader r) => PastpaperModuleMeta(
        order: r.integer('order'),
        timeLimitMinutes: r.integer('time_limit_minutes'),
        questionCount: r.integer('question_count'),
      );

  final int order;
  final int timeLimitMinutes;
  final int questionCount;

  Map<String, Object?> toJson() =>
      {'order': order, 'time_limit_minutes': timeLimitMinutes, 'question_count': questionCount};
}

/// Card status, computed on the server (the 0.1.0 "assigned again" bug cannot come back).
enum PastpaperStatus {
  newPaper('new'),
  progress('progress'),
  reopened('reopened'),
  completed('completed');

  const PastpaperStatus(this.wire);
  final String wire;
  static PastpaperStatus fromWire(String s, [String path = r'$']) => enumFromWire(values, s, (v) => v.wire, path);
}

/// `state.reopened` — the paper was set again by a teacher.
class ReopenedInfo {
  const ReopenedInfo({
    required this.assignmentId,
    required this.assignmentTitle,
    required this.classroomName,
    this.setAt,
    this.dueAt,
  });

  factory ReopenedInfo.fromJson(JsonReader r) => ReopenedInfo(
        assignmentId: r.integer('assignment_id'),
        assignmentTitle: r.string('assignment_title'),
        classroomName: r.string('classroom_name'),
        setAt: r.timestampOrNull('set_at'),
        dueAt: r.timestampOrNull('due_at'),
      );

  final int assignmentId;
  final String assignmentTitle;
  final String classroomName;
  final DateTime? setAt;
  final DateTime? dueAt;

  Map<String, Object?> toJson() => {
        'assignment_id': assignmentId,
        'assignment_title': assignmentTitle,
        'classroom_name': classroomName,
        'set_at': formatTimestampOrNull(setAt),
        'due_at': formatTimestampOrNull(dueAt),
      };
}

/// `pastpapers[].state` — the slim per-student state.
class PastpaperState {
  const PastpaperState({
    required this.status,
    this.openAttemptId,
    this.openState,
    this.lastAttemptId,
    this.lastScore,
    this.lastCompletedAt,
    required this.sittings,
    this.reopened,
  });

  factory PastpaperState.fromJson(JsonReader r) => PastpaperState(
        status: PastpaperStatus.fromWire(r.string('status'), '${r.path}.status'),
        openAttemptId: r.integerOrNull('open_attempt_id'),
        openState: r.stringOrNull('open_state'),
        lastAttemptId: r.integerOrNull('last_attempt_id'),
        lastScore: r.integerOrNull('last_score'),
        lastCompletedAt: r.timestampOrNull('last_completed_at'),
        sittings: r.integer('sittings'),
        reopened: r.objectOrNull('reopened')?.let(ReopenedInfo.fromJson),
      );

  final PastpaperStatus status;

  /// The attempt "Resume" continues (v1 `open` restores it, never abandons it).
  final int? openAttemptId;
  final String? openState;
  final int? lastAttemptId;
  final int? lastScore;
  final DateTime? lastCompletedAt;

  /// Completed sittings.
  final int sittings;
  final ReopenedInfo? reopened;

  Map<String, Object?> toJson() => {
        'status': status.wire,
        'open_attempt_id': openAttemptId,
        'open_state': openState,
        'last_attempt_id': lastAttemptId,
        'last_score': lastScore,
        'last_completed_at': formatTimestampOrNull(lastCompletedAt),
        'sittings': sittings,
        'reopened': reopened?.toJson(),
      };
}

/// `pastpapers[].history[]` — "History · N attempts", newest first.
class HistoryEntry {
  const HistoryEntry({required this.attemptId, this.score, this.completedAt});

  factory HistoryEntry.fromJson(JsonReader r) => HistoryEntry(
        attemptId: r.integer('attempt_id'),
        score: r.integerOrNull('score'),
        completedAt: r.timestampOrNull('completed_at'),
      );

  final int attemptId;
  final int? score;
  final DateTime? completedAt;

  Map<String, Object?> toJson() =>
      {'attempt_id': attemptId, 'score': score, 'completed_at': formatTimestampOrNull(completedAt)};
}

/// One past-paper section in the library.
class PastpaperRow {
  const PastpaperRow({
    required this.id,
    required this.title,
    this.practiceDate,
    required this.subject,
    required this.label,
    required this.formType,
    required this.collectionName,
    required this.modules,
    required this.state,
    required this.history,
  });

  factory PastpaperRow.fromJson(JsonReader r) => PastpaperRow(
        id: r.integer('id'),
        title: r.string('title'),
        practiceDate: r.stringOrNull('practice_date'),
        subject: r.string('subject'),
        label: r.string('label'),
        formType: r.string('form_type'),
        collectionName: r.string('collection_name'),
        modules: r.objects('modules', PastpaperModuleMeta.fromJson),
        state: PastpaperState.fromJson(r.object('state')),
        history: r.objects('history', HistoryEntry.fromJson),
      );

  /// practice_test id.
  final int id;
  final String title;

  /// `YYYY-MM-DD`; groups the library by month.
  final String? practiceDate;

  /// `MATH` | `READING_WRITING`.
  final String subject;
  final String label;

  /// `US` | `INTERNATIONAL`.
  final String formType;
  final String collectionName;
  final List<PastpaperModuleMeta> modules;
  final PastpaperState state;
  final List<HistoryEntry> history;

  Map<String, Object?> toJson() => {
        'id': id,
        'title': title,
        'practice_date': practiceDate,
        'subject': subject,
        'label': label,
        'form_type': formType,
        'collection_name': collectionName,
        'modules': modules.map((m) => m.toJson()).toList(),
        'state': state.toJson(),
        'history': history.map((h) => h.toJson()).toList(),
      };
}

/// The whole Home payload (cached in SQLite; refreshed with If-None-Match).
class HomeResponse {
  const HomeResponse({
    this.schema = 1,
    required this.serverNow,
    required this.student,
    required this.app,
    required this.midterms,
    required this.pastpapers,
  });

  factory HomeResponse.fromJson(JsonReader r) => HomeResponse(
        schema: r.integer('schema'),
        serverNow: r.timestamp('server_now'),
        student: Student.fromJson(r.object('student')),
        app: AppPolicy.fromJson(r.object('app')),
        midterms: r.objects('midterms', MidtermRow.fromJson),
        pastpapers: r.objects('pastpapers', PastpaperRow.fromJson),
      );

  final int schema;
  final DateTime serverNow;
  final Student student;
  final AppPolicy app;
  final List<MidtermRow> midterms;
  final List<PastpaperRow> pastpapers;

  Map<String, Object?> toJson() => {
        'schema': schema,
        'server_now': formatTimestamp(serverNow),
        'student': student.toJson(),
        'app': app.toJson(),
        'midterms': midterms.map((m) => m.toJson()).toList(),
        'pastpapers': pastpapers.map((p) => p.toJson()).toList(),
      };
}
