// A past paper's result (architecture §2.3 "Results (past paper)"; website
// features/pastpapers/PastpaperReportPage.tsx): the score and the change since the last
// sitting, Correct / To review / Accuracy, the module breakdown, the question grid (a click
// opens that question in review), "Review questions", the certificate and error-report PDFs
// (saved where the student chooses), and every sitting of the paper.
//
// `GET …/result` is polled while the server is still SCORING; offline, "Try again" re-sends it.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/models/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';
import '../home/app_header.dart';
import '../library/pastpaper_model.dart';
import 'result_states.dart';
import 'results_controller.dart';

class PastpaperResultScreen extends StatefulWidget {
  const PastpaperResultScreen({super.key, required this.attemptId, this.paper});

  final int attemptId;

  /// The library row (title, history); null when the paper is no longer listed.
  final PastpaperRow? paper;

  @override
  State<PastpaperResultScreen> createState() => _PastpaperResultScreenState();
}

class _PastpaperResultScreenState extends State<PastpaperResultScreen> {
  late final PastpaperResultController _controller;
  String? _downloadError;

  @override
  void initState() {
    super.initState();
    final services = AppScope.of(context);
    _controller = PastpaperResultController(api: services.api, attemptId: widget.attemptId);
    unawaited(_controller.load());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  PastpaperRow? _paperFor(PastpaperResult? r) {
    if (widget.paper != null) return widget.paper;
    final id = r?.practiceTestId;
    if (id == null) return null;
    return AppScope.of(context).home.home?.pastpapers.where((p) => p.id == id).firstOrNull;
  }

  void _setDownloadError(String? e) {
    if (mounted && e != _downloadError) setState(() => _downloadError = e);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          AppHeader(backLabel: 'Your tests', onBack: () => Navigator.of(context).maybePop()),
          Expanded(
            child: ListenableBuilder(
              listenable: _controller,
              builder: (context, _) {
                final r = _controller.result;
                final ready = _controller.phase == ResultPhase.ready && r != null && r.isCompleted;
                return SingleChildScrollView(
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 960),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(32, 28, 32, 48),
                        child: ready
                            ? _Report(
                                result: r,
                                paper: _paperFor(r),
                                downloadError: _downloadError,
                                onDownloadError: _setDownloadError,
                              )
                            : ResultPendingView(
                                phase: _controller.phase,
                                error: _controller.error,
                                onRetry: () => unawaited(_controller.load()),
                                loadingLabel: 'Loading your report…',
                                failedTitle: "The report didn't load.",
                              ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _Report extends StatelessWidget {
  const _Report({required this.result, required this.paper, required this.downloadError, required this.onDownloadError});

  final PastpaperResult result;
  final PastpaperRow? paper;
  final String? downloadError;
  final ValueChanged<String?> onDownloadError;

  @override
  Widget build(BuildContext context) {
    final r = result;
    final totals = r.totals;
    final toReview = totals == null ? 0 : totals.incorrect + totals.skipped;
    final accuracy = totals == null || totals.questions == 0 ? 0 : (totals.correct * 100 / totals.questions).round();
    final p = paper;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ScoreCard(
          result: r,
          paper: p,
          toReview: toReview,
          downloadError: downloadError,
          onDownloadError: onDownloadError,
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(child: _Stat(value: '${totals?.correct ?? 0}', label: 'Correct')),
            const SizedBox(width: 12),
            Expanded(child: _Stat(value: '$toReview', label: 'To review')),
            const SizedBox(width: 12),
            Expanded(child: _Stat(value: '$accuracy%', label: 'Accuracy')),
          ],
        ),
        const SizedBox(height: 24),
        _Label('MODULES'),
        _Modules(result: r),
        const SizedBox(height: 24),
        _Label('QUESTIONS'),
        QuestionGrid(result: r, paper: p),
        if (p != null && p.history.isNotEmpty) ...[
          const SizedBox(height: 24),
          _Label('HISTORY'),
          _History(paper: p, current: r.attemptId, onDownloadError: onDownloadError),
        ],
      ],
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(left: 2, bottom: 10),
        child: Text(text, style: AppText.filterLabel.copyWith(letterSpacing: 1.1)),
      );
}

/// "+40 since your last sitting" — growth-first wording; a lower score is stated plainly,
/// never in red.
({String text, Color color, IconData icon})? scoreChange(PastpaperResult r) {
  final delta = r.scoreDelta ?? (r.score != null && r.previousScore != null ? r.score! - r.previousScore! : null);
  if (r.previousScore == null || delta == null) {
    return (text: 'Your first sitting of this paper', color: AppColors.mute, icon: LucideIcons.flag);
  }
  if (delta > 0) return (text: '+$delta since your last sitting', color: AppColors.successForeground, icon: LucideIcons.trendingUp);
  if (delta == 0) return (text: 'The same as your last sitting', color: AppColors.mute, icon: LucideIcons.minus);
  return (text: '${-delta} below your last sitting', color: AppColors.mute, icon: LucideIcons.trendingDown);
}

class _ScoreCard extends StatelessWidget {
  const _ScoreCard({
    required this.result,
    required this.paper,
    required this.toReview,
    required this.downloadError,
    required this.onDownloadError,
  });

  final PastpaperResult result;
  final PastpaperRow? paper;
  final int toReview;
  final String? downloadError;
  final ValueChanged<String?> onDownloadError;

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    final r = result;
    final p = paper;
    final eyebrow = p == null
        ? 'PAST PAPER'
        : '${sectionTitle(p)} · ${subjectLabel(p.subject)} · ${fmtMonth(p.practiceDate)}'.toUpperCase();
    final change = scoreChange(r);
    return AppCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(eyebrow, style: AppText.filterLabel),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text('${r.score ?? '—'}', style: AppText.scoreLarge.copyWith(fontSize: 48)),
              const SizedBox(width: 8),
              Text('/ 800', style: AppText.scoreSuffix.copyWith(fontSize: 15)),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 16,
            runSpacing: 6,
            children: [
              if (change != null)
                Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(change.icon, size: 15, color: change.color),
                  const SizedBox(width: 6),
                  Text(change.text, style: AppText.body.copyWith(fontWeight: FontWeight.w700, color: change.color)),
                ]),
              if (r.completedAt != null)
                Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(LucideIcons.clock, size: 14, color: AppColors.mute),
                  const SizedBox(width: 6),
                  Text('Completed ${fmtDay(r.completedAt)}', style: AppText.small),
                ]),
            ],
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              AppButton(
                label: 'Review questions',
                icon: LucideIcons.eye,
                onPressed: () => unawaited(openExam(context, ReviewExamRequest(result: r, paper: p))),
              ),
              if (r.score != null)
                PdfDownloadButton(
                  label: 'Certificate',
                  icon: LucideIcons.award,
                  suggestedName: 'MasterSAT-certificate-${r.attemptId}.pdf',
                  fetch: () => services.api.pastpaperCertificatePdf(r.attemptId),
                  failure: "The certificate couldn't be produced right now. Your result is safe.",
                  onError: onDownloadError,
                ),
              if (toReview > 0)
                PdfDownloadButton(
                  label: 'Error report PDF',
                  suggestedName: 'MasterSAT-error-report-${r.attemptId}.pdf',
                  fetch: () => services.api.pastpaperReportPdf(r.attemptId),
                  failure: "The report couldn't be produced right now. Nothing has been lost.",
                  onError: onDownloadError,
                ),
            ],
          ),
          if (downloadError != null) ...[
            const SizedBox(height: 10),
            Text(downloadError!, style: AppText.small.copyWith(color: AppColors.mute)),
          ],
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      radius: AppRadii.md,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value, style: AppText.score.copyWith(fontSize: 26)),
          const SizedBox(height: 4),
          Text(label.toUpperCase(), style: AppText.filterLabel),
        ],
      ),
    );
  }
}

