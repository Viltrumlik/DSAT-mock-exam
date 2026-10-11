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
import '../home/app_header.dart';
import '../home/midterm_model.dart';
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
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          AppHeader(backLabel: 'Your tests', onBack: () => Navigator.of(context).maybePop()),
          Expanded(
            child: SingleChildScrollView(
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 760),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(32, 28, 32, 48),
                    child: controller == null
                        ? const EmptyState(
                            icon: LucideIcons.clock,
                            title: 'Result not available yet.',
                            message: 'This midterm has no finished sitting yet.',
                          )
                        : ListenableBuilder(
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
                          ),
                  ),
                ),
              ),
            ),
          ),
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
    return AppCard(
      radius: AppRadii.xl,
      padding: const EdgeInsets.fromLTRB(32, 32, 32, 32),
      child: Column(
        children: [
          Text('MIDTERM RESULT', style: AppText.eyebrow),
          const SizedBox(height: 6),
          Text(row.title, textAlign: TextAlign.center, style: AppText.heading),
          const SizedBox(height: 2),
          Text(subjectLabelOf(r.subject ?? row.subject), style: AppText.small),
          if (r.released) ...[
            const SizedBox(height: 22),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text('${r.totalScore ?? '—'}', style: AppText.scoreLarge.copyWith(fontSize: 64)),
                const SizedBox(width: 6),
                Text('/ $ceiling', style: AppText.scoreSuffix.copyWith(fontSize: 20)),
              ],
            ),
            if (cert?.rank != null) ...[
              const SizedBox(height: 12),
              Text(
                'Class rank ${cert!.rank}${cert.cohortSize != null ? ' of ${cert.cohortSize}' : ''}',
                style: AppText.body.copyWith(fontWeight: FontWeight.w700, color: AppColors.textSecondary),
              ),
            ],
            const SizedBox(height: 26),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 10,
              runSpacing: 10,
              children: [
                if (cert != null && cert.available && cert.code.isNotEmpty)
                  PdfDownloadButton(
                    label: 'Download certificate',
                    tone: AppButtonTone.primary,
                    size: AppButtonSize.large,
                    suggestedName: 'certificate-${cert.code}.pdf',
                    fetch: () => services.api.midtermCertificatePdf(cert.code),
                    failure: "The certificate couldn't be produced right now. Your result is safe.",
                    onError: onDownloadError,
                  ),
                PdfDownloadButton(
                  label: 'Download report',
                  icon: LucideIcons.fileText,
                  size: AppButtonSize.large,
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
            const SizedBox(height: 26),
            Container(
              width: 56,
              height: 56,
              decoration: const BoxDecoration(color: AppColors.surface2, shape: BoxShape.circle),
              child: const Icon(LucideIcons.clock, size: 26, color: AppColors.mute),
            ),
            const SizedBox(height: 14),
            Text('Submitted', style: AppText.heading),
            const SizedBox(height: 6),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 380),
              child: Text(
                'Your answers are in. Your teacher will release the results and your certificate shortly.',
                textAlign: TextAlign.center,
                style: AppText.bodyMuted.copyWith(height: 1.5),
              ),
            ),
            const SizedBox(height: 20),
            AppButton(
              label: 'Check again',
              icon: LucideIcons.refreshCw,
              tone: AppButtonTone.secondary,
              onPressed: onCheckAgain,
            ),
          ],
        ],
      ),
    );
  }
}
