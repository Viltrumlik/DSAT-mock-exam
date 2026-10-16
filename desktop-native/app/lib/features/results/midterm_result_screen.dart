// A midterm's result (architecture §2.3 "Results (midterm)"; website
// app/(main)/midterm/result/[attemptId]/page.tsx): score / ceiling once the teacher releases
// it, the class rank, the certificate and the error-report PDFs. Before release it says the
// answers are in — the release gate is the server's (a classroom midterm stays unreleased
// until the teacher publishes).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/models/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';
import '../home/midterm_model.dart';
import '../shell/app_shell.dart';
import '../shell/shell_controller.dart';
import '../shell/shell_page.dart';
import 'result_states.dart';
import 'results_controller.dart';

class MidtermResultScreen extends StatefulWidget {
  const MidtermResultScreen({super.key, required this.row});

  /// The Home row (title, subject, attempt id).
  final MidtermRow row;

  @override
  State<MidtermResultScreen> createState() => _MidtermResultScreenState();
}

class _MidtermResultScreenState extends State<MidtermResultScreen> {
  MidtermResultController? _controller;
  String? _downloadError;

  @override
  void initState() {
    super.initState();
    final id = widget.row.attemptId;
    if (id != null) {
      _controller = MidtermResultController(api: AppScope.of(context).api, attemptId: id);
      unawaited(_controller!.load());
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  void _setDownloadError(String? e) {
    if (mounted && e != _downloadError) setState(() => _downloadError = e);
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    Widget body;
    if (controller == null) {
      body = const EmptyState(
        icon: LucideIcons.clock,
        title: 'Result not available yet.',
        message: 'This midterm has no finished sitting yet.',
      );
    } else {
      body = ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final r = controller.result;
          if (controller.phase == ResultPhase.ready && r != null && r.isCompleted) {
            return MidtermResultCard(
              row: widget.row,
              result: r,
              downloadError: _downloadError,
              onDownloadError: _setDownloadError,
              onCheckAgain: () => unawaited(controller.load()),
            );
          }
          return ResultPendingView(
            phase: controller.phase,
            error: controller.error,
            onRetry: () => unawaited(controller.load()),
            loadingLabel: 'Loading your result…',
            failedTitle: 'Result not available yet.',
          );
        },
      );
    }
    // app/(main)/midterm/result/[attemptId]/page.tsx: `max-w-3xl px-6 py-10`, the way back on top.
    return AppShell(
      section: ShellSection.midterms,
      title: 'Midterm result',
      child: ShellPage(
        maxWidth: 720,
        padding: const EdgeInsets.fromLTRB(56, 60, 56, 60),
        children: [
          ShellBackLink(label: 'Back to midterms', fontSize: 14, onPressed: () => Navigator.of(context).maybePop()),
          const SizedBox(height: 32),
          body,
        ],
      ),
    );
  }
}

class MidtermResultCard extends StatelessWidget {
  const MidtermResultCard({
    super.key,
    required this.row,
    required this.result,
    required this.downloadError,
    required this.onDownloadError,
    required this.onCheckAgain,
  });

  final MidtermRow row;
  final MidtermResult result;
  final String? downloadError;
  final ValueChanged<String?> onDownloadError;
  final VoidCallback onCheckAgain;

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    final r = result;
    final cert = r.certificate;
    final ceiling = r.scoreCeiling ?? row.scoreCeiling;
    // `rounded-3xl border bg-white p-10 text-center`, no shadow.
    return AppCard.board(
      radius: AppRadii.xl,
      padding: const EdgeInsets.all(40),
      child: Column(
        children: [
          Text('MIDTERM RESULT', style: AppText.eyebrow.copyWith(letterSpacing: 12 * 0.16, color: AppColors.slate400)),
          const SizedBox(height: 10),
          Text(row.title, textAlign: TextAlign.center, style: AppText.heading.copyWith(fontSize: 18)),
          const SizedBox(height: 2),
          Text(subjectLabelOf(r.subject ?? row.subject), style: AppText.small),
          if (r.released) ...[
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text('${r.totalScore ?? '—'}', style: AppText.scoreLarge.copyWith(fontSize: 64, letterSpacing: 0)),
                const SizedBox(width: 4),
                Text('/ $ceiling', style: AppText.scoreSuffix.copyWith(fontSize: 20, color: AppColors.slate400)),
              ],
            ),
            if (cert?.rank != null) ...[
              const SizedBox(height: 12),
              Text(
                'Class rank ${cert!.rank}${cert.cohortSize != null ? ' of ${cert.cohortSize}' : ''}',
                style: AppText.body.copyWith(fontWeight: FontWeight.w600, color: AppColors.mute),
              ),
            ],
            const SizedBox(height: 32),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 10,
              runSpacing: 10,
              children: [
                if (cert != null && cert.available && cert.code.isNotEmpty)
                  PdfDownloadButton(
                    label: 'Download certificate',
                    tone: AppButtonTone.primary,
                    size: AppButtonSize.row,
                    suggestedName: 'certificate-${cert.code}.pdf',
                    fetch: () => services.api.midtermCertificatePdf(cert.code),
                    failure: "The certificate couldn't be produced right now. Your result is safe.",
                    onError: onDownloadError,
                  ),
                PdfDownloadButton(
                  label: 'Download report',
                  icon: LucideIcons.fileText,
                  tone: AppButtonTone.line,
                  size: AppButtonSize.row,
                  suggestedName: 'MasterSAT-midterm-report-${r.attemptId}.pdf',
                  fetch: () => services.api.midtermErrorReportPdf(r.attemptId),
                  failure: 'Your error report is not available for this attempt.',
                  onError: onDownloadError,
                ),
              ],
            ),
            if (downloadError != null) ...[
              const SizedBox(height: 12),
              Text(downloadError!, textAlign: TextAlign.center, style: AppText.small),
            ],
          ] else ...[
            const SizedBox(height: 32),
            Container(
              width: 56,
              height: 56,
              decoration: const BoxDecoration(color: AppColors.slate100, shape: BoxShape.circle),
              child: const Icon(LucideIcons.clock, size: 28, color: AppColors.slate500),
            ),
            const SizedBox(height: 12),
            Text('Submitted', style: AppText.heading.copyWith(fontSize: 18, letterSpacing: 0)),
            const SizedBox(height: 12),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 384),
              child: Text(
                'Your answers are in. Your teacher will release the results and your certificate shortly.',
                textAlign: TextAlign.center,
                style: AppText.bodyMuted.copyWith(height: 1.43),
              ),
            ),
            const SizedBox(height: 20),
            AppButton(
              label: 'Check again',
              icon: LucideIcons.refreshCw,
              tone: AppButtonTone.line,
              size: AppButtonSize.link,
              onPressed: onCheckAgain,
            ),
          ],
        ],
      ),
    );
  }
}
