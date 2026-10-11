// Question content and the exam bundle returned by `pastpapers/{id}/open` and
// `midterms/attempts/{id}/open` (design_data_server.md §2.b, §2.d).
// Questions are passed to the content island UNCHANGED (architecture §2.7 `module.load`),
// so [Question.toJson] must reproduce the wire object exactly.
import 'dart:convert';

import 'package:crypto/crypto.dart';

import 'attempt.dart';
import 'json.dart';

/// One answer choice. `image_key` is a storage key, resolved through [MediaRef].
class QuestionOption {
  const QuestionOption({required this.text, this.imageKey});

  factory QuestionOption.fromJson(JsonReader r) =>
      QuestionOption(text: r.string('text'), imageKey: r.stringOrNull('image_key'));

  /// Rich HTML / inline LaTeX (`$…$`), sanitised and rendered by the island.
  final String text;
  final String? imageKey;

  Map<String, Object?> toJson() => {'text': text, 'image_key': imageKey};
}

/// A question as served in a bundle: QuestionSerializer's fields, minus signed URLs,
/// plus `order` and image keys. Never carries the answer key.
class Question {
  const Question({
    required this.id,
    required this.order,
    required this.questionType,
    required this.isMathInput,
    required this.questionText,
    required this.questionPrompt,
    this.questionImageKey,
    this.options,
  });

  factory Question.fromJson(JsonReader r) => Question(
        id: r.integer('id'),
        order: r.integer('order'),
        questionType: r.string('question_type'),
        isMathInput: r.boolean('is_math_input'),
        questionText: r.string('question_text'),
        questionPrompt: r.string('question_prompt'),
        questionImageKey: r.stringOrNull('question_image_key'),
        options: r.mapOrNull('options', (v, p) => QuestionOption.fromJson(JsonReader.of(v, p))),
      );

  final int id;
  final int order;

  /// `MATH` | `READING` | `WRITING`.
  final String questionType;

  /// Grid-in (student-produced response): the island shows the SPR input, no choices.
  final bool isMathInput;

  /// HTML: the passage (R&W) or the stem (Math). May hold <u>, <sup>, <table>, `$…$`.
  final String questionText;

  /// The question line under the passage; often "" for Math.
  final String questionPrompt;
  final String? questionImageKey;

  /// `{"A": …, "B": …}` in key order; null for grid-ins.
  final Map<String, QuestionOption>? options;

  bool get isReadingWriting => questionType != 'MATH';

  /// Choice letters in display order (empty for grid-ins).
  List<String> get choiceKeys => options?.keys.toList(growable: false) ?? const [];

  /// Every storage key this question needs (question image + option images).
  Iterable<String> get imageKeys sync* {
    if (questionImageKey != null) yield questionImageKey!;
    for (final o in options?.values ?? const <QuestionOption>[]) {
      if (o.imageKey != null) yield o.imageKey!;
    }
  }

  Map<String, Object?> toJson() => {
        'id': id,
        'order': order,
        'question_type': questionType,
        'is_math_input': isMathInput,
        'question_text': questionText,
        'question_prompt': questionPrompt,
        'question_image_key': questionImageKey,
        'options': options == null ? null : {for (final e in options!.entries) e.key: e.value.toJson()},
      };
}

/// One module of content. `questions` is null when [unchanged] (the client's `have` hash
/// matched) or [deferred] (module 2 held back; it arrives as `submit.next_module`).
class ModuleContent {
  const ModuleContent({
    required this.id,
    required this.order,
    required this.timeLimitMinutes,
    required this.questionCount,
    required this.contentHash,
    required this.unchanged,
    required this.deferred,
    this.questions,
  });

  factory ModuleContent.fromJson(JsonReader r) => ModuleContent(
        id: r.integer('id'),
        order: r.integer('order'),
        timeLimitMinutes: r.integer('time_limit_minutes'),
        questionCount: r.integer('question_count'),
        contentHash: r.string('content_hash'),
        unchanged: r.boolean('unchanged'),
        deferred: r.boolean('deferred'),
        questions: r.objectsOrNull('questions', Question.fromJson),
      );

  final int id;
  final int order;
  final int timeLimitMinutes;
  final int questionCount;

  /// `sha256:<hex>` over canonical JSON of the question list (contracts/v1/README.md).
  final String contentHash;
  final bool unchanged;
  final bool deferred;
  final List<Question>? questions;

  ModuleContent withQuestions(List<Question> qs) => ModuleContent(
        id: id,
        order: order,
        timeLimitMinutes: timeLimitMinutes,
        questionCount: questionCount,
        contentHash: contentHash,
        unchanged: false,
        deferred: false,
        questions: qs,
      );

