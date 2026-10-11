// The midterm flow's look, matched to the website's exam frame (Tailwind values from
// frontend/src/features/testing-simulation/components/{DesktopScreens,MidtermRulesScreen,
// OffscreenWarning,SatColorRule}.tsx): the white page between two Bluebook colour rules, the
// centred card, the blue pill buttons.
//
// No browser habits: no hand cursor and no hover lift (a hover only darkens the fill, as the
// website does), nothing selectable, no context menu. Buttons take keyboard focus and fire on
// Enter/Space, with a focus ring only for keyboard users.
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Tailwind's palette, the values the website's classes resolve to.
abstract final class MidtermColors {
  static const white = Color(0xFFFFFFFF);
  static const slate50 = Color(0xFFF8FAFC);
  static const slate100 = Color(0xFFF1F5F9);
  static const slate200 = Color(0xFFE2E8F0);
  static const slate300 = Color(0xFFCBD5E1);
  static const slate400 = Color(0xFF94A3B8);
  static const slate500 = Color(0xFF64748B);
  static const slate600 = Color(0xFF475569);
  static const slate700 = Color(0xFF334155);
  static const slate800 = Color(0xFF1E293B);
  static const slate900 = Color(0xFF0F172A);
  static const blue50 = Color(0xFFEFF6FF);
  static const blue500 = Color(0xFF3B82F6);
  static const blue600 = Color(0xFF2563EB);
  static const blue700 = Color(0xFF1D4ED8);
  static const blue800 = Color(0xFF1E40AF);
  static const red50 = Color(0xFFFEF2F2);
  static const red200 = Color(0xFFFECACA);
  static const red500 = Color(0xFFEF4444);
  static const red600 = Color(0xFFDC2626);
  static const red700 = Color(0xFFB91C1C);
  static const red800 = Color(0xFF991B1B);
  static const red900 = Color(0xFF7F1D1D);
  static const red950 = Color(0xFF450A0A);
  static const amber50 = Color(0xFFFFFBEB);
  static const amber100 = Color(0xFFFEF3C7);
  static const amber200 = Color(0xFFFDE68A);
  static const amber600 = Color(0xFFD97706);
  static const amber900 = Color(0xFF78350F);
  static const emerald50 = Color(0xFFECFDF5);
  static const emerald600 = Color(0xFF059669);
  static const emerald700 = Color(0xFF047857);
  static const green700 = Color(0xFF15803D);
  static const yellow600 = Color(0xFFCA8A04);
}

/// The exam frame's font: the website's stack resolves to Arial on Windows.
const String midtermFontFamily = 'Arial';
const List<String> midtermFontFallback = ['Segoe UI', 'Helvetica', 'sans-serif'];

/// Tailwind text sizes with their line heights (`text-sm` = 14/20 …).
abstract final class MidtermText {
  static TextStyle size(double px, {FontWeight weight = FontWeight.w400, Color? color, double? tracking}) {
    final lh = switch (px) {
      11 => 16.5,
      12 => 16.0,
      14 => 20.0,
      16 => 24.0,
      18 => 28.0,
      20 => 28.0,
      24 => 32.0,
      30 => 36.0,
      36 => 40.0,
      48 => 48.0,
      _ => px * 1.4,
    };
    return TextStyle(
      fontSize: px,
      height: lh / px,
      fontWeight: weight,
      color: color,
      letterSpacing: tracking == null ? null : tracking * px,
    );
  }

  /// `tracking-tight`.
  static const tight = -0.025;

  /// `tracking-wide`.
  static const wide = 0.025;
}

/// The frame's text and icon defaults; every midterm screen sits under one.
class MidtermTheme extends StatelessWidget {
  const MidtermTheme({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DefaultTextStyle.merge(
      style: const TextStyle(
        fontFamily: midtermFontFamily,
        fontFamilyFallback: midtermFontFallback,
        color: MidtermColors.slate900,
        fontSize: 14,
        decoration: TextDecoration.none,
      ),
      child: IconTheme.merge(
        data: const IconThemeData(color: MidtermColors.slate900, size: 20),
        child: child,
      ),
    );
  }
}

/// The Bluebook multi-colour dashed rule (red / amber / green / navy), 3 px high.
class SatColorRule extends StatelessWidget {
  const SatColorRule({super.key});

  @override
  Widget build(BuildContext context) =>
      const SizedBox(height: 3, width: double.infinity, child: CustomPaint(painter: _SatRulePainter()));
}

class _SatRulePainter extends CustomPainter {
  const _SatRulePainter();