class _Modules extends StatelessWidget {
  const _Modules({required this.result});

  final PastpaperResult result;

  @override
  Widget build(BuildContext context) {
    final modules = [...result.modules]..sort((a, b) => a.order.compareTo(b.order));
    return AppCard(
      padding: EdgeInsets.zero,
      radius: AppRadii.lg,
      child: Column(
        children: [
          for (var i = 0; i < modules.length; i++)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
              decoration: BoxDecoration(
                border: i == 0 ? null : const Border(top: BorderSide(color: AppColors.line)),
              ),
              child: Row(
                children: [
                  Text('Module ${modules[i].order}', style: AppText.body.copyWith(fontWeight: FontWeight.w800, color: AppColors.ink)),
                  const Spacer(),
                  Text.rich(TextSpan(children: [
                    TextSpan(text: '${modules[i].correct}', style: AppText.cardTitle),
                    TextSpan(text: ' / ${modules[i].total} correct', style: AppText.small),
                  ])),
                  const SizedBox(width: 14),
                  SizedBox(
                    width: 48,
                    child: Text(
                      modules[i].total == 0 ? '—' : '${(modules[i].correct * 100 / modules[i].total).round()}%',
                      textAlign: TextAlign.right,
                      style: AppText.small.copyWith(color: AppColors.faint),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

enum QuestionOutcome { correct, incorrect, skipped }

QuestionOutcome outcomeOf(QuestionResult q) => q.isCorrect
    ? QuestionOutcome.correct
    : (q.studentAnswer == null || q.studentAnswer!.trim().isEmpty)
        ? QuestionOutcome.skipped
        : QuestionOutcome.incorrect;

/// Every question by module: green right, red to review, grey skipped, a bookmark when it was
/// marked for review. A click opens that question in review.
class QuestionGrid extends StatelessWidget {
  const QuestionGrid({super.key, required this.result, this.paper});

  final PastpaperResult result;
  final PastpaperRow? paper;

  @override
  Widget build(BuildContext context) {
    final modules = [...result.modules]..sort((a, b) => a.order.compareTo(b.order));
    return AppCard(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final m in modules) ...[
            Text('Module ${m.order}', style: AppText.small.copyWith(color: AppColors.ink, fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final q in (result.questions.where((q) => q.moduleId == m.moduleId).toList()
                  ..sort((a, b) => a.order.compareTo(b.order))))
                  _QuestionCell(question: q, onOpen: () => unawaited(openExam(
                        context,
                        ReviewExamRequest(result: result, paper: paper, questionId: q.id),
                      ))),
              ],
            ),
            const SizedBox(height: 16),
          ],
          const Wrap(
            spacing: 18,
            runSpacing: 6,
            children: [
              _Legend(color: AppColors.completed, label: 'Correct'),
              _Legend(color: AppColors.dzDanger, label: 'To review'),
              _Legend(color: AppColors.faint, label: 'Skipped'),
              _Legend(icon: LucideIcons.bookmark, label: 'Marked for review'),
            ],
          ),
        ],
      ),
    );
  }
}

class _QuestionCell extends StatelessWidget {
  const _QuestionCell({required this.question, required this.onOpen});

  final QuestionResult question;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final q = question;
    final outcome = outcomeOf(q);
    final (fg, bg, border) = switch (outcome) {
      QuestionOutcome.correct => (AppColors.completed, AppColors.completedSoft, const Color(0x5916A34A)),
      QuestionOutcome.incorrect => (AppColors.dzDanger, AppColors.dzDangerSoft, const Color(0x59B91C1C)),
      QuestionOutcome.skipped => (AppColors.mute, AppColors.surface2, AppColors.surface3),
    };
    final word = switch (outcome) {
      QuestionOutcome.correct => 'correct',
      QuestionOutcome.incorrect => 'to review',
      QuestionOutcome.skipped => 'skipped',
    };
    return Pressable(
      onPressed: onOpen,
      semanticLabel: 'Question ${q.order}, $word${q.wasFlagged ? ', marked for review' : ''}',
      tooltip: switch (outcome) {
        QuestionOutcome.correct => 'Your answer ${q.studentAnswer}',
        QuestionOutcome.incorrect => 'You put ${q.studentAnswer} · correct ${q.acceptedAnswers.join(' or ')}',
        QuestionOutcome.skipped => 'Skipped · correct ${q.acceptedAnswers.join(' or ')}',
      },
      builder: (context, s) => FocusRing(
        visible: s.focused,
        radius: 9,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 38,
              height: 38,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: s.hovered ? Color.alphaBlend(const Color(0x0F0F172A), bg) : bg,
                borderRadius: BorderRadius.circular(9),
                border: Border.all(color: border),
              ),
              child: Text('${q.order}', style: AppText.button.copyWith(color: fg, fontWeight: FontWeight.w800)),
            ),
            if (q.wasFlagged)
              const Positioned(
                right: -3,
                top: -4,
                child: Icon(LucideIcons.bookmark, size: 13, color: AppColors.amber),
              ),
          ],
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({this.color, this.icon, required this.label});

  final Color? color;
  final IconData? icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null)
          Icon(icon, size: 13, color: AppColors.amber)
        else
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3)),
          ),
        const SizedBox(width: 6),
        Text(label, style: AppText.caption),
      ],
    );
  }
}