  Map<String, Object?> toJson() => {
        'id': id,
        'order': order,
        'time_limit_minutes': timeLimitMinutes,
        'question_count': questionCount,
        'content_hash': contentHash,
        'unchanged': unchanged,
        'deferred': deferred,
        'questions': questions?.map((q) => q.toJson()).toList(),
      };
}

/// Calculator offered for the test. Wire: `graphing` | `scientific` | null (none).
enum CalculatorMode {
  graphing('graphing'),
  scientific('scientific');

  const CalculatorMode(this.wire);
  final String wire;

  static CalculatorMode? fromWireOrNull(String? s, [String path = r'$']) =>
      s == null ? null : enumFromWire(values, s, (v) => v.wire, path);
}

/// `test.tools`.
class TestTools {
  const TestTools({this.calculator, required this.referenceSheet});

  factory TestTools.fromJson(JsonReader r) => TestTools(
        calculator: CalculatorMode.fromWireOrNull(r.stringOrNull('calculator'), '${r.path}.calculator'),
        referenceSheet: r.boolean('reference_sheet'),
      );

  final CalculatorMode? calculator;
  final bool referenceSheet;

  bool get calculatorAllowed => calculator != null;
  bool get scientificOnly => calculator == CalculatorMode.scientific;

  Map<String, Object?> toJson() => {'calculator': calculator?.wire, 'reference_sheet': referenceSheet};
}

/// `test` — what the runner header needs about the paper or midterm.
class TestInfo {
  const TestInfo({
    required this.id,
    required this.subject,
    required this.title,
    this.label,
    this.formType,
    this.practiceDate,
    this.collectionName,
    required this.tools,
  });

  factory TestInfo.fromJson(JsonReader r) => TestInfo(
        id: r.integer('id'),
        subject: r.string('subject'),
        title: r.string('title'),
        label: r.stringOrNull('label'),
        formType: r.stringOrNull('form_type'),
        practiceDate: r.stringOrNull('practice_date'),
        collectionName: r.stringOrNull('collection_name'),
        tools: TestTools.fromJson(r.object('tools')),
      );

  /// practice_test id or midterm id.
  final int id;

  /// `MATH` | `READING_WRITING`.
  final String subject;

  /// Often "" for past papers (the UI composes a title from collection + subject).
  final String title;
  final String? label;

  /// `US` | `INTERNATIONAL` (past papers).
  final String? formType;

  /// `YYYY-MM-DD` (past papers).
  final String? practiceDate;
  final String? collectionName;
  final TestTools tools;

  bool get isMath => subject == 'MATH';

  Map<String, Object?> toJson() => {
        'id': id,
        'subject': subject,
        'title': title,
        'label': label,
        'form_type': formType,
        'practice_date': practiceDate,
        'collection_name': collectionName,
        'tools': tools.toJson(),
      };
}

/// One image to fetch: cache by [key] (storage keys never get new bytes), fetch via [url].
class MediaRef {
  const MediaRef({required this.key, required this.url, required this.expiresAt});

  factory MediaRef.fromJson(JsonReader r) =>
      MediaRef(key: r.string('key'), url: r.string('url'), expiresAt: r.timestamp('expires_at'));

  final String key;
  final String url;
  final DateTime expiresAt;

  Map<String, Object?> toJson() => {'key': key, 'url': url, 'expires_at': formatTimestamp(expiresAt)};
}

/// The website's `Annotation` (annotations.ts:29-39).
enum AnnotationKind {
  highlight('highlight'),
  underline('underline');

  const AnnotationKind(this.wire);
  final String wire;
  static AnnotationKind fromWire(String s, [String path = r'$']) => enumFromWire(values, s, (v) => v.wire, path);
}

enum HighlightColor {
  yellow('yellow'),
  blue('blue'),
  pink('pink');

  const HighlightColor(this.wire);
  final String wire;
  static HighlightColor? fromWireOrNull(String? s, [String path = r'$']) =>
      s == null ? null : enumFromWire(values, s, (v) => v.wire, path);
}

enum UnderlineStyle {
  solid('solid'),
  dashed('dashed'),
  dotted('dotted');

  const UnderlineStyle(this.wire);
  final String wire;
  static UnderlineStyle? fromWireOrNull(String? s, [String path = r'$']) =>
      s == null ? null : enumFromWire(values, s, (v) => v.wire, path);
}

/// `{start, end, kind, color?, underline?}` — character offsets within one container.
class Annotation {
  const Annotation({required this.start, required this.end, required this.kind, this.color, this.underline});

  factory Annotation.fromJson(JsonReader r) => Annotation(
        start: r.integer('start'),
        end: r.integer('end'),
        kind: AnnotationKind.fromWire(r.string('kind'), '${r.path}.kind'),
        color: HighlightColor.fromWireOrNull(r.stringOrNull('color'), '${r.path}.color'),
        underline: UnderlineStyle.fromWireOrNull(r.stringOrNull('underline'), '${r.path}.underline'),
      );