  static const _colors = [MidtermColors.red700, MidtermColors.yellow600, MidtermColors.green700, MidtermColors.slate900];

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    var x = 0.0;
    var i = 0;
    while (x < size.width) {
      paint.color = _colors[i % 4];
      canvas.drawRect(Rect.fromLTWH(x, 0, math.min(48, size.width - x), size.height), paint);
      x += 54;
      i++;
    }
  }

  @override
  bool shouldRepaint(_SatRulePainter oldDelegate) => false;
}

/// The white page between two colour rules (`flex h-screen flex-col bg-white`).
class MidtermPage extends StatelessWidget {
  const MidtermPage({super.key, required this.child, this.rules = true});
  final Widget child;

  /// The colour rules top and bottom (the website's terminated screen has none).
  final bool rules;

  @override
  Widget build(BuildContext context) {
    return MidtermTheme(
      child: ColoredBox(
        color: MidtermColors.white,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (rules) const SatColorRule(),
            Expanded(child: child),
            if (rules) const SatColorRule(),
          ],
        ),
      ),
    );
  }
}

/// A card centred on the page (`max-w-lg rounded-3xl border p-10 shadow-sm`), scrolling when
/// the window is short.
class MidtermFrame extends StatelessWidget {
  const MidtermFrame({super.key, required this.children, this.maxWidth = 512, this.padding = 40, this.rules = true});

  final List<Widget> children;
  final double maxWidth;
  final double padding;
  final bool rules;

  @override
  Widget build(BuildContext context) {
    return MidtermPage(
      rules: rules,
      child: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: math.max(0, constraints.maxHeight - 64)),
            child: Center(
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: maxWidth),
                child: MidtermCard(
                  padding: EdgeInsets.all(padding),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// `rounded-3xl border border-slate-200 bg-white shadow-sm`.
class MidtermCard extends StatelessWidget {
  const MidtermCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(40),
    this.radius = 24,
    this.border = MidtermColors.slate200,
    this.color = MidtermColors.white,
    this.shadow = MidtermShadow.sm,
  });

  final Widget child;
  final EdgeInsets padding;
  final double radius;
  final Color? border;
  final Color color;
  final List<BoxShadow> shadow;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(radius),
        border: border == null ? null : Border.all(color: border!),
        boxShadow: shadow,
      ),
      child: Padding(padding: padding, child: child),
    );
  }
}

abstract final class MidtermShadow {
  static const sm = [BoxShadow(color: Color(0x0D000000), offset: Offset(0, 1), blurRadius: 2)];
  static const xl = [
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 20), blurRadius: 25, spreadRadius: -5),
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 8), blurRadius: 10, spreadRadius: -6),
  ];
  static const xxl = [BoxShadow(color: Color(0x40000000), offset: Offset(0, 25), blurRadius: 50, spreadRadius: -12)];
  static const none = <BoxShadow>[];
}

enum BadgeTone { blue, red }

/// The 56 px rounded square holding a screen's icon.
class IconBadge extends StatelessWidget {
  const IconBadge(this.icon, {super.key, this.tone = BadgeTone.blue, this.size = 56, this.iconSize = 28});

  final IconData icon;
  final BadgeTone tone;
  final double size;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final red = tone == BadgeTone.red;
    return Center(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: red ? MidtermColors.red50 : MidtermColors.blue50,
          borderRadius: BorderRadius.circular(16),
        ),
        alignment: Alignment.center,
        child: Icon(icon, size: iconSize, color: red ? MidtermColors.red600 : MidtermColors.blue700),
      ),
    );
  }
}

/// Screen title (`text-2xl font-bold tracking-tight`, centred).
class MidtermTitle extends StatelessWidget {
  const MidtermTitle(this.text, {super.key, this.top = 16});
  final String text;
  final double top;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(top: top),
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: MidtermText.size(24, weight: FontWeight.w700, color: MidtermColors.slate900, tracking: MidtermText.tight),
        ),
      );
}

/// Lead paragraph (`text-sm font-medium text-slate-500`, centred).
class MidtermLead extends StatelessWidget {
  const MidtermLead(this.text, {super.key, this.top = 8});
  final String text;
  final double top;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(top: top),
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: MidtermText.size(14, weight: FontWeight.w500, color: MidtermColors.slate500),
        ),
      );
}

enum MidtermButtonKind { primary, outline }

/// A pill button. Hover darkens the fill (as `hover:bg-blue-800` does); the cursor stays the
/// arrow; Enter or Space fires it when focused; disabled is 50 % opacity and inert.
class MidtermButton extends StatefulWidget {
  const MidtermButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.kind = MidtermButtonKind.primary,
    this.expand = true,
    this.padding = const EdgeInsets.symmetric(horizontal: 32, vertical: 12),
    this.textSize = 16,
    this.autofocus = false,
    this.semanticLabel,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final MidtermButtonKind kind;
  final bool expand;
  final EdgeInsets padding;
  final double textSize;
  final bool autofocus;
  final String? semanticLabel;

