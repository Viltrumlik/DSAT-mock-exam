// `GET pastpapers/attempts/{id}/result` and `GET midterms/attempts/{id}/result`
// (design_data_server.md §2.f). While scoring both are 200 with `poll_after_ms`.
import 'attempt.dart';
import 'content.dart';
import 'home.dart';
import 'json.dart';

class ResultTotals {
  const ResultTotals({
    required this.questions,
    required this.answered,
    required this.correct,
    required this.incorrect,
    required this.skipped,
  });

  factory ResultTotals.fromJson(JsonReader r) => ResultTotals(
        questions: r.integer('questions'),
        answered: r.integer('answered'),
        correct: r.integer('correct'),
        incorrect: r.integer('incorrect'),
        skipped: r.integer('skipped'),
      );

  final int questions;
  final int answered;
  final int correct;
  final int incorrect;
  final int skipped;

  Map<String, Object?> toJson() => {
        'questions': questions,
        'answered': answered,
        'correct': correct,
        'incorrect': incorrect,
        'skipped': skipped,
      };
}

class ModuleScore {
  const ModuleScore({required this.order, required this.moduleId, required this.correct, required this.total});

  factory ModuleScore.fromJson(JsonReader r) => ModuleScore(
        order: r.integer('order'),
        moduleId: r.integer('module_id'),
        correct: r.integer('correct'),
        total: r.integer('total'),
      );

  final int order;
  final int moduleId;
  final int correct;
  final int total;

  Map<String, Object?> toJson() => {'order': order, 'module_id': moduleId, 'correct': correct, 'total': total};
}

/// Per-question correctness for the question grid and review.
class QuestionResult {
  const QuestionResult({
    required this.id,
    required this.moduleId,
    required this.order,
    this.studentAnswer,
    required this.correctAnswers,
    required this.isCorrect,
    required this.wasFlagged,
  });

  factory QuestionResult.fromJson(JsonReader r) => QuestionResult(
        id: r.integer('id'),
        moduleId: r.integer('module_id'),
        order: r.integer('order'),
        studentAnswer: r.stringOrNull('student_answer'),
        correctAnswers: r.string('correct_answers'),
        isCorrect: r.boolean('is_correct'),
        wasFlagged: r.boolean('was_flagged'),
      );

  final int id;
  final int moduleId;
  final int order;

  /// null when skipped.
  final String? studentAnswer;

  /// As stored: a letter, or comma-separated accepted grid-in values (`"7/2, 3.5"`).
  final String correctAnswers;
  final bool isCorrect;
  final bool wasFlagged;

  List<String> get acceptedAnswers =>
      correctAnswers.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(growable: false);

  Map<String, Object?> toJson() => {
        'id': id,
        'module_id': moduleId,
        'order': order,
        'student_answer': studentAnswer,
        'correct_answers': correctAnswers,
        'is_correct': isCorrect,
        'was_flagged': wasFlagged,
      };
}

/// `content[module_id]` — review content, null questions when the client's `have` matched.
class ResultContent {
  const ResultContent({required this.contentHash, this.questions});

  factory ResultContent.fromJson(JsonReader r) => ResultContent(
        contentHash: r.string('content_hash'),
        questions: r.objectsOrNull('questions', Question.fromJson),
      );

  final String contentHash;
  final List<Question>? questions;

  Map<String, Object?> toJson() =>
      {'content_hash': contentHash, 'questions': questions?.map((q) => q.toJson()).toList()};
}

/// Past-paper result. While [isScoring] only `attempt_id`, `state`, `poll_after_ms` are present.
class PastpaperResult {
  const PastpaperResult({
    this.schema = 1,
    required this.attemptId,
    required this.state,
    this.pollAfterMs,
    this.practiceTestId,
    this.score,
    this.previousScore,
    this.scoreDelta,
    this.completedAt,
    this.totals,
    this.modules = const [],
    this.questions = const [],
    this.content = const {},
    this.media = const [],
  });

