// "Review questions" on a past-paper result: the content island, read-only, in its review
// mode (island/src/ported/AnswerPane.ts: choices marked correct / incorrect, a grid-in's
// "Your Answer" / "Correct Answer(s)" boxes, the explanation when a question carries one),
// inside a small native frame — title, "Back to results", Question N of M, Back / Next.
//
// Everything comes from the v1 result (`GET pastpapers/attempts/{id}/result`): per-question
// correctness, and the questions themselves in `content` — or, for a module this computer
// already holds, from the exam store by `content_hash`. Images come from the sealed media
// cache the sitting filled, downloading (signed URLs in the result, re-signed through
// `GET attempts/pastpaper/{id}/media`) only what is missing.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart' hide KeyMessage;
import 'package:flutter/widgets.dart';

import '../../core/api/v1_api.dart';
import '../../core/models/models.dart';
import '../../features/library/pastpaper_model.dart';
import '../../island/island_host.dart';
import '../../island/protocol.dart';
import '../../island/protocol_convert.dart';
import '../../native/native_bridge.dart';
import '../engine/exam_runtime.dart';
import '../engine/media_cache.dart';
import '../runner/icons/lucide_glyphs.dart';
import '../runner/runner_style.dart';
import '../runner/sat_color_rule.dart';
import '../runner/status_screens.dart';
import '../session_contract.dart' show MediaBlob;
import '../tokens/bluebook_tokens.dart';
import 'island_guard.dart';
import 'launch_ui.dart';

/// One question in review order.
@immutable
class ReviewItem {
  const ReviewItem({required this.result, required this.question, required this.moduleOrder});
  final QuestionResult result;
  final Question question;
  final int moduleOrder;
}

/// The review's data, assembled from a result (pure; tested on its own).
class ReviewPlan {
  ReviewPlan._(this.items, this.modules, this.missingModules);

  /// Builds the plan. [cached] answers a module's questions by content hash (the exam store).
  static Future<ReviewPlan> build(
    PastpaperResult result, {
    Future<List<Question>?> Function(String contentHash)? cached,
  }) async {
    final orderOf = {for (final m in result.modules) m.moduleId: m.order};
    final modules = <int, List<Question>>{};
    final missing = <int>{};
    final moduleIds = {...result.modules.map((m) => m.moduleId), ...result.questions.map((q) => q.moduleId)};
    for (final id in moduleIds) {
      final c = result.content[id];
      var qs = c?.questions;
      if (qs == null && c != null && cached != null) {
        try {
          qs = await cached(c.contentHash);
        } on Object {
          qs = null;
        }
      }
      if (qs == null) {
        missing.add(id);
      } else {
        modules[id] = qs;
      }
    }
    final sorted = [...result.questions]
      ..sort((a, b) {
        final m = (orderOf[a.moduleId] ?? 0).compareTo(orderOf[b.moduleId] ?? 0);
        return m != 0 ? m : a.order.compareTo(b.order);
      });
    final items = <ReviewItem>[];
    for (final r in sorted) {
      final q = modules[r.moduleId]?.where((q) => q.id == r.id).firstOrNull;
      if (q == null) continue;
      items.add(ReviewItem(result: r, question: q, moduleOrder: orderOf[r.moduleId] ?? 1));
    }
    return ReviewPlan._(items, modules, missing);
  }

  final List<ReviewItem> items;

  /// Module id → its questions (in the bundle's order, as `module.load` sends them).
  final Map<int, List<Question>> modules;

  /// Modules whose questions are neither in the result nor on this computer.
  final Set<int> missingModules;

  int indexOf(int questionId) {
    final i = items.indexWhere((it) => it.question.id == questionId);
    return i < 0 ? 0 : i;
  }
}

class PastpaperReviewScreen extends StatefulWidget {
  const PastpaperReviewScreen({
    super.key,
    required this.result,
    required this.islandFactory,
    required this.fetchMedia,
    required this.onClose,
    this.paper,
    this.questionId,
    this.runtime,
    this.api,
    this.native,
    this.studentName,
    this.islandDiagnostics,
    this.onDiagnostic,
  });

  final PastpaperResult result;
  final PastpaperRow? paper;

  /// Open at this question (a click in the result's question grid); null = the first.
  final int? questionId;
  final IslandHostFactory islandFactory;
  final MediaFetcher fetchMedia;
  final VoidCallback onClose;

  /// The signed-in student's exam runtime: cached questions and images (null: none).
  final ExamRuntime? runtime;

  /// Re-signs expired image URLs.
  final V1Api? api;

  /// Opens sealed cached images (with [runtime]).
  final NativeBridge? native;
  final String? studentName;
  final IslandDiagnostics? islandDiagnostics;
  final void Function(String where, String message)? onDiagnostic;

  @override
  State<PastpaperReviewScreen> createState() => _PastpaperReviewScreenState();
}

