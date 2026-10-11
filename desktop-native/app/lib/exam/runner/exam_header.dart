// Ports of components/ExamHeader.tsx, components/Timer.tsx and components/DesktopBattery.tsx:
// the runner's top bar — Section/Module title and Directions on the left, the countdown with
// its Hide/Show and Pause pills in the middle, the tool cluster (Calculator, Reference,
// Highlights & Notes, More, battery) on the right — plus the low-battery banner that sits
// under the colour rule.
//
// Layout (ExamHeader.tsx:67): `grid grid-cols-3 items-center px-6 py-3` — three equal
// columns, so the timer stays centred on the window whatever the side columns hold.
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../../native/native_bridge.dart' show BatteryStatus;
import '../tokens/bluebook_tokens.dart';
import 'icons/lucide_glyphs.dart';
import 'icons/lucide_icon.dart';
import 'runner_style.dart';

/// utils/time.ts:4-9 `formatClock`: `m:ss`, minutes unpadded, never negative.
String formatClock(int totalSeconds) {
  final s = totalSeconds < 0 ? 0 : totalSeconds;
  final mins = s ~/ 60;
  final secs = s % 60;
  return '$mins:${secs.toString().padLeft(2, '0')}';
}

/// ExamRunnerPage.tsx:1043 — the red state: under five minutes and not yet at zero.
bool timerWarningFor(Duration remaining) {
  final s = remaining.inSeconds;
  return s <= BluebookTokens.timerWarningAt.inSeconds && s > 0;
}

/// useBattery.ts:11-13 `isLowBattery`: a laptop, unplugged, under 25 %.
bool isLowBattery(BatteryStatus? b) =>
    b != null && b.hasBattery && !b.charging && b.percent != null && b.percent! < BluebookTokens.lowBatteryPercent;

/// ExamHeader.tsx:32-44 `ToolButton`: icon over a 12 px label; slate-900, hover slate-600,
/// active `#2b47c9`.
class ToolButton extends StatelessWidget {
  const ToolButton({
    super.key,
    required this.label,
    required this.icon,
    required this.onTap,
    this.active = false,
    this.semanticLabel,
  });

  final String label;
  final Widget Function(Color color) icon;
  final VoidCallback onTap;
  final bool active;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) => Pressable(
    semanticLabel: semanticLabel ?? label,
    selected: active,
    onTap: onTap,
    builder: (context, s) {
      final color = active
          ? BluebookTokens.toolActiveColor
          : (s.hovered ? BluebookTokens.toolHoverColor : BluebookTokens.toolColor);
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          icon(color),
          const SizedBox(height: BluebookTokens.toolGap),
          Text(
            label,
            style: chromeText(
              BluebookTokens.toolLabelSize,
              weight: FontWeight.w600,
              color: color,
              height: BluebookTokens.toolLabelLineHeight,
            ),
          ),
        ],
      );
    },
  );
}

/// Timer.tsx:18-19 PILL — the Hide/Show and Pause/Resume pills share one look.
class TimerPill extends StatelessWidget {
  const TimerPill({
    super.key,
    required this.label,
    required this.glyph,
    required this.onTap,
    this.dimmed = false,
    this.selected,
  });

  final String label;
  final LucideGlyph glyph;
  final VoidCallback onTap;

  /// Pause while offline: still clickable (it explains why it cannot pause), drawn faded.
  final bool dimmed;
  final bool? selected;