  factory PastpaperResult.fromJson(JsonReader r) {
    final state = AttemptState.fromWire(r.string('state'), '${r.path}.state');
    if (state != AttemptState.completed) {
      return PastpaperResult(
        schema: r.integer('schema'),
        attemptId: r.integer('attempt_id'),
        state: state,
        pollAfterMs: r.integerOrNull('poll_after_ms'),
      );
    }
    return PastpaperResult(
      schema: r.integer('schema'),
      attemptId: r.integer('attempt_id'),
      state: state,
      pollAfterMs: r.integerOrNull('poll_after_ms'),
      practiceTestId: r.integer('practice_test_id'),
      score: r.integerOrNull('score'),
      previousScore: r.integerOrNull('previous_score'),
      scoreDelta: r.integerOrNull('score_delta'),
      completedAt: r.timestampOrNull('completed_at'),
      totals: ResultTotals.fromJson(r.object('totals')),
      modules: r.objects('modules', ModuleScore.fromJson),
      questions: r.objects('questions', QuestionResult.fromJson),
      content: intKeys(r.map('content', (v, p) => ResultContent.fromJson(JsonReader.of(v, p))), '${r.path}.content'),
      media: r.objects('media', MediaRef.fromJson),
    );
  }

  final int schema;
  final int attemptId;
  final AttemptState state;

  /// Set while scoring: ask again after this many ms.
  final int? pollAfterMs;
  final int? practiceTestId;
  final int? score;
  final int? previousScore;
  final int? scoreDelta;
  final DateTime? completedAt;
  final ResultTotals? totals;
  final List<ModuleScore> modules;
  final List<QuestionResult> questions;
  final Map<int, ResultContent> content;
  final List<MediaRef> media;

  bool get isCompleted => state == AttemptState.completed;
  bool get isScoring => !isCompleted;

  Map<String, Object?> toJson() {
    final base = <String, Object?>{
      'schema': schema,
      'attempt_id': attemptId,
      if (isCompleted) 'practice_test_id': practiceTestId,
      'state': state.wire,
      'poll_after_ms': pollAfterMs,
    };
    if (!isCompleted) return base;
    return {
      ...base,
      'score': score,
      'previous_score': previousScore,
      'score_delta': scoreDelta,
      'completed_at': formatTimestampOrNull(completedAt),
      'totals': totals?.toJson(),
      'modules': modules.map((m) => m.toJson()).toList(),
      'questions': questions.map((q) => q.toJson()).toList(),
      'content': {for (final e in content.entries) '${e.key}': e.value.toJson()},
      'media': media.map((m) => m.toJson()).toList(),
    };
  }
}

/// Midterm result: the legacy `review` shape plus `state` and `poll_after_ms`. The release
/// gate is unchanged — a classroom midterm stays `released:false` until the teacher publishes.
class MidtermResult {
  const MidtermResult({
    this.schema = 1,
    required this.attemptId,
    required this.state,
    this.pollAfterMs,
    this.scoreOnly = true,
    this.released = false,
    this.mockKind,
    this.subject,
    this.scoringScale,
    this.totalScore,
    this.scoreCeiling,
    this.certificate,
  });

  factory MidtermResult.fromJson(JsonReader r) {
    final state = AttemptState.fromWire(r.string('state'), '${r.path}.state');
    if (state != AttemptState.completed) {
      return MidtermResult(
        schema: r.integer('schema'),
        attemptId: r.integer('attempt_id'),
        state: state,
        pollAfterMs: r.integerOrNull('poll_after_ms'),
      );
    }
    return MidtermResult(
      schema: r.integer('schema'),
      attemptId: r.integer('attempt_id'),
      state: state,
      pollAfterMs: r.integerOrNull('poll_after_ms'),
      scoreOnly: r.boolean('score_only'),
      released: r.boolean('released'),
      mockKind: r.string('mock_kind'),
      subject: r.string('subject'),
      scoringScale: r.string('scoring_scale'),
      totalScore: r.integerOrNull('total_score'),
      scoreCeiling: r.integerOrNull('score_ceiling'),
      certificate: r.objectOrNull('certificate')?.let(MidtermCertificate.fromJson),
    );
  }

  final int schema;
  final int attemptId;
  final AttemptState state;
  final int? pollAfterMs;
  final bool scoreOnly;
  final bool released;
  final String? mockKind;
  final String? subject;
  final String? scoringScale;
  final int? totalScore;
  final int? scoreCeiling;
  final MidtermCertificate? certificate;

  bool get isCompleted => state == AttemptState.completed;

  Map<String, Object?> toJson() {
    final base = <String, Object?>{
      'schema': schema,
      'attempt_id': attemptId,
      'state': state.wire,
      'poll_after_ms': pollAfterMs,
    };
    if (!isCompleted) return base;
    return {
      ...base,
      'score_only': scoreOnly,
      'released': released,
      'mock_kind': mockKind,
      'subject': subject,
      'scoring_scale': scoringScale,
      'total_score': totalScore,
      'score_ceiling': scoreCeiling,
      'certificate': certificate?.toJson(),
    };
  }
}
