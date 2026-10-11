// Request bodies and "lite" write responses (design_data_server.md §2.b–§2.d).
import 'attempt.dart';
import 'content.dart';
import 'json.dart';

/// Body of `POST pastpapers/{practice_test_id}/open`.
class PastpaperOpenRequest {
  const PastpaperOpenRequest({required this.start, this.have = const {}});

  factory PastpaperOpenRequest.fromJson(JsonReader r) => PastpaperOpenRequest(
        start: r.boolean('start'),
        have: intKeys(r.map('have', jsonString), '${r.path}.have'),
      );

  /// false when a Welcome screen will call `start` later.
  final bool start;

  /// module id → cached `content_hash`; matching modules come back `unchanged`.
  final Map<int, String> have;

  Map<String, Object?> toJson() => {'start': start, 'have': stringKeys(have)};
}

/// Body of `POST midterms/attempts/{id}/open`.
class MidtermOpenRequest {
  const MidtermOpenRequest({this.have = const {}});

  factory MidtermOpenRequest.fromJson(JsonReader r) =>
      MidtermOpenRequest(have: intKeys(r.map('have', jsonString), '${r.path}.have'));

  final Map<int, String> have;

  Map<String, Object?> toJson() => {'have': stringKeys(have)};
}

/// Body of `sync` and `submit` (both kinds): the FULL module answer map, frozen when queued.
/// A cleared answer is sent as "". Key: `sync.{attempt}.{module}.{seq}` / `submit.{attempt}.{module}`.
class SyncRequest {
  const SyncRequest({required this.moduleId, required this.seq, required this.answers, required this.flagged});

  factory SyncRequest.fromJson(JsonReader r) => SyncRequest(
        moduleId: r.integer('module_id'),
        seq: r.integer('seq'),
        answers: intKeys(r.map('answers', jsonString), '${r.path}.answers'),
        flagged: r.ints('flagged'),
      );

  final int moduleId;

  /// The journal sequence this payload was built from.
  final int seq;

  /// question id → value; every question of the module, "" when unanswered.
  final Map<int, String> answers;
  final List<int> flagged;

  Map<String, Object?> toJson() =>
      {'module_id': moduleId, 'seq': seq, 'answers': stringKeys(answers), 'flagged': flagged};
}

/// `{"schema":1,"applied":bool,"reason":…,"attempt":{…}}` — sync responses.
class WriteOutcome {
  const WriteOutcome({this.schema = 1, required this.applied, this.reason, required this.attempt});

  factory WriteOutcome.fromJson(JsonReader r) => WriteOutcome(
        schema: r.integer('schema'),
        applied: r.boolean('applied'),
        reason: r.stringOrNull('reason'),
        attempt: AttemptLite.fromJson(r.object('attempt')),
      );

  final int schema;
  final bool applied;

  /// null | `module_not_active` | `late` (midterm, beyond deadline + 300 s).
  final String? reason;
  final AttemptLite attempt;

  Map<String, Object?> toJson() =>
      {'schema': schema, 'applied': applied, 'reason': reason, 'attempt': attempt.toJson()};
}

/// `result` on a submit that moved into SCORING.
class ResultPoll {
  const ResultPoll({required this.pollAfterMs});

  factory ResultPoll.fromJson(JsonReader r) => ResultPoll(pollAfterMs: r.integer('poll_after_ms'));

  final int pollAfterMs;

  Map<String, Object?> toJson() => {'poll_after_ms': pollAfterMs};
}

/// Submit response (both kinds).
class SubmitOutcome {
  const SubmitOutcome({
    this.schema = 1,
    required this.applied,
    this.reason,
    this.transitionedTo,
    required this.attempt,
    this.nextModule,
    this.media = const [],
    this.result,
  });

  factory SubmitOutcome.fromJson(JsonReader r) => SubmitOutcome(
        schema: r.integer('schema'),
        applied: r.boolean('applied'),
        reason: r.stringOrNull('reason'),
        transitionedTo: r.stringOrNull('transitioned_to')?.let((s) => AttemptState.fromWire(s, '${r.path}.transitioned_to')),
        attempt: AttemptLite.fromJson(r.object('attempt')),
        nextModule: r.objectOrNull('next_module')?.let(ModuleContent.fromJson),
        media: r.objects('media', MediaRef.fromJson),
        result: r.objectOrNull('result')?.let(ResultPoll.fromJson),
      );

  final int schema;
  final bool applied;
  final String? reason;

  /// `MODULE_2_ACTIVE` | `SCORING` | null (no-op / replay of a non-live module).
  final AttemptState? transitionedTo;
  final AttemptLite attempt;

  /// Midterms always; past papers only when module 2 was deferred.
  final ModuleContent? nextModule;

  /// Images for [nextModule] (midterm: 15-minute URLs).
  final List<MediaRef> media;
  final ResultPoll? result;

  Map<String, Object?> toJson() => {
        'schema': schema,
        'applied': applied,
        'reason': reason,
        'transitioned_to': transitionedTo?.wire,
        'attempt': attempt.toJson(),
        'next_module': nextModule?.toJson(),
        'media': media.map((m) => m.toJson()).toList(),
        'result': result?.toJson(),
      };
}

/// Body of `POST midterms/attempts/{id}/offscreen` (informational; one strike per key).
class OffscreenRequest {
  const OffscreenRequest({required this.eventId, required this.occurredAt, required this.awayMs});

  factory OffscreenRequest.fromJson(JsonReader r) => OffscreenRequest(
        eventId: r.string('event_id'),
        occurredAt: r.timestamp('occurred_at'),
        awayMs: r.integer('away_ms'),
      );

  /// UUID created and persisted when the event happens; also in the key `off.{attempt}.{uuid}`.
  final String eventId;
  final DateTime occurredAt;
  final int awayMs;

