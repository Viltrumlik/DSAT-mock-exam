// Small runner-styled pieces the launcher draws around a sitting: pill buttons, a full-window
// message (load failures, "questions can't be shown here"), and the problem banner under the
// header. Same tokens and press rules as the runner (Arial chrome, arrow cursor, no lift).
import 'package:flutter/widgets.dart';

import '../runner/icons/lucide_glyphs.dart';
import '../runner/icons/lucide_icon.dart';
import '../runner/runner_style.dart';
import '../runner/status_screens.dart';
import '../tokens/bluebook_tokens.dart';

/// A rounded runner button: filled navy (primary) or outlined.
class RunnerPillButton extends StatelessWidget {
  const RunnerPillButton({super.key, required this.label, required this.onTap, this.primary = true});

  final String label;
  final VoidCallback? onTap;
  final bool primary;

  @override
  Widget build(BuildContext context) => Pressable(
    semanticLabel: label,
    onTap: onTap,
    enabled: onTap != null,
    // Disabled reads as disabled (the runner footer's faded Back), never as a live button.
    builder: (context, s) => Opacity(
      opacity: onTap == null ? 0.45 : 1,
      child: Container(
        padding: BluebookTokens.reviewButtonPaddingFooter,
        decoration: BoxDecoration(
          color: primary
              ? (s.hovered ? BluebookTokens.primaryButtonHover : BluebookTokens.primaryButton)
              : (s.hovered ? TwColors.slate100 : TwColors.white),
          border: primary ? null : Border.all(color: TwColors.slate300),
          borderRadius: BorderRadius.circular(BluebookTokens.pillRadius),
        ),
        child: Text(
          label,
          style: chromeText(
            BluebookTokens.footerButtonSize,
            weight: FontWeight.w700,
            color: primary ? TwColors.white : TwColors.slate900,
          ),
        ),
      ),
    ),
  );
}

/// A full-window message with up to two actions (StatusScreen, no spinner).
class RunnerMessageScreen extends StatelessWidget {
  const RunnerMessageScreen({
    super.key,
    required this.title,
    required this.body,
    this.icon = LucideGlyphs.triangleAlert,
    this.primaryLabel,
    this.onPrimary,
    this.secondaryLabel,
    this.onSecondary,
  });

  final String title;
  final String body;
  final LucideGlyph icon;
  final String? primaryLabel;
  final VoidCallback? onPrimary;
  final String? secondaryLabel;
  final VoidCallback? onSecondary;

  @override
  Widget build(BuildContext context) {
    final buttons = <Widget>[
      if (secondaryLabel != null) RunnerPillButton(label: secondaryLabel!, onTap: onSecondary, primary: false),
      if (primaryLabel != null) RunnerPillButton(label: primaryLabel!, onTap: onPrimary),
    ];
    return StatusScreen(
      spinner: false,
      icon: icon,
      title: title,
      body: body,
      action: buttons.isEmpty
          ? null
          : Wrap(spacing: 12, runSpacing: 12, alignment: WrapAlignment.center, children: buttons),
    );
  }
}

/// A plain strip under the header: something the student must know while answering (a send
/// the server keeps refusing). Optional "Try again".
class RunnerProblemBanner extends StatelessWidget {
  const RunnerProblemBanner({super.key, required this.text, this.onRetry});

  final String text;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      key: const ValueKey('runner.problem'),
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
      decoration: const BoxDecoration(
        color: TwColors.red50,
        border: Border(bottom: BorderSide(color: TwColors.red200)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const LucideIcon(LucideGlyphs.triangleAlert, size: 16, color: TwColors.red700),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              text,
              style: chromeText(14, weight: FontWeight.w600, color: TwColors.red800, height: 20 / 14),
            ),
          ),
          if (onRetry != null) ...[
            const SizedBox(width: 16),
            Pressable(
              semanticLabel: 'Try again',
              onTap: onRetry,
              builder: (context, s) => Text(
                'Try again',
                style: chromeText(
                  14,
                  weight: FontWeight.w700,
                  color: s.hovered ? TwColors.red800 : TwColors.red700,
                  height: 20 / 14,
                ),
              ),
            ),
          ],
        ],
      ),
    ),
  );
}
