// Port of tools/highlight/AnnotationToolbar.tsx: the Bluebook-style annotation popover — one
// row of three colour swatches · three underline styles · delete · note — hung 10 px above the
// selection (below it when there is no room), clamped 8 px inside the window.
//
// The selection lives in the content island; this toolbar is native (texture mode,
// `init.overlays:"native"`). Its position comes from the island's `selection` / `annot.click`
// rect plus the island's origin in the window.
import 'package:flutter/widgets.dart';

import '../../core/models/models.dart';
import '../runner/dashed_border.dart';
import '../runner/icons/lucide_glyphs.dart';
import '../runner/icons/lucide_icon.dart';
import '../runner/runner_style.dart';
import '../tokens/bluebook_tokens.dart';

/// AnnotationToolbar.tsx:17-21.
const toolbarSwatches = <({HighlightColor color, Color bg, String label})>[
  (color: HighlightColor.yellow, bg: BluebookTokens.swatchYellow, label: 'Yellow highlight'),
  (color: HighlightColor.blue, bg: BluebookTokens.swatchBlue, label: 'Blue highlight'),
  (color: HighlightColor.pink, bg: BluebookTokens.swatchPink, label: 'Pink highlight'),
];

/// AnnotationToolbar.tsx:23-27.
const toolbarLines = <({UnderlineStyle style, CssBorderStyle css, String label})>[
  (style: UnderlineStyle.solid, css: CssBorderStyle.solid, label: 'Solid underline'),
  (style: UnderlineStyle.dashed, css: CssBorderStyle.dashed, label: 'Dashed underline'),
  (style: UnderlineStyle.dotted, css: CssBorderStyle.dotted, label: 'Dotted underline'),
];

class AnnotationToolbar extends StatelessWidget {
  const AnnotationToolbar({
    super.key,
    required this.anchorX,
    required this.anchorTop,
    required this.anchorBottom,
    required this.activeColor,
    required this.activeUnderline,
    required this.onColor,
    required this.onUnderline,
    required this.onDelete,
    this.onAddNote,
    this.barKey,
  });

  /// Keys the bar itself (the runner hit-tests it for outside clicks).
  final Key? barKey;

  /// Selection centre x and top/bottom, in the coordinates of the Stack this sits in.
  final double anchorX;
  final double anchorTop;
  final double anchorBottom;
  final HighlightColor? activeColor;
  final UnderlineStyle? activeUnderline;
  final ValueChanged<HighlightColor> onColor;
  final ValueChanged<UnderlineStyle> onUnderline;
  final VoidCallback onDelete;
  final VoidCallback? onAddNote;

  Widget _divider() => Container(
    width: 1,
    height: BluebookTokens.toolbarDividerHeight,
    margin: const EdgeInsets.symmetric(horizontal: 2),
    color: TwColors.slate200,
  );

  Widget _iconButton({
    required Key key,
    required String label,
    required VoidCallback onTap,
    required Widget Function(Color fg) icon,
    bool active = false,
    bool danger = false,
  }) => Pressable(
    key: key,
    semanticLabel: label,
    selected: active,
    onTap: onTap,
    builder: (context, s) {
      Color fg = BluebookTokens.toolbarIconColor;
      Color? bg;
      if (active) {
        fg = TwColors.blue700;
        bg = TwColors.blue50;
      }
      if (s.hovered) {
        if (danger) {
          fg = TwColors.red600;
          bg = TwColors.red50;
        } else if (!active) {
          bg = TwColors.slate100;
        }
      }
      return Container(
        width: BluebookTokens.toolbarButton,
        height: BluebookTokens.toolbarButton,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
        child: icon(fg),
      );
    },
  );

