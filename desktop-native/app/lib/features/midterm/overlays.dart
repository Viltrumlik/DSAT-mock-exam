// What sits over (or above) the running paper during a midterm: the off-screen warning with its
// countdown, the note after a return, the battery reading and the low-battery and reconnecting
// banners. Website OffscreenWarning.tsx and DesktopBattery.tsx; 0.1.0 LockdownScreens.tsx.
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../exam/engine/midterm_engine.dart' show isLowBattery;
import '../../native/native_bridge.dart';
import 'midterm_copy.dart';
import 'midterm_ui.dart';

/// Full-cover warning the moment the student leaves the exam window. Unmissable and
/// un-dismissable: the only way out is to come back, which the guard detects itself (there is
/// no button — clicking one would prove they are back). It swallows every click and key.
class OffscreenWarning extends StatelessWidget {
  const OffscreenWarning({super.key, required this.secondsLeft, required this.chancesLeft});

  final int secondsLeft;
  final int chancesLeft;

  @override
  Widget build(BuildContext context) {
    final seconds = secondsLeft < 0 ? 0 : secondsLeft;
    return MidtermTheme(
      child: BlockSemantics(
        child: Semantics(
          scopesRoute: true,
          explicitChildNodes: true,
          label: 'Return to your exam',
          child: Focus(
            autofocus: true,
            onKeyEvent: (_, _) => KeyEventResult.handled,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () {},
              child: ColoredBox(
                color: MidtermColors.red950.withValues(alpha: 0.9),
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 512),
                      child: MidtermCard(
                        padding: const EdgeInsets.all(32),
                        border: null,
                        shadow: MidtermShadow.xxl,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const IconBadge(LucideIcons.triangleAlert, tone: BadgeTone.red),
                            const MidtermTitle(MidtermCopy.comeBackTitle),
                            const MidtermLead(MidtermCopy.comeBackBody),
                            const SizedBox(height: 24),
                            MidtermCard(
                              radius: 16,
                              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                              border: MidtermColors.red200,
                              color: MidtermColors.red50,
                              shadow: MidtermShadow.none,
                              child: Semantics(
                                liveRegion: true,
                                child: Column(children: [
                                  Text(
                                    '$seconds',
                                    style: MidtermText.size(36, weight: FontWeight.w700, color: MidtermColors.red700)
                                        .copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    MidtermCopy.secondsToReturn(seconds),
                                    style: MidtermText.size(14, weight: FontWeight.w700, color: MidtermColors.red800),
                                  ),
                                ]),
                              ),
                            ),
                            const SizedBox(height: 16),
                            Center(
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                                decoration: BoxDecoration(
                                  color: MidtermColors.slate100,
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Row(mainAxisSize: MainAxisSize.min, children: [
                                  const Icon(LucideIcons.shieldAlert, size: 16, color: MidtermColors.slate500),
                                  const SizedBox(width: 8),
                                  Text(
                                    offscreenChancesPill(chancesLeft),
                                    style: MidtermText.size(14, weight: FontWeight.w700, color: MidtermColors.slate700),
                                  ),
                                ]),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// After the student came back in time: what it cost, so the warning isn't a mystery once gone.
class OffscreenNotice extends StatelessWidget {
  const OffscreenNotice({super.key, required this.text, required this.onDismiss});

  final String text;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return MidtermTheme(
      child: Align(
        alignment: Alignment.topCenter,
        child: Padding(
          padding: const EdgeInsets.only(top: 80, left: 24, right: 24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 576),
            child: MidtermCard(
              radius: 12,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              border: MidtermColors.red200,
              shadow: MidtermShadow.xl,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(LucideIcons.shieldAlert, size: 20, color: MidtermColors.red600),
                  const SizedBox(width: 16),
                  Flexible(
                    child: Text(
                      text,
                      style: MidtermText.size(14, weight: FontWeight.w600, color: MidtermColors.slate800),
                    ),
                  ),
                  const SizedBox(width: 16),
                  _DarkChip(label: MidtermCopy.gotIt, onPressed: onDismiss),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DarkChip extends StatefulWidget {
  const _DarkChip({required this.label, required this.onPressed});
  final String label;
  final VoidCallback onPressed;

  @override
  State<_DarkChip> createState() => _DarkChipState();
}

class _DarkChipState extends State<_DarkChip> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      child: FocusableActionDetector(
        mouseCursor: SystemMouseCursors.basic,
        shortcuts: const {
          SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
          SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
        },
        actions: {
          ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) {
            widget.onPressed();
            return null;
          }),
        },
        onShowHoverHighlight: (v) => setState(() => _hover = v),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: widget.onPressed,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: _hover ? MidtermColors.slate800 : MidtermColors.slate900,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(widget.label, style: MidtermText.size(14, weight: FontWeight.w700, color: MidtermColors.white)),
          ),
        ),
      ),
    );
  }
}

/// Top-right battery reading, as Bluebook shows it. Nothing without a battery.
class MidtermBatteryIndicator extends StatelessWidget {
  const MidtermBatteryIndicator({super.key, required this.battery});
  final BatteryStatus? battery;

  @override
  Widget build(BuildContext context) {
    final b = battery;
    if (b == null || b.percent == null) return const SizedBox.shrink();
    final low = isLowBattery(b);
    final percent = b.percent!;
    final icon = b.charging
        ? LucideIcons.batteryCharging
        : low
            ? LucideIcons.batteryWarning
            : percent >= 60
                ? LucideIcons.batteryFull
                : percent >= 30
                    ? LucideIcons.batteryMedium
                    : LucideIcons.batteryLow;
    final color = low ? MidtermColors.red600 : MidtermColors.slate900;
    return MidtermTheme(
      child: Semantics(
        label: 'Battery $percent%${b.charging ? ', charging' : ''}',
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 20, color: color),
            const SizedBox(height: 2),
            Text(
              '$percent%',
              style: MidtermText.size(12, weight: FontWeight.w600, color: color)
                  .copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
            ),
          ],
        ),
      ),
    );
  }
}

/// Under the header while the laptop is unplugged at or below 25 %. Plugging in clears it; a
/// new low spell warns again even after a dismissal.
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
    if (!isLowBattery(b) || _dismissed || b == null) return const SizedBox.shrink();
    return MidtermTheme(
      child: Semantics(
        liveRegion: true,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
          decoration: const BoxDecoration(
            color: MidtermColors.amber50,
            border: Border(bottom: BorderSide(color: MidtermColors.amber200)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(LucideIcons.batteryWarning, size: 16, color: MidtermColors.amber900),
              const SizedBox(width: 12),
              Flexible(
                child: Text(
                  MidtermCopy.lowBattery(b.percent),
                  style: MidtermText.size(14, weight: FontWeight.w600, color: MidtermColors.amber900),
                ),
              ),
              const SizedBox(width: 12),
              _IconButton(
                icon: LucideIcons.x,
                label: MidtermCopy.dismissBattery,
                hover: MidtermColors.amber100,
                color: MidtermColors.amber900,
                onPressed: () => setState(() => _dismissed = true),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _IconButton extends StatefulWidget {
  const _IconButton({
    required this.icon,
    required this.label,
    required this.hover,
    required this.color,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final Color hover;
  final Color color;
  final VoidCallback onPressed;

  @override
  State<_IconButton> createState() => _IconButtonState();
}

class _IconButtonState extends State<_IconButton> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: widget.label,
      child: FocusableActionDetector(
        mouseCursor: SystemMouseCursors.basic,
        shortcuts: const {
          SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
          SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
        },
        actions: {
          ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) {
            widget.onPressed();
            return null;
          }),
        },
        onShowHoverHighlight: (v) => setState(() => _hover = v),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: widget.onPressed,
          child: Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: _hover ? widget.hover : null,
              borderRadius: BorderRadius.circular(4),
            ),
            child: Icon(widget.icon, size: 16, color: widget.color),
          ),
        ),
      ),
    );
  }
}

/// NATIVE: a non-blocking note while answers wait for the connection to come back.
class ReconnectingBanner extends StatelessWidget {
  const ReconnectingBanner({super.key, required this.show});
  final bool show;

  @override
  Widget build(BuildContext context) {
    if (!show) return const SizedBox.shrink();
    return MidtermTheme(
      child: Semantics(
        liveRegion: true,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
          decoration: const BoxDecoration(
            color: MidtermColors.slate50,
            border: Border(bottom: BorderSide(color: MidtermColors.slate200)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(LucideIcons.wifiOff, size: 16, color: MidtermColors.slate700),
              const SizedBox(width: 12),
              Flexible(
                child: Text(
                  MidtermCopy.reconnecting,
                  style: MidtermText.size(14, weight: FontWeight.w600, color: MidtermColors.slate700),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// NATIVE: something the server refused for good, said plainly (the work stays on this
/// computer; the teacher can help). Not dismissable: it stays true until the sitting ends.
class ProblemBanner extends StatelessWidget {
  const ProblemBanner({super.key, required this.text});
  final String? text;

  @override
  Widget build(BuildContext context) {
    final t = text;
    if (t == null) return const SizedBox.shrink();
    return MidtermTheme(
      child: Semantics(
        liveRegion: true,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
          decoration: const BoxDecoration(
            color: MidtermColors.red50,
            border: Border(bottom: BorderSide(color: MidtermColors.red200)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(LucideIcons.triangleAlert, size: 16, color: MidtermColors.red700),
              const SizedBox(width: 12),
              Flexible(
                child: Text(t, style: MidtermText.size(14, weight: FontWeight.w600, color: MidtermColors.red800)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
