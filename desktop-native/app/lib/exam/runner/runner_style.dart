// Shared building blocks for the runner chrome: text styles that reproduce CSS line boxes,
// a press target with no browser habits, and the website's border spinner.
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../tokens/bluebook_tokens.dart';

/// A chrome text style in Arial. [height] is the CSS line-height multiple (preflight default
/// 1.5) with half-leading split evenly like CSS; [trackingEm] is Tailwind's `tracking-*`.
TextStyle chromeText(
  double size, {
  FontWeight weight = FontWeight.w400,
  Color color = TwColors.slate900,
  double height = 1.5,
  double trackingEm = 0,
  FontStyle style = FontStyle.normal,
  List<FontFeature>? features,
  TextDecoration? decoration,
  Color? decorationColor,
}) => TextStyle(
  fontFamily: BluebookTokens.chromeFont,
  fontFamilyFallback: BluebookTokens.chromeFontFallback,
  fontSize: size,
  fontWeight: weight,
  fontStyle: style,
  color: color,
  height: height,
  leadingDistribution: TextLeadingDistribution.even,
  // Always set: a null spacing would inherit a Material theme's (bodyLarge has 0.5).
  letterSpacing: trackingEm * size,
  fontFeatures: features,
  decoration: decoration,
  decorationColor: decorationColor,
);

/// The UI sans used by overlays the website portals outside the runner (Report dialog, toasts).
TextStyle uiText(
  double size, {
  FontWeight weight = FontWeight.w400,
  Color color = BluebookTokens.textPrimary,
  double height = 1.5,
  double trackingEm = 0,
}) => TextStyle(
  fontFamily: BluebookTokens.uiFont,
  fontFamilyFallback: BluebookTokens.uiFontFallback,
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height,
  leadingDistribution: TextLeadingDistribution.even,
  // Always set: a null spacing would inherit a Material theme's (bodyLarge has 0.5).
  letterSpacing: trackingEm * size,
);

/// Georgia reading text (Directions, Reference formulas).
TextStyle readingText(
  double size, {
  Color color = TwColors.slate900,
  double height = 1.5,
  FontWeight weight = FontWeight.w400,
}) => TextStyle(
  fontFamily: BluebookTokens.readingFont,
  fontFamilyFallback: const ['Times New Roman'],
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height,
  leadingDistribution: TextLeadingDistribution.even,
);

/// Monospace (Tailwind `font-mono`).
TextStyle monoText(
  double size, {
  Color color = TwColors.slate900,
  FontWeight weight = FontWeight.w400,
  double height = 1.5,
}) => TextStyle(
  fontFamily: BluebookTokens.monoFont,
  fontFamilyFallback: BluebookTokens.monoFontFallback,
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height,
  leadingDistribution: TextLeadingDistribution.even,
);

/// Hover/press state handed to a [Pressable] builder.
@immutable
class PressState {
  const PressState({required this.hovered, required this.pressed, required this.enabled, required this.focused});
  final bool hovered;
  final bool pressed;
  final bool enabled;
  final bool focused;
}

/// A click target for the runner chrome. Native-app rules (OWNERSHIP.md "No browser habits"):
/// the arrow cursor (never the hand), no hover lift, nothing selectable, no context menu.
/// Hover only changes colours, exactly where the website's `hover:` classes do. Enter/Space
/// activate it when it has keyboard focus.
class Pressable extends StatefulWidget {
  const Pressable({
    super.key,
    required this.onTap,
    required this.builder,
    this.enabled = true,
    this.semanticLabel,
    this.selected,
    this.focusable = true,
    this.onTapDown,
  });

  final VoidCallback? onTap;
  final Widget Function(BuildContext context, PressState state) builder;
  final bool enabled;
  final String? semanticLabel;

  /// aria-pressed / aria-current equivalent for semantics.
  final bool? selected;
  final bool focusable;

  /// Pointer-down hook (drag handles use it to stop a panel drag).
  final VoidCallback? onTapDown;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _hovered = false;
  bool _pressed = false;
  bool _focused = false;

  bool get _enabled => widget.enabled && widget.onTap != null;

  void _activate() {
    if (_enabled) widget.onTap!();
  }