/// Every sitting of the paper, newest first, each with its own certificate (website #history).
class _History extends StatelessWidget {
  const _History({required this.paper, required this.current, required this.onDownloadError});

  final PastpaperRow paper;
  final int current;
  final ValueChanged<String?> onDownloadError;

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    final rows = paper.history;
    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                border: i == 0 ? null : const Border(top: BorderSide(color: AppColors.line)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.baseline,
                          textBaseline: TextBaseline.alphabetic,
                          children: [
                            Text('${rows[i].score ?? '—'}', style: AppText.cardTitle),
                            const SizedBox(width: 4),
                            Text('/ 800', style: AppText.caption.copyWith(color: AppColors.faint)),
                            if (i == 0) ...[
                              const SizedBox(width: 8),
                              const StatusBadge(label: 'Latest', foreground: AppColors.indigo, background: AppColors.indigoSoft),
                            ],
                            if (rows[i].attemptId == current) ...[
                              const SizedBox(width: 6),
                              const StatusBadge(label: 'This report', foreground: AppColors.mute, background: AppColors.neutralSoft),
                            ],
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(rows[i].completedAt == null ? '—' : fmtDay(rows[i].completedAt), style: AppText.caption),
                      ],
                    ),
                  ),
                  if (rows[i].attemptId != current) ...[
                    AppButton(
                      label: 'Report',
                      tone: AppButtonTone.secondary,
                      size: AppButtonSize.small,
                      onPressed: () => Navigator.of(context).pushReplacement(instantRoute(
                        (_) => PastpaperResultScreen(attemptId: rows[i].attemptId, paper: paper),
                        settings: RouteSettings(name: '/results/pastpaper/${rows[i].attemptId}'),
                      )),
                    ),
                    const SizedBox(width: 8),
                  ],
                  if (rows[i].score != null)
                    PdfDownloadButton(
                      label: 'Certificate',
                      tone: AppButtonTone.soft,
                      size: AppButtonSize.small,
                      suggestedName: 'MasterSAT-certificate-${rows[i].attemptId}.pdf',
                      fetch: () => services.api.pastpaperCertificatePdf(rows[i].attemptId),
                      failure: "The certificate couldn't be produced right now. Your result is safe.",
                      onError: onDownloadError,
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
