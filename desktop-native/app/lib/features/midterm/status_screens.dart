// The midterm's whole-screen states: waiting (opening, the server handing over Module 2, the
// final hand-in), errors that always have a way back, the paper moved to another window, update
// required, the off-screen forfeit, and "You're all finished!" with the result.
//
// Sources: website StatusScreens.tsx, ModuleTransitionOverlay.tsx, DesktopScreens.tsx,
// OffscreenWarning.tsx, features/desktop/DesktopDone.tsx; 0.1.0 LockdownScreens.tsx.
import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/models/models.dart';
import 'midterm_copy.dart';
import 'midterm_ui.dart';

/// A spinner and a line (website `LoadingScreen`), or — with [title] — the module-transition
/// interstitial ("Continuing to Module 2" over the subject).
class MidtermWaitingScreen extends StatelessWidget {
  const MidtermWaitingScreen({super.key, required this.message, this.title, this.detail});

  /// The line under the spinner (or under [title]).
  final String message;
  final String? title;

  /// A second, quieter line (e.g. waiting for the connection).
  final String? detail;

  @override
  Widget build(BuildContext context) {
    return MidtermPage(
      rules: false,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 448),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const MidtermSpinner(),
                if (title != null) ...[
                  const SizedBox(height: 24),
                  Text(
                    title!,
                    textAlign: TextAlign.center,
                    style: MidtermText.size(20, weight: FontWeight.w700, tracking: MidtermText.tight),
                  ),
                  const SizedBox(height: 8),
                ] else
                  const SizedBox(height: 20),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: MidtermText.size(16, weight: FontWeight.w500, color: MidtermColors.slate500),
                ),
                if (detail != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    detail!,
                    textAlign: TextAlign.center,
                    style: MidtermText.size(14, color: MidtermColors.slate400),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A failure that is never a dead end: there is always a way back (0.1.0 `LockErrorScreen`).
class MidtermErrorScreen extends StatelessWidget {
  const MidtermErrorScreen({super.key, required this.title, required this.body, required this.onHome, this.onRetry});

  final String title;
  final String body;
  final VoidCallback onHome;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return MidtermFrame(children: [
      const IconBadge(LucideIcons.triangleAlert, tone: BadgeTone.red),
      MidtermTitle(title),
      MidtermLead(body),
      const SizedBox(height: 28),
      if (onRetry != null) ...[
        MidtermButton(label: MidtermCopy.tryAgain, icon: LucideIcons.refreshCw, onPressed: onRetry, autofocus: true),
        const SizedBox(height: 12),
      ],
      MidtermButton(
        label: MidtermCopy.backToTests,
        kind: onRetry != null ? MidtermButtonKind.outline : MidtermButtonKind.primary,
        onPressed: onHome,
      ),
    ]);
  }
}

/// The newest app session took the sitting (website/0.1.0 `SessionMovedScreen`).
class MidtermSessionMovedScreen extends StatelessWidget {
  const MidtermSessionMovedScreen({super.key, required this.onHome});
  final VoidCallback onHome;

  @override
  Widget build(BuildContext context) {
    return MidtermFrame(children: [
      const IconBadge(LucideIcons.monitorSmartphone),
      const MidtermTitle(MidtermCopy.sessionMovedTitle),
      const MidtermLead(MidtermCopy.sessionMovedBody),
      const SizedBox(height: 28),
      MidtermButton(label: MidtermCopy.backToTests, onPressed: onHome, autofocus: true),
    ]);
  }
}

/// This build is below the server's minimum. One click updates (Velopack); the download link
/// is the fallback when the update cannot be fetched.
class MidtermUpdateRequiredScreen extends StatefulWidget {
  const MidtermUpdateRequiredScreen({super.key, required this.onHome, this.onUpdateNow, this.onDownload});

  final VoidCallback onHome;

  /// Download and apply the update (restarts the app); reports percent. Throws on failure.
  final Future<void> Function(void Function(int percent) onProgress)? onUpdateNow;

  /// Open the installer download in the browser.
  final VoidCallback? onDownload;

  @override
  State<MidtermUpdateRequiredScreen> createState() => _MidtermUpdateRequiredScreenState();
}

class _MidtermUpdateRequiredScreenState extends State<MidtermUpdateRequiredScreen> {
  int? _percent;
  bool _failed = false;

