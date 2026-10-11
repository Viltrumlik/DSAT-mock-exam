// What both result screens show while there is no result to draw: loading, scoring (the server
// is still marking — polled), offline (Try again RE-SENDS the request) and failed.
import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/toast.dart';
import 'results_controller.dart';

class ResultPendingView extends StatelessWidget {
  const ResultPendingView({
    super.key,
    required this.phase,
    required this.error,
    required this.onRetry,
    required this.loadingLabel,
    required this.failedTitle,
  });

  final ResultPhase phase;
  final String? error;
  final VoidCallback onRetry;

  /// "Loading your report…" / "Loading your result…" (the website's words).
  final String loadingLabel;

  /// "The report didn't load." / "Result not available yet."
  final String failedTitle;

  @override
  Widget build(BuildContext context) {
    switch (phase) {
      case ResultPhase.loading:
      case ResultPhase.ready:
        return _Waiting(title: loadingLabel);
      case ResultPhase.scoring:
        return const _Waiting(
          title: 'Scoring your answers…',
          message: 'Your score appears here in a few seconds.',
        );
      case ResultPhase.offline:
        return EmptyState(
          error: true,
          icon: LucideIcons.wifiOff,
          title: "You're offline",
          message: 'Nothing has been lost — your score is safe. Connect to the internet, then press Try again.',
          actionLabel: 'Try again',
          actionIcon: LucideIcons.refreshCw,
          onAction: onRetry,
        );
      case ResultPhase.failed:
        return EmptyState(
          error: true,
          icon: LucideIcons.triangleAlert,
          title: failedTitle,
          message: error ?? 'Nothing has been lost — your score is safe.',
          actionLabel: 'Try again',
          actionIcon: LucideIcons.refreshCw,
          onAction: onRetry,
        );
    }
  }
}

class _Waiting extends StatelessWidget {
  const _Waiting({required this.title, this.message});

  final String title;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 40),
      child: Column(
        children: [
          const AppSpinner(size: 26),
          const SizedBox(height: 16),
          Text(title, textAlign: TextAlign.center, style: AppText.cardTitle),
          if (message != null) ...[
            const SizedBox(height: 6),
            Text(message!, textAlign: TextAlign.center, style: AppText.bodyMuted),
          ],
        ],
      ),
    );
  }
}

/// A PDF download button: the native Save dialog first, then the download; "Preparing…" while
/// it runs; a toast with the saved path; [failure] (the website's words) when it fails.
class PdfDownloadButton extends StatefulWidget {
  const PdfDownloadButton({
    super.key,
    required this.label,
    required this.suggestedName,
    required this.fetch,
    required this.failure,
    this.icon = LucideIcons.download,
    this.tone = AppButtonTone.secondary,
    this.size = AppButtonSize.medium,
    this.onError,
  });

  final String label;
  final String suggestedName;
  final Future<Uint8List> Function() fetch;
  final String failure;
  final IconData icon;
  final AppButtonTone tone;
  final AppButtonSize size;

  /// Told the failure message (the screen shows it under its buttons).
  final ValueChanged<String?>? onError;

  @override
  State<PdfDownloadButton> createState() => _PdfDownloadButtonState();
}

class _PdfDownloadButtonState extends State<PdfDownloadButton> {
  bool _busy = false;

  Future<void> _run() async {
    final services = AppScope.of(context);
    setState(() => _busy = true);
    widget.onError?.call(null);
    try {
      final path = await services.documents.save(suggestedName: widget.suggestedName, fetch: widget.fetch);
      if (path != null) services.toasts.show('Saved to $path', tone: ToastTone.success);
    } catch (e) {
      services.log.add('download', '${widget.suggestedName}: $e');
      widget.onError?.call(widget.failure);
      if (widget.onError == null) services.toasts.show(widget.failure, tone: ToastTone.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppButton(
      label: widget.label,
      icon: widget.icon,
      tone: widget.tone,
      size: widget.size,
      busy: _busy,
      busyLabel: 'Preparing…',
      onPressed: () => unawaited(_run()),
    );
  }
}