class _PastpaperReviewScreenState extends State<PastpaperReviewScreen> {
  late final ContentIslandGuard _island;
  StreamSubscription<IslandEvent>? _events;
  ReviewPlan? _plan;
  Object? _planError;
  int _index = 0;
  bool _ready = false;
  int? _loadedModule;
  int _generation = 0;
  late final MediaStore _media;
  final FocusNode _focus = FocusNode(debugLabel: 'review');

  @override
  void initState() {
    super.initState();
    final rt = widget.runtime;
    final native = widget.native;
    _media = rt != null && native != null && !rt.closed
        ? SealedFileMediaStore(store: rt.store, native: native, wallMs: () => DateTime.now().millisecondsSinceEpoch)
        : MemoryMediaStore();
    _island = ContentIslandGuard(factory: widget.islandFactory, diagnostics: widget.islandDiagnostics);
    _events = _island.host.events.listen((e) => scheduleMicrotask(() => _onEvent(e)));
    _island.unavailable.addListener(_rebuild);
    _island.start();
    if (_island.host.state == IslandHostState.ready) scheduleMicrotask(_onReady);
    unawaited(_buildPlan());
  }

  Future<void> _buildPlan() async {
    try {
      final rt = widget.runtime;
      final plan = await ReviewPlan.build(
        widget.result,
        cached: rt == null || rt.closed ? null : (hash) => rt.store.getContent(hash),
      );
      if (!mounted) return;
      setState(() {
        _plan = plan;
        final q = widget.questionId;
        _index = q == null ? 0 : plan.indexOf(q);
      });
      if (_ready) unawaited(_show());
    } on Object catch (e) {
      if (mounted) setState(() => _planError = e);
    }
  }

  void _rebuild() {
    if (mounted) setState(() {});
  }

  void _onEvent(IslandEvent e) {
    if (!mounted) return;
    switch (e) {
      case IslandCrashedEvent():
        _ready = false;
        _loadedModule = null;
      case IslandMessageEvent(message: ReadyMessage()):
        _onReady();
      case IslandMessageEvent(message: KeyMessage(:final key)):
        _onKey(key);
      case IslandMessageEvent(message: ErrorMessage(:final where, :final message)):
        widget.onDiagnostic?.call('island:$where', message);
      default:
        break;
    }
  }

  bool get _isMath {
    final s = widget.paper?.subject;
    if (s != null) return s == 'MATH';
    final first = _plan?.items.firstOrNull?.question;
    return first != null && !first.isReadingWriting;
  }

  void _onReady() {
    if (_ready) return;
    _ready = true;
    _loadedModule = null;
    _island.host.post(InitMessage(
      mode: 'review',
      kind: 'pastpaper',
      subject: _isMath ? 'math' : 'rw',
      overlays: _island.host.canDrawOverIsland ? 'native' : 'inline',
      zoom: 1,
      split: 0.5,
      highlighterOn: false,
      eliminatorOn: false,
      calcReservePx: 0,
    ));
    unawaited(_show());
  }

  Future<void> _show() async {
    final plan = _plan;
    if (!_ready || plan == null || plan.items.isEmpty) return;
    final item = plan.items[_index.clamp(0, plan.items.length - 1)];
    final moduleId = item.result.moduleId;
    final gen = ++_generation;
    if (_loadedModule != moduleId) {
      final questions = plan.modules[moduleId] ?? const <Question>[];
      _island.host.post(moduleLoadMessage(moduleId, questions));
      await _putMedia(questions);
      if (gen != _generation || !mounted) return;
      _loadedModule = moduleId;
    }
    final moduleQuestions = plan.modules[moduleId] ?? const <Question>[];
    final r = item.result;
    _island.host.post(QuestionShowMessage(
      qid: r.id,
      index: moduleQuestions.indexWhere((q) => q.id == r.id).clamp(0, moduleQuestions.length),
      total: moduleQuestions.length,
      answer: r.studentAnswer,
      eliminated: const [],
      flagged: r.wasFlagged,
      annotations: islandAnnotationSet(const {}),
      review: IslandReviewInfo(correct: r.correctAnswers, studentAnswer: r.studentAnswer, isCorrect: r.isCorrect),
    ));
  }

  static const _mimes = {'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'};

  Future<void> _putMedia(List<Question> questions) async {
    final keys = {for (final q in questions) ...q.imageKeys};
    if (keys.isEmpty) return;
    final refs = [for (final m in widget.result.media) if (keys.contains(m.key)) m];
    final api = widget.api;
    final downloader = MediaDownloader(
      target: _media,
      fetch: widget.fetchMedia,
      resign: api == null ? null : () async => (await api.media(AttemptKind.pastpaper, widget.result.attemptId)).media,
    );
    try {
      final failed = await downloader.ensure(refs);
      if (failed.isNotEmpty) widget.onDiagnostic?.call('media', 'review images failed: ${failed.join(', ')}');
    } on Object catch (e) {
      widget.onDiagnostic?.call('media', 'review images failed: $e');
    }
    for (final k in keys) {
      MediaBlob? b;
      try {
        b = await _media.read(k);
      } on Object {
        b = null;
      }
      if (b == null || !_mimes.contains(b.mime)) continue;
      _island.host.post(MediaPutMessage(key: b.key, mime: b.mime, b64: base64Encode(b.bytes)));
    }
  }

