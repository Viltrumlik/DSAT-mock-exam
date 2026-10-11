// "History · N attempts": every finished sitting of a paper, newest first (home.history).
// Each opens its own result (and from there its report and certificate).
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/models/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';
import 'pastpaper_model.dart';

Future<void> showHistory(BuildContext context, PastpaperRow paper) async {
  final attemptId = await showAppDialog<int>(context, builder: (_) => HistoryDialog(paper: paper));
  if (attemptId != null && context.mounted) {
    await openPastpaperResult(context, attemptId: attemptId, paper: paper);
  }
}

class HistoryDialog extends StatelessWidget {
  const HistoryDialog({super.key, required this.paper});

  final PastpaperRow paper;

  @override
  Widget build(BuildContext context) {
    final entries = paper.history;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 560),
        child: Container(
          margin: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: AppColors.panel,
            borderRadius: BorderRadius.circular(AppRadii.xl),
            boxShadow: dialogShadow,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 20, 14, 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('History', style: AppText.heading.copyWith(fontSize: 18)),
                          const SizedBox(height: 2),
                          Text('${sectionTitle(paper)} · ${subjectLabel(paper.subject)} · ${fmtMonth(paper.practiceDate)}',
                              style: AppText.small),
                        ],
                      ),
                    ),
                    AppIconButton(icon: LucideIcons.x, semanticLabel: 'Close', onPressed: () => Navigator.of(context).pop()),
                  ],
                ),
              ),
              if (entries.isEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
                  child: Text('No finished sittings yet.', style: AppText.bodyMuted),
                )
              else
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                    itemCount: entries.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 6),
                    itemBuilder: (context, i) => _HistoryRow(
                      entry: entries[i],
                      number: entries.length - i,
                      latest: i == 0,
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

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.entry, required this.number, required this.latest});

  final HistoryEntry entry;
  final int number;
  final bool latest;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onPressed: () => Navigator.of(context).pop(entry.attemptId),
      semanticLabel: 'Attempt $number, score ${entry.score ?? 'pending'}',
      builder: (context, s) => FocusRing(
        visible: s.focused,
        radius: AppRadii.md,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: s.pressed ? AppColors.surface3 : (s.hovered ? AppColors.surface2 : AppColors.panel),
            borderRadius: BorderRadius.circular(AppRadii.md),
            border: Border.all(color: AppColors.line),
          ),
          child: Row(
            children: [
              Text('Attempt $number', style: AppText.body.copyWith(fontWeight: FontWeight.w700)),
              if (latest) ...[
                const SizedBox(width: 8),
                const StatusBadge(label: 'Latest', foreground: AppColors.indigo, background: AppColors.indigoSoft),
              ],
              const SizedBox(width: 12),
              Expanded(child: Text(fmtDay(entry.completedAt), style: AppText.small)),
              Text.rich(TextSpan(children: [
                TextSpan(text: '${entry.score ?? '—'}', style: AppText.heading.copyWith(fontSize: 18)),
                TextSpan(text: ' / 800', style: AppText.caption.copyWith(color: AppColors.faint)),
              ])),
              const SizedBox(width: 10),
              const Icon(LucideIcons.chevronRight, size: 16, color: AppColors.faint),
            ],
          ),
        ),
      ),
    );
  }
}