  final int start;
  final int end;
  final AnnotationKind kind;
  final HighlightColor? color;
  final UnderlineStyle? underline;

  /// Optional keys are omitted when null, exactly like the website's objects.
  Map<String, Object?> toJson() => {
        'start': start,
        'end': end,
        'kind': kind.wire,
        if (color != null) 'color': color!.wire,
        if (underline != null) 'underline': underline!.wire,
      };

  @override
  bool operator ==(Object other) =>
      other is Annotation &&
      other.start == start &&
      other.end == end &&
      other.kind == kind &&
      other.color == color &&
      other.underline == underline;

  @override
  int get hashCode => Object.hash(start, end, kind, color, underline);
}

/// The three highlightable containers (`#ts-passage`, `#ts-question`, `#ts-choices`).
enum AnnotationContainer {
  passage('passage'),
  question('question'),
  choices('choices');

  const AnnotationContainer(this.wire);
  final String wire;
  static AnnotationContainer fromWire(String s, [String path = r'$']) =>
      enumFromWire(values, s, (v) => v.wire, path);
}

/// One stored annotation list: (question, container) → [Annotation]s.
class AnnotationRow {
  const AnnotationRow({required this.targetId, required this.container, required this.data});

  factory AnnotationRow.fromJson(JsonReader r) => AnnotationRow(
        targetId: r.integer('target_id'),
        container: AnnotationContainer.fromWire(r.string('container'), '${r.path}.container'),
        data: r.objects('data', Annotation.fromJson),
      );

  final int targetId;
  final AnnotationContainer container;
  final List<Annotation> data;

  Map<String, Object?> toJson() =>
      {'target_id': targetId, 'container': container.wire, 'data': data.map((a) => a.toJson()).toList()};
}

/// The whole-test download: `POST pastpapers/{id}/open` and `POST midterms/attempts/{id}/open`.
/// Midterms carry only the live module in [modules].
class ExamBundle {
  const ExamBundle({
    this.schema = 1,
    required this.attempt,
    required this.test,
    required this.modules,
    required this.answers,
    required this.flagged,
    required this.media,
    required this.annotations,
  });

  factory ExamBundle.fromJson(JsonReader r) => ExamBundle(
        schema: r.integer('schema'),
        attempt: AttemptLite.fromJson(r.object('attempt')),
        test: TestInfo.fromJson(r.object('test')),
        modules: r.objects('modules', ModuleContent.fromJson),
        answers: intKeys(r.map('answers', (v, p) => intKeys(jsonStringMap(v, p), p)), '${r.path}.answers'),
        flagged: intKeys(r.map('flagged', jsonIntList), '${r.path}.flagged'),
        media: r.objects('media', MediaRef.fromJson),
        annotations: r.objects('annotations', AnnotationRow.fromJson),
      );

  final int schema;
  final AttemptLite attempt;
  final TestInfo test;
  final List<ModuleContent> modules;

  /// Saved answers: module id → question id → value ("A".."D" or a grid-in string).
  final Map<int, Map<int, String>> answers;

  /// Saved flags (Mark for Review): module id → question ids.
  final Map<int, List<int>> flagged;
  final List<MediaRef> media;
  final List<AnnotationRow> annotations;

  ModuleContent? moduleById(int id) {
    for (final m in modules) {
      if (m.id == id) return m;
    }
    return null;
  }

  Map<String, Object?> toJson() => {
        'schema': schema,
        'attempt': attempt.toJson(),
        'test': test.toJson(),
        'modules': modules.map((m) => m.toJson()).toList(),
        'answers': {for (final e in answers.entries) '${e.key}': stringKeys(e.value)},
        'flagged': stringKeys(flagged),
        'media': media.map((m) => m.toJson()).toList(),
        'annotations': annotations.map((a) => a.toJson()).toList(),
      };
}

/// Canonical JSON (sorted keys, no whitespace) — the input of `content_hash`.
String canonicalJson(Object? value) {
  if (value is Map) {
    final keys = value.keys.map((k) => k.toString()).toList()..sort();
    return '{${keys.map((k) => '${jsonEncode(k)}:${canonicalJson(value[k])}').join(',')}}';
  }
  if (value is List) return '[${value.map(canonicalJson).join(',')}]';
  return jsonEncode(value);
}

/// `sha256:<hex>` over [canonicalJson] of the module's question list as served — exactly
/// what the server puts in `content_hash` (contracts/v1/README.md).
String contentHashOf(List<Question> questions) {
  final canon = canonicalJson(questions.map((q) => q.toJson()).toList());
  return 'sha256:${sha256.convert(utf8.encode(canon))}';
}
