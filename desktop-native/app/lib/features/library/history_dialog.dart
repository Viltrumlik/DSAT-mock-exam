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
    return AppModal(
      title: 'History',
      description: '${sectionTitle(paper)} · ${subjectLabel(paper.subject)} · ${fmtMonth(paper.practiceDate)}',
      onClose: () => Navigator.of(context).pop(),
      maxWidth: 480,
      maxHeight: 560,
      bodyPadding: EdgeInsets.zero,
      child: entries.isEmpty
          ? Padding(
              padding: const EdgeInsets.all(20),
              child: Text('No finished sittings yet.', style: AppText.bodyMuted),
            )
          : ListView.separated(
              shrinkWrap: true,
              padding: const EdgeInsets.all(16),
              itemCount: entries.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, i) => _HistoryRow(
                entry: entries[i],
                number: entries.length - i,
                latest: i == 0,
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
        radius: AppRadii.kitMd,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: s.pressed ? AppColors.surface3 : (s.hovered ? AppColors.surface2 : AppColors.panel),
            borderRadius: BorderRadius.circular(AppRadii.kitMd),
            border: Border.all(color: s.hovered ? AppColors.borderStrong : AppColors.border),
          ),
          child: Row(
            children: [
              Text('Attempt $number', style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
              if (latest) ...[
                const SizedBox(width: 8),
                const StatusBadge(label: 'Latest', foreground: AppColors.indigo, background: AppColors.indigoSoft),
              ],
              const SizedBox(width: 12),
              Expanded(child: Text(fmtDay(entry.completedAt), style: AppText.small)),
              Text.rich(TextSpan(children: [
                TextSpan(text: '${entry.score ?? '—'}', style: AppText.cardTitle.copyWith(fontSize: 18)),
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