  Future<void> _update() async {
    final run = widget.onUpdateNow;
    if (run == null) return;
    setState(() {
      _percent = 0;
      _failed = false;
    });
    try {
      await run((p) {
        if (mounted) setState(() => _percent = p.clamp(0, 100));
      });
    } on Object {
      if (mounted) {
        setState(() {
          _percent = null;
          _failed = true;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final updating = _percent != null;
    final canUpdate = widget.onUpdateNow != null && !_failed;
    return MidtermFrame(children: [
      const IconBadge(LucideIcons.refreshCw),
      const MidtermTitle(MidtermCopy.updateTitle),
      const MidtermLead(MidtermCopy.updateBody),
      if (_failed)
        Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Text(
            MidtermCopy.updateFailed,
            textAlign: TextAlign.center,
            style: MidtermText.size(14, weight: FontWeight.w600, color: MidtermColors.red600),
          ),
        ),
      const SizedBox(height: 28),
      if (canUpdate)
        MidtermButton(
          label: updating ? MidtermCopy.updating(_percent!) : MidtermCopy.updateNow,
          icon: LucideIcons.refreshCw,
          autofocus: true,
          onPressed: updating ? null : () => unawaited(_update()),
        )
      else if (widget.onDownload != null)
        MidtermButton(label: MidtermCopy.downloadForWindows, icon: LucideIcons.download, onPressed: widget.onDownload),
      const SizedBox(height: 12),
      MidtermButton(
        label: MidtermCopy.backToTests,
        kind: (canUpdate || widget.onDownload != null) ? MidtermButtonKind.outline : MidtermButtonKind.primary,
        onPressed: updating ? null : widget.onHome,
      ),
    ]);
  }
}

/// The sitting the off-screen rule ended. The paper was submitted BY THE SERVER on the
/// terminating offence — this screen never submits anything; it explains, then moves on.
class MidtermTerminatedScreen extends StatelessWidget {
  const MidtermTerminatedScreen({super.key, required this.onContinue});
  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) {
    return MidtermFrame(
      rules: false,
      maxWidth: 448,
      padding: 32,
      children: [
        const IconBadge(LucideIcons.shieldAlert, tone: BadgeTone.red),
        const MidtermTitle(MidtermCopy.terminatedTitle),
        const MidtermLead(MidtermCopy.terminatedBody, top: 12),
        const SizedBox(height: 28),
        MidtermButton(
          label: MidtermCopy.seeResult,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          autofocus: true,
          onPressed: onContinue,
        ),
      ],
    );
  }
}

/// Bluebook's "You're all finished!" — the lockdown is already released when it shows.
class MidtermDoneScreen extends StatelessWidget {
  const MidtermDoneScreen({
    super.key,
    required this.result,
    required this.onHome,
    this.failed = false,
    this.onOpenReport,
  });

  /// Null while scoring.
  final MidtermResult? result;

  /// The result could not be loaded (no connection) and nothing is known yet.
  final bool failed;
  final VoidCallback onHome;

  /// The full report (results feature); offered once the result is ready.
  final VoidCallback? onOpenReport;

  @override
  Widget build(BuildContext context) {
    final r = result;
    final Widget body;
    if (r == null) {
      body = Text(
        failed ? MidtermCopy.resultFailed : MidtermCopy.scoring,
        textAlign: TextAlign.center,
        style: MidtermText.size(16, weight: FontWeight.w600, color: failed ? MidtermColors.red700 : MidtermColors.slate600),
      );
    } else if (r.released && r.totalScore != null) {
      body = Column(children: [
        Text(
          MidtermCopy.yourScore.toUpperCase(),
          style: MidtermText.size(14, weight: FontWeight.w700, color: MidtermColors.slate500, tracking: MidtermText.wide),
        ),
        const SizedBox(height: 8),
        Text.rich(
          TextSpan(children: [
            TextSpan(text: '${r.totalScore}'),
            if (r.scoreCeiling != null)
              TextSpan(
                text: ' / ${r.scoreCeiling}',
                style: MidtermText.size(24, weight: FontWeight.w700, color: MidtermColors.slate400),
              ),
          ]),
          textAlign: TextAlign.center,
          style: MidtermText.size(48, weight: FontWeight.w800, color: MidtermColors.slate900)
              .copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
        ),
      ]);
    } else {
      body = Text(
        MidtermCopy.awaitingRelease,
        textAlign: TextAlign.center,
        style: MidtermText.size(16, weight: FontWeight.w600, color: MidtermColors.slate600),
      );
    }

    return MidtermPage(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 64),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 576),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const IconBadge(LucideIcons.partyPopper, size: 64, iconSize: 32),
                const SizedBox(height: 20),
                Text(
                  MidtermCopy.finished,
                  textAlign: TextAlign.center,
                  style: MidtermText.size(30, weight: FontWeight.w700, tracking: MidtermText.tight),
                ),
                const SizedBox(height: 32),
                MidtermCard(
                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 40),
                  shadow: MidtermShadow.none,
                  child: body,
                ),
                const SizedBox(height: 32),
                if (r != null && onOpenReport != null) ...[
                  MidtermButton(
                    label: MidtermCopy.openReport,
                    icon: LucideIcons.externalLink,
                    kind: MidtermButtonKind.outline,
                    onPressed: onOpenReport,
                  ),
                  const SizedBox(height: 12),
                ],
                MidtermButton(label: MidtermCopy.backToTests, onPressed: onHome, autofocus: true),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