  @override
  Widget build(BuildContext context) => Pressable(
    semanticLabel: label,
    selected: selected,
    onTap: onTap,
    builder: (context, s) => Opacity(
      opacity: dimmed ? 0.5 : 1,
      child: Container(
        padding: BluebookTokens.pillPadding,
        decoration: BoxDecoration(
          border: Border.all(color: s.hovered ? BluebookTokens.pillHoverBorder : BluebookTokens.pillBorder),
          borderRadius: BorderRadius.circular(BluebookTokens.pillRadius),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            LucideIcon(glyph, size: BluebookTokens.pillIcon, color: BluebookTokens.pillColor),
            const SizedBox(width: BluebookTokens.pillGap),
            Text(
              label,
              style: chromeText(
                BluebookTokens.pillLabelSize,
                weight: FontWeight.w600,
                color: BluebookTokens.pillColor,
                height: 16 / 12,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// Timer.tsx — the countdown (redrawn on its own once a second), the under-5-minutes badge,
/// and the Hide/Show + Pause/Resume pills.
class ExamTimer extends StatelessWidget {
  const ExamTimer({
    super.key,
    required this.remaining,
    required this.hidden,
    required this.onToggleHidden,
    this.pauseAllowed = false,
    this.paused = false,
    this.pauseAvailable = true,
    this.onTogglePause,
  });

  final ValueListenable<Duration> remaining;
  final bool hidden;
  final VoidCallback onToggleHidden;
  final bool pauseAllowed;
  final bool paused;

  /// False offline: the Pause pill is faded (it still answers with the "needs a connection"
  /// notice). Resume is never faded.
  final bool pauseAvailable;
  final VoidCallback? onTogglePause;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<Duration>(
    valueListenable: remaining,
    builder: (context, left, _) {
      final warning = timerWarningFor(left);
      final color = warning ? BluebookTokens.timerWarningColor : BluebookTokens.timerColor;
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (hidden)
            LucideIcon(
              LucideGlyphs.clock,
              key: const ValueKey('timer.hiddenClock'),
              size: BluebookTokens.timerHiddenClock,
              color: warning ? BluebookTokens.timerWarningColor : BluebookTokens.timerHiddenClockColor,
            )
          else
            ExcludeSemantics(
              child: Text(
                formatClock(left.inSeconds),
                key: const ValueKey('timer.clock'),
                style: chromeText(
                  BluebookTokens.timerSize,
                  weight: FontWeight.w700,
                  color: color,
                  height: 1,
                  trackingEm: BluebookTokens.timerTracking,
                  features: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
          if (warning) ...[
            const SizedBox(height: BluebookTokens.timerGap),
            Container(
              key: const ValueKey('timer.warning'),
              padding: BluebookTokens.timerBadgePadding,
              decoration: BoxDecoration(
                color: BluebookTokens.timerBadgeBackground,
                borderRadius: BorderRadius.circular(BluebookTokens.pillRadius),
              ),
              child: Text(
                'LESS THAN 5 MINUTES',
                style: chromeText(
                  BluebookTokens.timerBadgeSize,
                  weight: FontWeight.w700,
                  color: BluebookTokens.timerBadgeColor,
                  trackingEm: BluebookTokens.trackingWide,
                ),
              ),
            ),
          ],
          const SizedBox(height: BluebookTokens.timerGap),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              TimerPill(
                key: const ValueKey('timer.toggle'),
                label: hidden ? 'Show' : 'Hide',
                glyph: hidden ? LucideGlyphs.eye : LucideGlyphs.eyeOff,
                onTap: onToggleHidden,
              ),
              if (pauseAllowed && onTogglePause != null) ...[
                const SizedBox(width: BluebookTokens.timerPillGap),
                TimerPill(
                  key: const ValueKey('timer.pause'),
                  label: paused ? 'Resume' : 'Pause',
                  glyph: paused ? LucideGlyphs.play : LucideGlyphs.pause,
                  selected: paused,
                  dimmed: !paused && !pauseAvailable,
                  onTap: onTogglePause!,
                ),
              ],
            ],
          ),
        ],
      );
    },
  );
}

/// DesktopBattery.tsx:9-33 — the battery reading at the end of the tool cluster. Nothing
/// without a battery.
class BatteryIndicator extends StatelessWidget {
  const BatteryIndicator({super.key, required this.battery});

  final BatteryStatus? battery;

  @override
  Widget build(BuildContext context) {
    final b = battery;
    if (b == null || b.percent == null || !b.hasBattery) return const SizedBox.shrink();
    final low = isLowBattery(b);
    final glyph = b.charging
        ? LucideGlyphs.batteryCharging
        : low
        ? LucideGlyphs.batteryWarning
        : b.percent! >= 60
        ? LucideGlyphs.batteryFull
        : b.percent! >= 30
        ? LucideGlyphs.batteryMedium
        : LucideGlyphs.batteryLow;
    final color = low ? BluebookTokens.batteryLowColor : BluebookTokens.batteryColor;
    return Semantics(
      label: 'Battery ${b.percent}%${b.charging ? ', charging' : ''}',
      child: ExcludeSemantics(
        child: Column(
          key: const ValueKey('battery'),
          mainAxisSize: MainAxisSize.min,
          children: [
            LucideIcon(glyph, size: BluebookTokens.batteryIcon, color: color),
            const SizedBox(height: BluebookTokens.toolGap),
            Text(
              '${b.percent}%',
              style: chromeText(
                12,
                weight: FontWeight.w600,
                color: color,
                height: 16 / 12,
                features: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// DesktopBattery.tsx:36-61 — under the header while unplugged below 25 %; dismissable, and a
/// new low spell (charged, then unplugged again) warns again.
class LowBatteryBanner extends StatefulWidget {
  const LowBatteryBanner({super.key, required this.battery});

  final BatteryStatus? battery;

  @override
  State<LowBatteryBanner> createState() => _LowBatteryBannerState();
}

class _LowBatteryBannerState extends State<LowBatteryBanner> {
  bool _dismissed = false;

  @override
  void didUpdateWidget(LowBatteryBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!isLowBattery(widget.battery)) _dismissed = false;
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.battery;
    if (!isLowBattery(b) || _dismissed) return const SizedBox.shrink();
    const ink = BluebookTokens.batteryBannerColor;
    return Container(
      key: const ValueKey('battery.banner'),
      padding: BluebookTokens.batteryBannerPadding,
      decoration: const BoxDecoration(
        color: BluebookTokens.batteryBannerBackground,
        border: Border(bottom: BorderSide(color: BluebookTokens.batteryBannerBorder)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const LucideIcon(LucideGlyphs.batteryWarning, size: BluebookTokens.batteryBannerIcon, color: ink),
          const SizedBox(width: BluebookTokens.batteryBannerGap),
          Flexible(
            child: Text(
              'Your battery is low (${b!.percent}%). Plug in your device.',
              style: chromeText(BluebookTokens.batteryBannerSize, weight: FontWeight.w600, color: ink, height: 20 / 14),
            ),
          ),
          const SizedBox(width: BluebookTokens.batteryBannerGap),
          Pressable(
            key: const ValueKey('battery.dismiss'),
            semanticLabel: 'Dismiss battery warning',
            onTap: () => setState(() => _dismissed = true),
            builder: (context, s) => Container(
              padding: const EdgeInsets.all(BluebookTokens.batteryBannerDismissPadding),
              decoration: BoxDecoration(
                color: s.hovered ? BluebookTokens.batteryBannerDismissHover : null,
                borderRadius: BorderRadius.circular(BluebookTokens.batteryBannerDismissRadius),
              ),
              child: const LucideIcon(LucideGlyphs.x, size: BluebookTokens.batteryBannerIcon, color: ink),
            ),
          ),
        ],
      ),
    );
  }
}

/// ExamHeader.tsx — the whole top bar. The More button is passed in ([more]) because its
/// menu is drawn by the runner over the question card.
class ExamHeader extends StatelessWidget {
  const ExamHeader({
    super.key,
    required this.title,
    required this.directionsOpen,
    required this.onToggleDirections,
    required this.timer,
    required this.showCalculator,
    required this.calculatorOpen,
    required this.onToggleCalculator,
    required this.showReference,
    required this.referenceOpen,
    required this.onToggleReference,
    required this.highlighterOn,
    required this.onToggleHighlighter,
    required this.more,
    this.battery,
  });

  final String title;
  final bool directionsOpen;
  final VoidCallback onToggleDirections;
  final Widget timer;
  final bool showCalculator;
  final bool calculatorOpen;
  final VoidCallback onToggleCalculator;
  final bool showReference;
  final bool referenceOpen;
  final VoidCallback onToggleReference;
  final bool highlighterOn;
  final VoidCallback onToggleHighlighter;
  final Widget more;
  final BatteryStatus? battery;

  @override
  Widget build(BuildContext context) {
    final left = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          title,
          key: const ValueKey('header.title'),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: chromeText(
            BluebookTokens.headerTitleSize,
            weight: FontWeight.w700,
            color: BluebookTokens.headerTitleColor,
            height: BluebookTokens.headerTitleLineHeight,
            trackingEm: BluebookTokens.trackingTight,
          ),
        ),
        const SizedBox(height: BluebookTokens.directionsTop),
        Pressable(
          key: const ValueKey('header.directions'),
          semanticLabel: 'Directions',
          selected: directionsOpen,
          onTap: onToggleDirections,
          builder: (context, s) {
            final color = s.hovered ? BluebookTokens.directionsHoverColor : BluebookTokens.directionsColor;
            return Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Directions', style: chromeText(BluebookTokens.directionsSize, color: color)),
                const SizedBox(width: BluebookTokens.directionsGap),
                Transform.rotate(
                  angle: directionsOpen ? 3.141592653589793 : 0,
                  child: LucideIcon(LucideGlyphs.chevronDown, size: BluebookTokens.directionsChevron, color: color),
                ),
              ],
            );
          },
        ),
      ],
    );

    final tools = <Widget>[
      if (showCalculator)
        ToolButton(
          key: const ValueKey('header.calculator'),
          label: 'Calculator',
          active: calculatorOpen,
          onTap: onToggleCalculator,
          icon: (c) => LucideIcon(LucideGlyphs.calculator, size: BluebookTokens.toolIcon, color: c),
        ),
      if (showReference)
        ToolButton(
          key: const ValueKey('header.reference'),
          label: 'Reference',
          active: referenceOpen,
          onTap: onToggleReference,
          // ExamHeader.tsx:103 `text-base font-bold italic leading-none` "x²".
          icon: (c) => SizedBox(
            height: BluebookTokens.toolIcon,
            child: Center(
              child: Text(
                'x²',
                style: chromeText(
                  BluebookTokens.referenceGlyphSize,
                  weight: FontWeight.w700,
                  color: c,
                  height: 1,
                  style: FontStyle.italic,
                ),
              ),
            ),
          ),
        ),
      ToolButton(
        key: const ValueKey('header.highlighter'),
        label: 'Highlights & Notes',
        active: highlighterOn,
        onTap: onToggleHighlighter,
        icon: (c) => SizedBox.square(
          dimension: BluebookTokens.toolIcon,
          child: Center(
            child: LucideIcon(LucideGlyphs.penLine, size: BluebookTokens.highlightIcon, color: c),
          ),
        ),
      ),
      more,
      if (battery != null && battery!.hasBattery && battery!.percent != null) BatteryIndicator(battery: battery),
    ];

    return ColoredBox(
      color: BluebookTokens.surface,
      child: Padding(
        padding: BluebookTokens.headerPadding,
        child: Row(
          children: [
            Expanded(
              child: Align(alignment: Alignment.centerLeft, child: left),
            ),
            Expanded(child: Center(child: timer)),
            Expanded(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  for (var i = 0; i < tools.length; i++) ...[
                    if (i > 0) const SizedBox(width: BluebookTokens.toolClusterGap),
                    tools[i],
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