  @override
  State<MidtermButton> createState() => _MidtermButtonState();
}

class _MidtermButtonState extends State<MidtermButton> {
  bool _hover = false;
  bool _focusRing = false;

  bool get _enabled => widget.onPressed != null;

  @override
  Widget build(BuildContext context) {
    final primary = widget.kind == MidtermButtonKind.primary;
    final bg = primary
        ? (_hover && _enabled ? MidtermColors.blue800 : MidtermColors.blue700)
        : (_hover && _enabled ? MidtermColors.slate50 : MidtermColors.white);
    final fg = primary ? MidtermColors.white : MidtermColors.slate800;
    final content = Row(
      mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (widget.icon != null) ...[
          Icon(widget.icon, size: 20, color: fg),
          const SizedBox(width: 8),
        ],
        Flexible(
          child: Text(
            widget.label,
            textAlign: TextAlign.center,
            style: MidtermText.size(widget.textSize, weight: FontWeight.w700, color: fg),
          ),
        ),
      ],
    );
    return Semantics(
      button: true,
      enabled: _enabled,
      label: widget.semanticLabel,
      child: FocusableActionDetector(
        enabled: _enabled,
        autofocus: widget.autofocus,
        mouseCursor: SystemMouseCursors.basic,
        shortcuts: const {
          SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
          SingleActivator(LogicalKeyboardKey.numpadEnter): ActivateIntent(),
          SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
        },
        actions: {
          ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) {
            widget.onPressed?.call();
            return null;
          }),
        },
        onShowHoverHighlight: (v) => setState(() => _hover = v),
        onShowFocusHighlight: (v) => setState(() => _focusRing = v),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: widget.onPressed,
          child: Opacity(
            opacity: _enabled ? 1 : 0.5,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(999),
                border: primary ? null : Border.all(color: MidtermColors.slate300),
                boxShadow: _focusRing
                    ? const [BoxShadow(color: MidtermColors.blue500, spreadRadius: 2)]
                    : MidtermShadow.none,
              ),
              child: Padding(padding: widget.padding, child: content),
            ),
          ),
        ),
      ),
    );
  }
}

/// The small text button ("← Back", "Back to rules"): slate-500, slate-800 on hover.
class MidtermLinkButton extends StatefulWidget {
  const MidtermLinkButton({super.key, required this.label, required this.onPressed, this.icon});

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  @override
  State<MidtermLinkButton> createState() => _MidtermLinkButtonState();
}

class _MidtermLinkButtonState extends State<MidtermLinkButton> {
  bool _hover = false;
  bool _focusRing = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    final color = _hover && enabled ? MidtermColors.slate800 : MidtermColors.slate500;
    return Semantics(
      button: true,
      enabled: enabled,
      child: FocusableActionDetector(
        enabled: enabled,
        mouseCursor: SystemMouseCursors.basic,
        shortcuts: const {
          SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
          SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
        },
        actions: {
          ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) {
            widget.onPressed?.call();
            return null;
          }),
        },
        onShowHoverHighlight: (v) => setState(() => _hover = v),
        onShowFocusHighlight: (v) => setState(() => _focusRing = v),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: widget.onPressed,
          child: Opacity(
            opacity: enabled ? 1 : 0.4,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(6),
                boxShadow: _focusRing ? const [BoxShadow(color: MidtermColors.blue500, spreadRadius: 2)] : null,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (widget.icon != null) ...[
                    Icon(widget.icon, size: 16, color: color),
                    const SizedBox(width: 6),
                  ],
                  Text(widget.label, style: MidtermText.size(14, weight: FontWeight.w700, color: color)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The website's loading spinner: a 40 px ring, slate-200 with a blue-600 quarter, turning.
class MidtermSpinner extends StatefulWidget {
  const MidtermSpinner({super.key, this.size = 40, this.stroke = 4});
  final double size;
  final double stroke;

  @override
  State<MidtermSpinner> createState() => _MidtermSpinnerState();
}

class _MidtermSpinnerState extends State<MidtermSpinner> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 1))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: RotationTransition(
        turns: _c,
        child: CustomPaint(painter: _RingPainter(widget.stroke)),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  const _RingPainter(this.stroke);
  final double stroke;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(stroke / 2, stroke / 2, size.width - stroke, size.height - stroke);
    final base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = MidtermColors.slate200;
    canvas.drawArc(rect, 0, math.pi * 2, false, base);
    final top = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = MidtermColors.blue600;
    canvas.drawArc(rect, -math.pi * 3 / 4, math.pi / 2, false, top);
  }

  @override
  bool shouldRepaint(_RingPainter oldDelegate) => oldDelegate.stroke != stroke;
}