  @override
  Widget build(BuildContext context) {
    final bar = Container(
      key: const ValueKey('toolbar'),
      padding: BluebookTokens.toolbarPadding,
      decoration: BoxDecoration(
        color: TwColors.white,
        border: Border.all(color: TwColors.slate200),
        borderRadius: BorderRadius.circular(12),
        boxShadow: TwShadows.xl,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final s in toolbarSwatches) ...[
            Pressable(
              key: ValueKey('toolbar.color.${s.color.wire}'),
              semanticLabel: s.label,
              selected: activeColor == s.color,
              onTap: () => onColor(s.color),
              // No hover-grow (the website's hover:scale-110 is a browser habit we drop).
              builder: (context, st) => Container(
                width: BluebookTokens.swatchSize,
                height: BluebookTokens.swatchSize,
                decoration: BoxDecoration(
                  color: s.bg,
                  shape: BoxShape.circle,
                  // ring-2 ring-slate-900 ring-offset-1 (active) / ring-1 ring-slate-200.
                  boxShadow: activeColor == s.color
                      ? const [
                          BoxShadow(color: TwColors.slate900, spreadRadius: 3),
                          BoxShadow(color: TwColors.white, spreadRadius: 1),
                        ]
                      : const [BoxShadow(color: TwColors.slate200, spreadRadius: 1)],
                ),
              ),
            ),
            const SizedBox(width: BluebookTokens.toolbarGap),
          ],
          _divider(),
          const SizedBox(width: BluebookTokens.toolbarGap),
          for (final l in toolbarLines) ...[
            _iconButton(
              key: ValueKey('toolbar.underline.${l.style.wire}'),
              label: l.label,
              active: activeUnderline == l.style,
              onTap: () => onUnderline(l.style),
              icon: (fg) => CssLine(color: fg, style: l.css),
            ),
            const SizedBox(width: BluebookTokens.toolbarGap),
          ],
          _divider(),
          const SizedBox(width: BluebookTokens.toolbarGap),
          _iconButton(
            key: const ValueKey('toolbar.delete'),
            label: 'Delete annotation',
            danger: true,
            onTap: onDelete,
            icon: (fg) => LucideIcon(LucideGlyphs.trash2, size: BluebookTokens.toolbarIcon, color: fg),
          ),
          if (onAddNote != null) ...[
            const SizedBox(width: BluebookTokens.toolbarGap),
            _iconButton(
              key: const ValueKey('toolbar.note'),
              label: 'Add note',
              onTap: onAddNote!,
              icon: (fg) => LucideIcon(LucideGlyphs.stickyNote, size: BluebookTokens.toolbarIcon, color: fg),
            ),
          ],
        ],
      ),
    );
    return CustomSingleChildLayout(
      delegate: ToolbarLayoutDelegate(x: anchorX, top: anchorTop, bottom: anchorBottom),
      child: Semantics(
        container: true,
        label: 'Annotation options',
        child: KeyedSubtree(key: barKey, child: bar),
      ),
    );
  }
}

/// AnnotationToolbar.tsx:44-56 — centre on the selection, prefer 10 px above it, flip below
/// when there is no room, keep 8 px from every window edge.
class ToolbarLayoutDelegate extends SingleChildLayoutDelegate {
  ToolbarLayoutDelegate({required this.x, required this.top, required this.bottom});

  final double x;
  final double top;
  final double bottom;

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) => constraints.loosen();

  @override
  Offset getPositionForChild(Size size, Size childSize) =>
      toolbarPosition(size, childSize, x: x, top: top, bottom: bottom);

  @override
  bool shouldRelayout(ToolbarLayoutDelegate old) => old.x != x || old.top != top || old.bottom != bottom;
}

/// The placement rule, pure (tests).
Offset toolbarPosition(Size window, Size bar, {required double x, required double top, required double bottom}) {
  const margin = BluebookTokens.toolbarMargin;
  var left = x - bar.width / 2;
  left = left.clamp(margin, (window.width - bar.width - margin).clamp(margin, double.infinity)).toDouble();
  var t = top - bar.height - BluebookTokens.toolbarSelectionGap;
  if (t < margin) t = bottom + BluebookTokens.toolbarSelectionGap;
  t = t.clamp(margin, (window.height - bar.height - margin).clamp(margin, double.infinity)).toDouble();
  return Offset(left, t);
}
