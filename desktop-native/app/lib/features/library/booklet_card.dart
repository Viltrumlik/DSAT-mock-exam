// One past paper as the website's "booklet" card (pastpapers/page.tsx `Booklet`): a coloured
// spine, a binding strip, status + region badges, the subject chip, the title and month, and
// the actions for its state — Start, Resume, Start again, See score, History · N attempts.
// No hover lift, no hand cursor; the whole card activates its main action (Enter/Space too).
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/models/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';
import 'history_dialog.dart';
import 'pastpaper_model.dart';

class BookletCard extends StatelessWidget {
  const BookletCard({super.key, required this.item});

  final PaperItem item;

  void _main(BuildContext context) {
    final a = paperAction(item.state);
    switch (a.action) {
      case PaperAction.seeScore:
        final id = item.state.completedAttemptId;
        if (id != null) openPastpaperResult(context, attemptId: id, paper: item.paper);
      case PaperAction.start:
      case PaperAction.resume:
      case PaperAction.startAgain:
        openExam(context, PastpaperExamRequest(paper: item.paper, action: a.action));
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = item.paper;
    final s = item.state;
    final us = isUS(p);
    final rw = isRW(p.subject);
    final regionMain = us ? AppColors.indigo : AppColors.teal;
    final regionSoft = us ? AppColors.indigoSoft : AppColors.tealSoft;
    final subjAccent = rw ? AppColors.indigo : AppColors.teal;
    final subjSoft = rw ? AppColors.indigoSoft : AppColors.tealSoft;
    final (statusFg, statusBg, statusDot) = switch (s.status) {
      PastpaperStatus.newPaper => (AppColors.mute, AppColors.neutralSoft, regionMain),
      PastpaperStatus.progress => (AppColors.warningForeground, AppColors.amberSoft, AppColors.amber),
      PastpaperStatus.reopened => (AppColors.indigo, AppColors.indigoSoft, AppColors.indigo),
      PastpaperStatus.completed => (AppColors.completed, AppColors.completedSoft, AppColors.completed),
    };
    final spine = switch (s.status) {
      PastpaperStatus.completed => AppColors.completed,
      PastpaperStatus.progress => AppColors.amber,
      _ => regionMain,
    };
    final action = paperAction(s);

    return Pressable(
      onPressed: () => _main(context),
      excludeChildSemantics: false,
      semanticLabel: '${sectionTitle(p)}, ${subjectLabel(p.subject)}, ${fmtMonth(p.practiceDate)}, ${statusBadgeLabel(s.status)}',
      builder: (context, st) => FocusRing(
        visible: st.focused,
        radius: AppRadii.lg,
        child: Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: AppColors.panel,
            borderRadius: BorderRadius.circular(AppRadii.lg),
            border: Border.all(color: AppColors.line),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(width: 9, color: spine),
              const _Binding(),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          StatusBadge(
                            label: statusBadgeLabel(s.status),
                            foreground: statusFg,
                            background: statusBg,
                            dot: statusDot,
                          ),
                          const Spacer(),
                          StatusBadge(
                            label: regionLabel(p),
                            foreground: regionMain,
                            background: regionSoft,
                            icon: us ? LucideIcons.flag : LucideIcons.globe,
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: StatusBadge(
                          label: subjectLabel(p.subject),
                          foreground: subjAccent,
                          background: subjSoft,
                          icon: rw ? LucideIcons.bookOpen : LucideIcons.calculator,
                        ),
                      ),
                      const Spacer(),
                      const SizedBox(height: 10),
                      Text(
                        sectionTitle(p),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.cardTitle.copyWith(fontSize: 17),
                      ),
                      const SizedBox(height: 5),
                      Row(children: [
                        const Icon(LucideIcons.calendar, size: 13, color: AppColors.mute),
                        const SizedBox(width: 6),
                        Text(fmtMonth(p.practiceDate), style: AppText.small),
                      ]),
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 13),
                        child: SizedBox(height: 1, child: ColoredBox(color: AppColors.line)),
                      ),
                      if (s.scoreLabel != null) _ScoreBlock(label: s.scoreLabel!, score: s.score),
                      if (s.status == PastpaperStatus.completed && s.completedAt != null)
                        _MetaLine(icon: LucideIcons.clock, text: 'Completed ${fmtDay(s.completedAt)}'),
                      if (s.status == PastpaperStatus.reopened && s.reopenedBy != null)
                        _MetaLine(icon: LucideIcons.rotateCcw, text: 'Set again in ${s.reopenedBy!.assignmentTitle}'),
                      AppButton(
                        label: action.label,
                        expand: true,
                        icon: switch (action.action) {
                          PaperAction.seeScore => LucideIcons.eye,
                          PaperAction.resume => LucideIcons.circlePlay,
                          _ => LucideIcons.play,
                        },
                        tone: switch (action.action) {
                          PaperAction.resume => AppButtonTone.amber,
                          _ => AppButtonTone.primary,
                        },
                        onPressed: () => _main(context),
                      ),
                      if (s.showsHistory)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Center(
                            child: AppLinkButton(
                              label: 'History · ${s.sittings} ${s.sittings == 1 ? 'attempt' : 'attempts'}',
                              icon: LucideIcons.history,
                              onPressed: () => showHistory(context, p),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The dashed binding strip between the spine and the page.
class _Binding extends StatelessWidget {
  const _Binding();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 9,
      decoration: const BoxDecoration(border: Border(right: BorderSide(color: AppColors.line))),
      child: CustomPaint(painter: _BindingPainter()),
    );
  }
}

class _BindingPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = AppColors.line;
    for (double y = 3; y < size.height; y += 6) {
      canvas.drawRect(Rect.fromLTWH(0, y, size.width, 3), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _ScoreBlock extends StatelessWidget {
  const _ScoreBlock({required this.label, required this.score});

  final String label;
  final int? score;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppText.filterLabel),
          const SizedBox(height: 3),
          Text.rich(TextSpan(children: [
            TextSpan(text: '${score ?? '—'}', style: AppText.score),
            TextSpan(text: '  / 800', style: AppText.scoreSuffix),
          ])),
        ],
      ),
    );
  }
}

class _MetaLine extends StatelessWidget {
  const _MetaLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(children: [
        Icon(icon, size: 13, color: AppColors.mute),
        const SizedBox(width: 7),
        Expanded(child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption)),
      ]),
    );
  }
}
