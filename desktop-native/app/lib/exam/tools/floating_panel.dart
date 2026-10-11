// Port of tools/FloatingPanel.tsx: the shared draggable + resizable floating window used by
// the Calculator, the Reference sheet and Notes. Drag by the title bar; resize from the
// bottom-right grip. Pure UI — holds no exam state.
//
// Return it as a direct child of the runner's Stack (it is a Positioned).
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

import '../runner/icons/lucide_glyphs.dart';
import '../runner/icons/lucide_icon.dart';
import '../runner/runner_style.dart';
import '../tokens/bluebook_tokens.dart';

class FloatingPanel extends StatefulWidget {
  const FloatingPanel({
    super.key,
    required this.title,
    required this.onClose,
    required this.child,
    this.initial = const Rect.fromLTWH(120, 90, 380, 520),
    this.minSize = const Size(280, 200),
    this.resizable = true,
    this.headerExtra,
    this.headerLeft,
    this.dark = false,
    this.onBodyRect,
    this.panelKey,
    this.docked = false,
  });

  final String title;
  final VoidCallback onClose;
  final Widget child;

  /// FloatingPanel.tsx:30 default `{ x: 120, y: 90, w: 380, h: 520 }`.
  final Rect initial;
  final Size minSize;
  final bool resizable;

  /// Extra title-bar controls left of the close button.
  final Widget? headerExtra;

  /// Replaces the title text (e.g. the calculator tabs).
  final Widget? headerLeft;

  /// Dark (navy) title bar (the calculator).
  final bool dark;

  /// Reports the body's rectangle in global coordinates after every layout (the Desmos
  /// island uses it for windowed-mode bounds).
  final ValueChanged<Rect>? onBodyRect;

  /// Key for the panel box (tests find panels by it).
  final Key? panelKey;

  /// Docked: no Positioned, no drag, no resize — the box fills its parent. The windowed
  /// fallback docks Notes beside the question card (architecture §2.6), because a Flutter
  /// panel cannot float over a child window.
  final bool docked;

  @override
  State<FloatingPanel> createState() => FloatingPanelState();
}

class FloatingPanelState extends State<FloatingPanel> {
  late Offset _pos = widget.initial.topLeft;
  late Size _size = widget.initial.size;
  Offset? _dragAnchor;
  Offset? _resizeAnchor;
  final GlobalKey _bodyKey = GlobalKey();

  /// Current geometry (tests).
  Rect get rect => _pos & _size;

  @override
  void didUpdateWidget(FloatingPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    // FloatingPanel.tsx:42-45 — follow a new requested size (the enlarge toggle).
    if (oldWidget.initial.width != widget.initial.width || oldWidget.initial.height != widget.initial.height) {
      _size = widget.initial.size;
    }
  }