  @override
  Widget build(BuildContext context) {
    final state = PressState(hovered: _hovered && _enabled, pressed: _pressed, enabled: _enabled, focused: _focused);
    return Semantics(
      button: true,
      enabled: _enabled,
      selected: widget.selected,
      label: widget.semanticLabel,
      child: Focus(
        canRequestFocus: widget.focusable && _enabled,
        skipTraversal: !widget.focusable,
        onFocusChange: (f) => setState(() => _focused = f),
        onKeyEvent: (node, event) {
          if (event is KeyDownEvent &&
              (event.logicalKey == LogicalKeyboardKey.enter ||
                  event.logicalKey == LogicalKeyboardKey.numpadEnter ||
                  event.logicalKey == LogicalKeyboardKey.space)) {
            _activate();
            return KeyEventResult.handled;
          }
          return KeyEventResult.ignored;
        },
        child: MouseRegion(
          cursor: SystemMouseCursors.basic,
          onEnter: (_) => setState(() => _hovered = true),
          onExit: (_) => setState(() {
            _hovered = false;
            _pressed = false;
          }),
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapDown: (_) {
              widget.onTapDown?.call();
              if (_enabled) setState(() => _pressed = true);
            },
            onTapCancel: () => setState(() => _pressed = false),
            onTapUp: (_) => setState(() => _pressed = false),
            onTap: _enabled ? _activate : null,
            // Right-click does nothing anywhere in the runner (no context menu).
            onSecondaryTap: () {},
            child: widget.builder(context, state),
          ),
        ),
      ),
    );
  }
}

/// Swallows pointer events that reach it (modal scrims, blocked regions) with the arrow cursor.
class PointerSink extends StatelessWidget {
  const PointerSink({super.key, this.onTap, this.child, this.color});

  final VoidCallback? onTap;
  final Widget? child;
  final Color? color;

  @override
  Widget build(BuildContext context) => MouseRegion(
    cursor: SystemMouseCursors.basic,
    child: GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      onSecondaryTap: () {},
      onPanStart: (_) {},
      child: color == null
          ? (child ?? const SizedBox.expand())
          : ColoredBox(color: color!, child: child ?? const SizedBox.expand()),
    ),
  );
}

/// The website's CSS spinner: `rounded-full border-4 border-slate-200 border-t-blue-600
/// animate-spin` (ModuleTransitionOverlay.tsx:12, StatusScreens.tsx:7).
class BorderSpinner extends StatefulWidget {
  const BorderSpinner({
    super.key,
    this.size = BluebookTokens.spinnerSize,
    this.stroke = BluebookTokens.spinnerStroke,
    this.track = BluebookTokens.spinnerTrack,
    this.arc = BluebookTokens.spinnerArc,
    this.animate = true,
  });

  final double size;
  final double stroke;
  final Color track;
  final Color arc;

  /// Goldens freeze it (a still frame of the same drawing).
  final bool animate;

  @override
  State<BorderSpinner> createState() => _BorderSpinnerState();
}

class _BorderSpinnerState extends State<BorderSpinner> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 1));

  @override
  void initState() {
    super.initState();
    if (widget.animate) _c.repeat();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: widget.size,
    child: AnimatedBuilder(
      animation: _c,
      builder: (context, _) => CustomPaint(
        painter: _SpinnerPainter(turns: _c.value, stroke: widget.stroke, track: widget.track, arc: widget.arc),
      ),
    ),
  );
}

class _SpinnerPainter extends CustomPainter {
  _SpinnerPainter({required this.turns, required this.stroke, required this.track, required this.arc});

  final double turns;
  final double stroke;
  final Color track;
  final Color arc;

  @override
  void paint(Canvas canvas, Size size) {
    // A CSS border ring: the top border is a quarter, mitred at 45° on both sides.
    final rect = Offset.zero & size;
    final inner = rect.deflate(stroke / 2);
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;
    canvas.drawOval(inner, p..color = track);
    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);
    canvas.rotate(turns * 2 * math.pi);
    canvas.translate(-size.width / 2, -size.height / 2);
    canvas.drawArc(inner, -3 * math.pi / 4, math.pi / 2, false, p..color = arc);
    canvas.restore();
  }

  @override
  bool shouldRepaint(_SpinnerPainter old) => old.turns != turns || old.arc != arc || old.track != track;
}

/// Disables the drag-to-select and the default context menu for everything below (the
/// runner's chrome is never selectable).
class NoSelection extends StatelessWidget {
  const NoSelection({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => SelectionContainer.disabled(child: child);
}