  void _go(int delta) {
    final plan = _plan;
    if (plan == null) return;
    final next = (_index + delta).clamp(0, plan.items.length - 1);
    if (next == _index) return;
    setState(() => _index = next);
    unawaited(_show());
  }

  void _onKey(String key) {
    switch (key) {
      case 'ArrowLeft':
        _go(-1);
      case 'ArrowRight':
        _go(1);
      case 'Escape':
        widget.onClose();
    }
  }

  KeyEventResult _onKeyEvent(FocusNode node, KeyEvent event) {
    if (event is KeyUpEvent) return KeyEventResult.ignored;
    final k = event.logicalKey;
    if (k == LogicalKeyboardKey.arrowLeft) {
      _go(-1);
    } else if (k == LogicalKeyboardKey.arrowRight) {
      _go(1);
    } else if (k == LogicalKeyboardKey.escape) {
      widget.onClose();
    } else {
      return KeyEventResult.ignored;
    }
    return KeyEventResult.handled;
  }

  @override
  void dispose() {
    unawaited(_events?.cancel());
    _island.unavailable.removeListener(_rebuild);
    unawaited(_island.dispose());
    _focus.dispose();
    super.dispose();
  }

  String get _title {
    final p = widget.paper;
    return p == null ? 'Review questions' : 'Review · ${sectionTitle(p)} · ${subjectLabel(p.subject)}';
  }

  Widget _header() => Container(
    color: BluebookTokens.surface,
    padding: BluebookTokens.headerPadding,
    child: Row(
      children: [
        Expanded(
          child: Text(
            _title,
            key: const ValueKey('review.title'),
            overflow: TextOverflow.ellipsis,
            style: chromeText(BluebookTokens.headerTitleSize, weight: FontWeight.w700),
          ),
        ),
        RunnerPillButton(label: 'Back to results', onTap: widget.onClose, primary: false),
      ],
    ),
  );

  Widget _footer(ReviewPlan plan) {
    final item = plan.items[_index];
    final r = item.result;
    final status = r.studentAnswer == null ? 'Not answered' : (r.isCorrect ? 'Correct' : 'Incorrect');
    final color = r.studentAnswer == null
        ? TwColors.slate600
        : (r.isCorrect ? const Color(0xFF047857) : TwColors.red700);
    return Container(
      color: BluebookTokens.surface,
      padding: BluebookTokens.footerPadding,
      child: Row(
        children: [
          Expanded(
            child: Text.rich(
              TextSpan(children: [
                TextSpan(
                  text: 'Question ${_index + 1} of ${plan.items.length}',
                  style: chromeText(15, weight: FontWeight.w700),
                ),
                TextSpan(text: '   Module ${item.moduleOrder} · ', style: chromeText(15, color: TwColors.slate600)),
                TextSpan(
                  text: status,
                  style: chromeText(15, weight: FontWeight.w700, color: color),
                ),
              ]),
              key: const ValueKey('review.position'),
            ),
          ),
          RunnerPillButton(label: 'Back', onTap: _index > 0 ? () => _go(-1) : null, primary: false),
          const SizedBox(width: 12),
          RunnerPillButton(label: 'Next', onTap: _index < plan.items.length - 1 ? () => _go(1) : null),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final plan = _plan;
    Widget body;
    if (_island.unavailable.value) {
      body = RunnerMessageScreen(
        title: IslandUnavailableCopy.title,
        body: 'MasterSAT shows questions with Microsoft Edge WebView2, and it isn’t available here. '
            'Your score and results are still on the results page.',
        primaryLabel: 'Back to results',
        onPrimary: widget.onClose,
      );
    } else if (_planError != null || (plan != null && plan.items.isEmpty)) {
      body = RunnerMessageScreen(
        icon: LucideGlyphs.cloudOff,
        title: 'These questions can’t be shown right now',
        body: 'The questions of this sitting aren’t on this computer yet. Connect to the internet '
            'and open the review again.',
        primaryLabel: 'Back to results',
        onPrimary: widget.onClose,
      );
    } else if (plan == null) {
      body = const LoadingScreen(label: 'Loading questions…');
    } else {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(),
          const SatColorRule(),
          Expanded(child: _island.host.build(context)),
          const SatColorRule(),
          _footer(plan),
        ],
      );
    }
    return DefaultTextStyle(
      style: chromeText(16),
      child: NoSelection(
        child: Focus(
          focusNode: _focus,
          autofocus: true,
          onKeyEvent: _onKeyEvent,
          child: GestureDetector(
            onSecondaryTap: () {},
            behavior: HitTestBehavior.translucent,
            child: ColoredBox(color: BluebookTokens.surface, child: body),
          ),
        ),
      ),
    );
  }
}
