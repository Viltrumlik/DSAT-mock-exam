// Port of components/WelcomeScreen.tsx: the start screen shown before a module's clock runs.
// The countdown does NOT start until the student presses Start (ExamSession.start); where
// the window can go full screen, Start also enters it.
import 'package:flutter/widgets.dart';

import '../tokens/bluebook_tokens.dart';
import 'icons/lucide_glyphs.dart';
import 'icons/lucide_icon.dart';
import 'runner_style.dart';
import 'sat_color_rule.dart';

/// WelcomeScreen.tsx:68-73, verbatim.
const welcomeBullets = [
  'The timer starts when you press Start and cannot be reset.',
  'You can flag questions for review and return to them before submitting.',
  'Your answers save automatically as you go.',
];
const welcomeFullscreenBullet = 'The test opens in full screen — stay in full screen until you finish.';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({
    super.key,
    required this.moduleTitle,
    required this.subjectLabel,
    required this.onStart,
    this.kindLabel = 'Past Paper',
    this.minutes,
    this.questionCount,
    this.starting = false,
    this.fullscreenSupported = false,
  });

  final String moduleTitle;
  final String subjectLabel;
  final VoidCallback onStart;

  /// The eyebrow: "Past Paper" | "Midterm".
  final String kindLabel;
  final int? minutes;
  final int? questionCount;
  final bool starting;
  final bool fullscreenSupported;

  Widget _tile(LucideGlyph glyph, String value, String label) => Expanded(
    child: Container(
      padding: const EdgeInsets.all(BluebookTokens.welcomeTilePadding),
      decoration: BoxDecoration(
        color: BluebookTokens.welcomeTileBackground,
        border: Border.all(color: TwColors.slate200),
        borderRadius: BorderRadius.circular(BluebookTokens.welcomeTileRadius),
      ),
      child: Column(
        children: [
          LucideIcon(glyph, size: BluebookTokens.welcomeTileIcon, color: BluebookTokens.welcomeTileIconColor),
          const SizedBox(height: BluebookTokens.welcomeTileValueTop),
          Text(
            value,
            style: chromeText(BluebookTokens.welcomeTileValueSize, weight: FontWeight.w700, height: 28 / 18),
          ),
          Text(
            label.toUpperCase(),
            style: chromeText(
              BluebookTokens.welcomeTileLabelSize,
              weight: FontWeight.w600,
              color: BluebookTokens.welcomeTileLabelColor,
              trackingEm: BluebookTokens.trackingWide,
            ),
          ),
        ],
      ),
    ),
  );

  Widget _bullet(String text) => Padding(
    padding: const EdgeInsets.only(top: BluebookTokens.welcomeBulletGap),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '•',
          style: chromeText(BluebookTokens.welcomeBulletSize, color: BluebookTokens.welcomeBullet, height: 20 / 14),
        ),
        const SizedBox(width: BluebookTokens.welcomeBulletGap),
        Expanded(
          child: Text(
            text,
            style: chromeText(
              BluebookTokens.welcomeBulletSize,
              color: BluebookTokens.welcomeBulletColor,
              height: 20 / 14,
            ),
          ),
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final bullets = [...welcomeBullets, if (fullscreenSupported) welcomeFullscreenBullet];
    return ColoredBox(
      color: BluebookTokens.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SatColorRule(),
          Expanded(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: BluebookTokens.welcomeSidePadding),
                child: Container(
                  key: const ValueKey('welcome.card'),
                  constraints: const BoxConstraints(maxWidth: BluebookTokens.welcomeMaxWidth),
                  padding: const EdgeInsets.all(BluebookTokens.welcomePadding),
                  decoration: BoxDecoration(
                    color: TwColors.white,
                    border: Border.all(color: TwColors.slate200),
                    borderRadius: BorderRadius.circular(BluebookTokens.welcomeRadius),
                    boxShadow: TwShadows.sm,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        kindLabel.toUpperCase(),
                        textAlign: TextAlign.center,
                        style: chromeText(
                          BluebookTokens.welcomeEyebrowSize,
                          weight: FontWeight.w700,
                          color: BluebookTokens.welcomeEyebrowColor,
                          height: 16 / 12,
                          trackingEm: BluebookTokens.welcomeEyebrowTracking,
                        ),
                      ),
                      const SizedBox(height: BluebookTokens.welcomeTitleTop),
                      Text(
                        moduleTitle,
                        key: const ValueKey('welcome.title'),
                        textAlign: TextAlign.center,
                        style: chromeText(
                          BluebookTokens.welcomeTitleSize,
                          weight: FontWeight.w700,
                          height: BluebookTokens.welcomeTitleLineHeight,
                          trackingEm: BluebookTokens.trackingTight,
                        ),
                      ),
                      const SizedBox(height: BluebookTokens.welcomeSubTop),
                      Text(
                        'When you’re ready, start the $subjectLabel module below.',
                        textAlign: TextAlign.center,
                        style: chromeText(
                          BluebookTokens.welcomeSubSize,
                          weight: FontWeight.w500,
                          color: BluebookTokens.welcomeSubColor,
                          height: 20 / 14,
                        ),
                      ),
                      const SizedBox(height: BluebookTokens.welcomeTilesTop),
                      Row(
                        children: [
                          _tile(LucideGlyphs.clock, minutes != null && minutes! > 0 ? '$minutes min' : '—', 'Time'),
                          const SizedBox(width: BluebookTokens.welcomeTileGap),
                          _tile(
                            LucideGlyphs.listChecks,
                            questionCount != null && questionCount! > 0 ? '$questionCount' : '—',
                            'Questions',
                          ),
                        ],
                      ),
                      const SizedBox(height: BluebookTokens.welcomeBulletsTop - BluebookTokens.welcomeBulletGap),
                      for (final b in bullets) _bullet(b),
                      const SizedBox(height: BluebookTokens.welcomeStartTop),
                      Pressable(
                        key: const ValueKey('welcome.start'),
                        semanticLabel: 'Start',
                        enabled: !starting,
                        onTap: onStart,
                        builder: (context, s) => Opacity(
                          opacity: s.enabled ? 1 : BluebookTokens.welcomeStartDisabledOpacity,
                          child: Container(
                            padding: BluebookTokens.welcomeStartPadding,
                            decoration: BoxDecoration(
                              color: s.hovered ? BluebookTokens.welcomeStartHover : BluebookTokens.welcomeStart,
                              borderRadius: BorderRadius.circular(BluebookTokens.pillRadius),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                LucideIcon(
                                  fullscreenSupported ? LucideGlyphs.maximize : LucideGlyphs.play,
                                  size: BluebookTokens.welcomeStartIcon,
                                  color: TwColors.white,
                                ),
                                const SizedBox(width: BluebookTokens.welcomeStartGap),
                                Text(
                                  starting ? 'Starting…' : 'Start',
                                  style: chromeText(
                                    BluebookTokens.welcomeStartSize,
                                    weight: FontWeight.w700,
                                    color: TwColors.white,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SatColorRule(),
        ],
      ),
    );
  }
}
