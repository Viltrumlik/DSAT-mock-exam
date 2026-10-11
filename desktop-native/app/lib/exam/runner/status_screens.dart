// The runner's full-window states, ported from components/StatusScreens.tsx and
// components/ModuleTransitionOverlay.tsx, plus the app's own offline states (architecture §3
// "Deliberate differences": no fixed 1.6 s transition; "Submitting…" never spins forever).
//
// Copy follows the website's wording where a website screen exists; the offline states are
// new and use the design's wording ("Saved on this computer — will send when you're back
// online", design_data_server.md §1.7/§1.11).
import 'package:flutter/widgets.dart';

import '../tokens/bluebook_tokens.dart';
import 'icons/lucide_glyphs.dart';
import 'icons/lucide_icon.dart';
import 'runner_style.dart';

/// "Saved on this computer — will send when you're back online".
const savedOfflineTitle = 'Saved on this computer — will send when you’re back online';

/// A centred status column on white: an optional spinner/icon, a title and a muted body line
/// (StatusScreens.tsx:44-51 / ModuleTransitionOverlay.tsx:11-15).
class StatusScreen extends StatelessWidget {
  const StatusScreen({
    super.key,
    this.title,
    this.body,
    this.extra,
    this.spinner = true,
    this.spinnerArc = BluebookTokens.spinnerArc,
    this.icon,
    this.action,
    this.animate = true,
  });

  final String? title;
  final String? body;

  /// A second, smaller line under [body].
  final String? extra;
  final bool spinner;
  final Color spinnerArc;
  final LucideGlyph? icon;
  final Widget? action;
  final bool animate;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: BluebookTokens.surface,
    child: Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (spinner) BorderSpinner(arc: spinnerArc, animate: animate),
              if (!spinner && icon != null) LucideIcon(icon!, size: 40, color: TwColors.slate500),
              if (title != null) ...[
                const SizedBox(height: 24),
                Text(
                  title!,
                  key: const ValueKey('status.title'),
                  textAlign: TextAlign.center,
                  style: chromeText(
                    BluebookTokens.statusTitleSize,
                    weight: FontWeight.w700,
                    height: BluebookTokens.statusTitleLineHeight,
                    trackingEm: BluebookTokens.trackingTight,
                  ),
                ),
              ],
              if (body != null) ...[
                SizedBox(height: title == null ? 20 : 8),
                Text(
                  body!,
                  key: const ValueKey('status.body'),
                  textAlign: TextAlign.center,
                  style: chromeText(16, weight: FontWeight.w500, color: BluebookTokens.statusBodyColor),
                ),
              ],
              if (extra != null) ...[
                const SizedBox(height: 8),
                Text(
                  extra!,
                  key: const ValueKey('status.extra'),
                  textAlign: TextAlign.center,
                  style: chromeText(14, color: TwColors.slate400, height: 20 / 14),
                ),
              ],
              if (action != null) ...[const SizedBox(height: 24), action!],
            ],
          ),
        ),
      ),
    ),
  );
}

/// StatusScreens.tsx:4-11 `LoadingScreen` (label "Loading exam…"; "Saving your progress…" for
/// Save & Exit, ExamRunnerPage.tsx:866-868).
class LoadingScreen extends StatelessWidget {
  const LoadingScreen({super.key, this.label = 'Loading exam…', this.animate = true});
  final String label;
  final bool animate;

  @override
  Widget build(BuildContext context) => StatusScreen(body: label, animate: animate);
}

/// ModuleTransitionOverlay.tsx — "Continuing to Module N" over the next module's title. Shown
/// only while the switch actually takes (no artificial wait). A midterm waits for the
/// server's module 2; it says so quietly.
class ModuleTransitionScreen extends StatelessWidget {
  const ModuleTransitionScreen({
    super.key,
    required this.toModuleOrder,
    required this.moduleTitle,
    this.waitingForServer = false,
    this.online = true,
    this.animate = true,
  });

  final int toModuleOrder;

  /// The next module's header title (the website passes `moduleLabel(attempt)`).
  final String moduleTitle;
  final bool waitingForServer;
  final bool online;
  final bool animate;

  @override
  Widget build(BuildContext context) => StatusScreen(
    key: const ValueKey('transition'),
    title: 'Continuing to Module $toModuleOrder',
    body: moduleTitle,
    extra: !waitingForServer
        ? null
        : online
        ? 'Your answers are saved. Module $toModuleOrder opens as soon as it arrives.'
        : 'Your answers are saved on this computer. Module $toModuleOrder opens as soon as you’re back online.',
    animate: animate,
  );
}

/// The last module was handed in. Online: a short "Submitting…" while the hand-in goes out.
/// Offline: the answers are safe on disk and go out on reconnect.
class SubmittingScreen extends StatelessWidget {
  const SubmittingScreen({super.key, required this.online, this.animate = true});
  final bool online;
  final bool animate;

  @override
  Widget build(BuildContext context) => online
      ? StatusScreen(
          key: const ValueKey('submitting'),
          title: 'Submitting…',
          body: 'This only takes a moment.',
          spinnerArc: BluebookTokens.spinnerArcScoring,
          animate: animate,
        )
      : const StatusScreen(
          key: ValueKey('submitting.offline'),
          spinner: false,
          icon: LucideGlyphs.cloudOff,
          title: savedOfflineTitle,
          body: 'You can keep this window open — it sends by itself as soon as the connection is back.',
        );
}

/// A midterm module boundary or finish while offline (ExamPhase.offlineWaiting).
class OfflineWaitingScreen extends StatelessWidget {
  const OfflineWaitingScreen({super.key, this.animate = true});
  final bool animate;

  @override
  Widget build(BuildContext context) => StatusScreen(
    key: const ValueKey('offlineWaiting'),
    title: savedOfflineTitle,
    body: 'Reconnecting — keep this window open. You’ll continue as soon as the connection is back.',
    animate: animate,
  );
}

/// Save & Exit while offline: say honestly that the clock is not paused on the server
/// (design_data_server.md §1.9).
class SavedOfflineExitScreen extends StatelessWidget {
  const SavedOfflineExitScreen({super.key, required this.onContinue});
  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) => StatusScreen(
    key: const ValueKey('savedOfflineExit'),
    spinner: false,
    icon: LucideGlyphs.cloudOff,
    title: 'Your answers are saved on this computer',
    body:
        'You’re offline, so the module timer keeps running while you’re away. '
        'Your answers will be sent as soon as you’re back online.',
    action: Pressable(
      key: const ValueKey('savedOfflineExit.continue'),
      semanticLabel: 'Back to Home',
      onTap: onContinue,
      builder: (context, s) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 10),
        decoration: BoxDecoration(
          color: s.hovered ? BluebookTokens.primaryButtonHover : BluebookTokens.primaryButton,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          'Back to Home',
          style: chromeText(BluebookTokens.footerButtonSize, weight: FontWeight.w700, color: TwColors.white),
        ),
      ),
    ),
  );
}