  Map<String, Object?> toJson() =>
      {'event_id': eventId, 'occurred_at': formatTimestamp(occurredAt), 'away_ms': awayMs};
}

/// Offscreen response: the server's strike count is the truth.
class OffscreenOutcome {
  const OffscreenOutcome({
    this.schema = 1,
    required this.violations,
    required this.limit,
    required this.graceSeconds,
    required this.terminated,
    required this.attempt,
  });

  factory OffscreenOutcome.fromJson(JsonReader r) => OffscreenOutcome(
        schema: r.integer('schema'),
        violations: r.integer('violations'),
        limit: r.integer('limit'),
        graceSeconds: r.integer('grace_seconds'),
        terminated: r.boolean('terminated'),
        attempt: AttemptLite.fromJson(r.object('attempt')),
      );

  final int schema;
  final int violations;
  final int limit;

  /// 0 once the allowance is spent.
  final int graceSeconds;
  final bool terminated;
  final AttemptLite attempt;

  Map<String, Object?> toJson() => {
        'schema': schema,
        'violations': violations,
        'limit': limit,
        'grace_seconds': graceSeconds,
        'terminated': terminated,
        'attempt': attempt.toJson(),
      };
}

/// Body of `POST midterms/{midterm_id}/prepare`.
class MidtermPrepareRequest {
  const MidtermPrepareRequest({this.code});

  factory MidtermPrepareRequest.fromJson(JsonReader r) => MidtermPrepareRequest(code: r.stringOrNull('code'));

  /// The teacher's 6-digit code, once entered.
  final String? code;

  Map<String, Object?> toJson() => {if (code != null) 'code': code};
}

/// `rules` — what the rules screen shows.
class MidtermRules {
  const MidtermRules({
    required this.title,
    required this.subject,
    required this.questionCount,
    required this.moduleCount,
    required this.durationsMin,
    this.calculator,
    required this.offscreenLimit,
    required this.offscreenGraceSeconds,
    required this.lateGraceSeconds,
    this.scoringScale,
    this.passMark,
    this.isRetake = false,
  });

  factory MidtermRules.fromJson(JsonReader r) => MidtermRules(
        title: r.string('title'),
        subject: r.string('subject'),
        questionCount: r.integer('question_count'),
        moduleCount: r.integer('module_count'),
        durationsMin: r.ints('durations_min'),
        calculator: CalculatorMode.fromWireOrNull(r.stringOrNull('calculator'), '${r.path}.calculator'),
        offscreenLimit: r.integer('offscreen_limit'),
        offscreenGraceSeconds: r.integer('offscreen_grace_seconds'),
        lateGraceSeconds: r.integer('late_grace_seconds'),
        // Read leniently (additive keys, 2026-10-11): a reply without them quotes no pass
        // mark and no retake line, which is what the website shows when it lacks them.
        scoringScale: r.stringOrNull('scoring_scale'),
        passMark: r.integerOrNull('pass_mark'),
        isRetake: r.booleanOrNull('is_retake') ?? false,
      );

  final String title;

  /// `MATH` | `READING_WRITING`.
  final String subject;
  final int questionCount;
  final int moduleCount;
  final List<int> durationsMin;

  /// The paper's calculator rule (`Midterm.calculator_mode`): graphing at Math middle/senior,
  /// scientific at junior, null for R&W, an untagged paper and Foundation Math (worked by hand).
  final CalculatorMode? calculator;
  final int offscreenLimit;
  final int offscreenGraceSeconds;
  final int lateGraceSeconds;

  /// `SCALE_100` | `SCALE_800` — the sitting's own (pinned at start); null when not sent.
  final String? scoringScale;

  /// The mark to pass on [scoringScale] (the server already resolved the scale default);
  /// null when the sitting is not judged pass/fail (a pre-midterm) or not sent.
  final int? passMark;

  /// This sitting IS the retake (the retake rule is worded in the past tense).
  final bool isRetake;

  /// The same subject test the runner's tools use ([TestInfo.isMath]).
  bool get isMath => subject == 'MATH';

  Map<String, Object?> toJson() => {
        'title': title,
        'subject': subject,
        'question_count': questionCount,
        'module_count': moduleCount,
        'durations_min': durationsMin,
        'calculator': calculator?.wire,
        'offscreen_limit': offscreenLimit,
        'offscreen_grace_seconds': offscreenGraceSeconds,
        'late_grace_seconds': lateGraceSeconds,
        'scoring_scale': scoringScale,
        'pass_mark': passMark,
        'is_retake': isRetake,
      };
}

/// `POST midterms/{midterm_id}/prepare` response. No questions.
class MidtermPrepareResponse {
  const MidtermPrepareResponse({
    this.schema = 1,
    required this.attempt,
    required this.requiresCode,
    required this.codeVerified,
    required this.rules,
  });

  factory MidtermPrepareResponse.fromJson(JsonReader r) => MidtermPrepareResponse(
        schema: r.integer('schema'),
        attempt: AttemptLite.fromJson(r.object('attempt')),
        requiresCode: r.boolean('requires_code'),
        codeVerified: r.boolean('code_verified'),
        rules: MidtermRules.fromJson(r.object('rules')),
      );

  final int schema;
  final AttemptLite attempt;
  final bool requiresCode;
  final bool codeVerified;
  final MidtermRules rules;

  /// The code screen can be skipped.
  bool get mayProceed => !requiresCode || codeVerified;

  Map<String, Object?> toJson() => {
        'schema': schema,
        'attempt': attempt.toJson(),
        'requires_code': requiresCode,
        'code_verified': codeVerified,
        'rules': rules.toJson(),
      };
}