  void _reportBody() {
    if (widget.onBodyRect == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final box = _bodyKey.currentContext?.findRenderObject() as RenderBox?;
      if (box == null || !box.attached || !box.hasSize) return;
      widget.onBodyRect!(box.localToGlobal(Offset.zero) & box.size);
    });
  }

  @override
  Widget build(BuildContext context) {
    final viewport = MediaQuery.sizeOf(context);
    _reportBody();
    final dark = widget.dark;
    final docked = widget.docked;
    final box = Semantics(
      container: true,
      label: widget.title,
      child: Container(
        key: widget.panelKey,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: TwColors.white,
          border: Border.all(color: BluebookTokens.panelBorder),
          borderRadius: BorderRadius.circular(BluebookTokens.panelRadius),
          boxShadow: TwShadows.xxl,
        ),
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Title bar (FloatingPanel.tsx:91-109): drag handle.
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  dragStartBehavior: DragStartBehavior.down,
                  onPanStart: docked ? null : (d) => _dragAnchor = d.globalPosition - _pos,
                  onPanUpdate: (d) {
                    if (docked) return;
                    final a = _dragAnchor;
                    if (a == null) return;
                    final maxX = viewport.width - BluebookTokens.panelKeepVisibleX;
                    final maxY = viewport.height - BluebookTokens.panelKeepVisibleY;
                    setState(
                      () => _pos = Offset(
                        math.min(maxX, math.max(0, d.globalPosition.dx - a.dx)),
                        math.min(maxY, math.max(0, d.globalPosition.dy - a.dy)),
                      ),
                    );
                  },
                  onPanEnd: (_) => _dragAnchor = null,
                  onSecondaryTap: () {},
                  child: Container(
                    key: const ValueKey('panel.titlebar'),
                    padding: BluebookTokens.panelHeaderPadding,
                    decoration: BoxDecoration(
                      color: dark ? BluebookTokens.panelHeaderDark : BluebookTokens.panelHeaderLight,
                      border: Border(
                        bottom: BorderSide(
                          color: dark ? BluebookTokens.panelHeaderDarkBorder : BluebookTokens.panelHeaderLightBorder,
                        ),
                      ),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child:
                                widget.headerLeft ??
                                Text(
                                  widget.title,
                                  maxLines: 1,
                                  overflow: TextOverflow.clip,
                                  style: chromeText(
                                    14,
                                    weight: FontWeight.w700,
                                    color: dark ? TwColors.white : BluebookTokens.panelTitleColor,
                                    height: 20 / 14,
                                  ),
                                ),
                          ),
                        ),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (widget.headerExtra != null) ...[widget.headerExtra!, const SizedBox(width: 4)],
                            PanelIconButton(
                              key: ValueKey('panel.close.${widget.title}'),
                              glyph: LucideGlyphs.x,
                              label: 'Close ${widget.title}',
                              dark: dark,
                              onTap: widget.onClose,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                Expanded(
                  child: KeyedSubtree(key: _bodyKey, child: widget.child),
                ),
              ],
            ),
            if (widget.resizable && !docked)
              Positioned(
                right: 0,
                bottom: 0,
                width: BluebookTokens.panelGrip,
                height: BluebookTokens.panelGrip,
                child: MouseRegion(
                  cursor: SystemMouseCursors.resizeDownRight,
                  child: GestureDetector(
                    key: const ValueKey('panel.grip'),
                    behavior: HitTestBehavior.opaque,
                    dragStartBehavior: DragStartBehavior.down,
                    onPanStart: (d) => _resizeAnchor = d.globalPosition - Offset(_size.width, _size.height),
                    onPanUpdate: (d) {
                      final a = _resizeAnchor;
                      if (a == null) return;
                      setState(
                        () => _size = Size(
                          math.max(widget.minSize.width, d.globalPosition.dx - a.dx),
                          math.max(widget.minSize.height, d.globalPosition.dy - a.dy),
                        ),
                      );
                    },
                    onPanEnd: (_) => _resizeAnchor = null,
                    child: const CustomPaint(painter: _GripPainter()),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
    if (docked) return box;
    return Positioned(left: _pos.dx, top: _pos.dy, width: _size.width, height: _size.height, child: box);
  }
}

/// `linear-gradient(135deg, transparent 50%, #94a3b8 50%)` on a 16×16 square: the lower-right
/// triangle.
class _GripPainter extends CustomPainter {
  const _GripPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(size.width, 0)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(path, Paint()..color = BluebookTokens.panelGripColor);
  }

  @override
  bool shouldRepaint(_GripPainter oldDelegate) => false;
}

/// The title-bar icon button (close / enlarge): `rounded p-0.5`, a 16 px icon; light
/// `text-slate-400 hover:bg-slate-200 hover:text-slate-700`, dark `text-slate-300
/// hover:bg-white/10 hover:text-white` (FloatingPanel.tsx:100-107, DesmosCalculator.tsx:90-99).
class PanelIconButton extends StatelessWidget {
  const PanelIconButton({super.key, required this.glyph, required this.label, required this.onTap, this.dark = false});

  final LucideGlyph glyph;
  final String label;
  final VoidCallback onTap;
  final bool dark;

  @override
  Widget build(BuildContext context) => Pressable(
    semanticLabel: label,
    onTap: onTap,
    builder: (context, s) {
      final Color fg;
      final Color? bg;
      if (dark) {
        fg = s.hovered ? TwColors.white : BluebookTokens.panelDarkIcon;
        bg = s.hovered ? BluebookTokens.panelDarkHover : null;
      } else {
        fg = s.hovered ? TwColors.slate700 : TwColors.slate400;
        bg = s.hovered ? TwColors.slate200 : null;
      }
      return Container(
        padding: const EdgeInsets.all(2),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(4)),
        child: LucideIcon(glyph, size: BluebookTokens.panelCloseIcon, color: fg),
      );
    },
  );
}
