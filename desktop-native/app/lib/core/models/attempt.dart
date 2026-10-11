// AttemptLite — the small attempt snapshot every v1 read and write returns
// (design_data_server.md §2.0). Fixtures: contracts/v1/*.json → "attempt".
import 'json.dart';

/// Past paper or midterm. Wire: `pastpaper` | `midterm`.
enum AttemptKind {
  pastpaper('pastpaper'),
  midterm('midterm');

  const AttemptKind(this.wire);
  final String wire;

  static AttemptKind fromWire(String s, [String path = r'$']) =>
      enumFromWire(values, s, (v) => v.wire, path);
}

/// Server attempt states, with their existing wire names (exams + midterms state machines).
enum AttemptState {
  notStarted('NOT_STARTED'),
  module1Active('MODULE_1_ACTIVE'),
  module1Submitted('MODULE_1_SUBMITTED'),
  module2Active('MODULE_2_ACTIVE'),
  module2Submitted('MODULE_2_SUBMITTED'),
  scoring('SCORING'),
  completed('COMPLETED'),
  abandoned('ABANDONED');

  const AttemptState(this.wire);
  final String wire;

  static AttemptState fromWire(String s, [String path = r'$']) =>
      enumFromWire(values, s, (v) => v.wire, path);

  /// A module is running on the server (answers are accepted for it).
  bool get isActive => this == module1Active || this == module2Active;

  /// The sitting is handed in; no more answers.
  bool get isFinished => this == scoring || this == completed;
}

/// `timing` — the authoritative server clock block (design §1.8).
class Timing {
  const Timing({required this.serverNow, this.deadlineAt, this.remainingMs, required this.paused});

  factory Timing.fromJson(JsonReader r) => Timing(
        serverNow: r.timestamp('server_now'),
        deadlineAt: r.timestampOrNull('deadline_at'),
        remainingMs: r.integerOrNull('remaining_ms'),
        paused: r.boolean('paused'),
      );

  final DateTime serverNow;

  /// Null while paused, before start, and once the sitting is handed in.
  final DateTime? deadlineAt;

  /// Milliseconds left in the live module (frozen while paused); null once handed in.
  final int? remainingMs;
  final bool paused;

  Map<String, Object?> toJson() => {
        'server_now': formatTimestamp(serverNow),
        'deadline_at': formatTimestampOrNull(deadlineAt),
        'remaining_ms': remainingMs,
        'paused': paused,
      };
}

/// `attempt.module` — the live (or next-to-start) module.
class ModuleRef {
  const ModuleRef({required this.id, required this.order, required this.durationMs});

  factory ModuleRef.fromJson(JsonReader r) =>
      ModuleRef(id: r.integer('id'), order: r.integer('order'), durationMs: r.integer('duration_ms'));

  final int id;
  final int order;
  final int durationMs;

  Map<String, Object?> toJson() => {'id': id, 'order': order, 'duration_ms': durationMs};
}

/// `attempt.midterm` — present only for midterms.
class MidtermAttemptInfo {
  const MidtermAttemptInfo({
    required this.offscreenViolations,
    required this.offscreenLimit,
    required this.offscreenGraceSeconds,
    this.terminatedReason,
    required this.desktopRequired,
    required this.lateGraceSeconds,
  });

  factory MidtermAttemptInfo.fromJson(JsonReader r) => MidtermAttemptInfo(
        offscreenViolations: r.integer('offscreen_violations'),
        offscreenLimit: r.integer('offscreen_limit'),
        offscreenGraceSeconds: r.integer('offscreen_grace_seconds'),
        terminatedReason: r.stringOrNull('terminated_reason'),
        desktopRequired: r.boolean('desktop_required'),
        lateGraceSeconds: r.integer('late_grace_seconds'),
      );

  final int offscreenViolations;
  final int offscreenLimit;
  final int offscreenGraceSeconds;

  /// e.g. `OFFSCREEN` after the third strike.
  final String? terminatedReason;
  final bool desktopRequired;

  /// 300: answers the server has never seen are accepted until deadline + this.
  final int lateGraceSeconds;

  bool get terminated => terminatedReason != null;

  Map<String, Object?> toJson() => {
        'offscreen_violations': offscreenViolations,
        'offscreen_limit': offscreenLimit,
        'offscreen_grace_seconds': offscreenGraceSeconds,
        'terminated_reason': terminatedReason,
        'desktop_required': desktopRequired,
        'late_grace_seconds': lateGraceSeconds,
      };
}

/// AttemptLite: state, timing and version only (no questions, no profile).
class AttemptLite {
  const AttemptLite({
    required this.id,
    required this.kind,
    required this.refId,
    required this.state,
    required this.version,
    this.module,
    required this.moduleIds,
    required this.timing,
    required this.resultsReady,
    this.score,
    this.midterm,
  });

  factory AttemptLite.fromJson(JsonReader r) => AttemptLite(
        id: r.integer('id'),
        kind: AttemptKind.fromWire(r.string('kind'), '${r.path}.kind'),
        refId: r.integer('ref_id'),
        state: AttemptState.fromWire(r.string('state'), '${r.path}.state'),
        version: r.integer('version'),
        module: r.objectOrNull('module')?.let(ModuleRef.fromJson),
        moduleIds: r.ints('module_ids'),
        timing: Timing.fromJson(r.object('timing')),
        resultsReady: r.boolean('results_ready'),
        score: r.integerOrNull('score'),
        midterm: r.objectOrNull('midterm')?.let(MidtermAttemptInfo.fromJson),
      );

  final int id;
  final AttemptKind kind;

  /// practice_test id (past paper) or midterm id.
  final int refId;
  final AttemptState state;
  final int version;

  /// Null once the sitting is handed in (SCORING / COMPLETED).
  final ModuleRef? module;
  final List<int> moduleIds;
  final Timing timing;
  final bool resultsReady;

  /// Always null for midterms.
  final int? score;
  final MidtermAttemptInfo? midterm;

  Map<String, Object?> toJson() => {
        'id': id,
        'kind': kind.wire,
        'ref_id': refId,
        'state': state.wire,
        'version': version,
        'module': module?.toJson(),
        'module_ids': moduleIds,
        'timing': timing.toJson(),
        'results_ready': resultsReady,
        'score': score,
        'midterm': midterm?.toJson(),
      };
}

/// `{"schema":1,"attempt":{…}}` — start, pause and resume responses.
class AttemptEnvelope {
  const AttemptEnvelope({this.schema = 1, required this.attempt});

  factory AttemptEnvelope.fromJson(JsonReader r) =>
      AttemptEnvelope(schema: r.integer('schema'), attempt: AttemptLite.fromJson(r.object('attempt')));

  final int schema;
  final AttemptLite attempt;

  Map<String, Object?> toJson() => {'schema': schema, 'attempt': attempt.toJson()};
}
