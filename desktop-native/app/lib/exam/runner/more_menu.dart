// Port of tools/MoreMenu.tsx: the "More" button and its dropdown of secondary tools. The
// button sits in the header's tool cluster; the dropdown is drawn by the runner over the
// question card (it must float over the content island), hung `right-0 top-full mt-2` from
// the button through a LayerLink. Every item runs its action and closes the menu.
import 'package:flutter/widgets.dart';

import '../tokens/bluebook_tokens.dart';
import 'exam_header.dart' show ToolButton;
import 'icons/lucide_glyphs.dart';
import 'icons/lucide_icon.dart';
import 'runner_style.dart';

/// One dropdown row.
@immutable
class MoreMenuItem {
  const MoreMenuItem({
    required this.id,
    required this.label,
    required this.glyph,
    required this.onTap,
    this.active = false,
  });

  /// Stable test id (`more.<id>`).
  final String id;
  final String label;
  final LucideGlyph glyph;
  final VoidCallback onTap;
  final bool active;
}

/// MoreMenu.tsx:73-100 — the rows, in the website's order. [onSaveAndExit] is null on
/// midterms (no Save & Exit), [onTogglePause] null when the paper cannot pause,
/// [onToggleFullscreen] null where the window cannot change, [onReportProblem] null with no
/// current question.
List<MoreMenuItem> moreMenuItems({
  required bool isFullscreen,
  VoidCallback? onToggleFullscreen,
  required bool highlighterOn,
  required VoidCallback onToggleHighlighter,
  required bool notesOpen,
  required VoidCallback onToggleNotes,
  VoidCallback? onReportProblem,
  required VoidCallback onZoomIn,
  required VoidCallback onZoomOut,
  required bool paused,
  VoidCallback? onTogglePause,
  required VoidCallback onToggleHelp,
}) => [
  if (onToggleFullscreen != null)
    MoreMenuItem(
      id: 'fullscreen',
      label: isFullscreen ? 'Exit full screen' : 'Full screen',
      glyph: isFullscreen ? LucideGlyphs.minimize : LucideGlyphs.maximize,
      onTap: onToggleFullscreen,
    ),
  MoreMenuItem(
    id: 'highlighter',
    label: highlighterOn ? 'Highlighter: On' : 'Highlighter: Off',
    glyph: LucideGlyphs.highlighter,
    onTap: onToggleHighlighter,
    active: highlighterOn,
  ),
  MoreMenuItem(id: 'notes', label: 'Notes', glyph: LucideGlyphs.stickyNote, onTap: onToggleNotes, active: notesOpen),
  if (onReportProblem != null)
    MoreMenuItem(id: 'report', label: 'Report a problem', glyph: LucideGlyphs.flag, onTap: onReportProblem),
  MoreMenuItem(id: 'zoomIn', label: 'Zoom in', glyph: LucideGlyphs.zoomIn, onTap: onZoomIn),
  MoreMenuItem(id: 'zoomOut', label: 'Zoom out', glyph: LucideGlyphs.zoomOut, onTap: onZoomOut),
  if (onTogglePause != null)
    MoreMenuItem(
      id: 'pause',
      label: paused ? 'Resume' : 'Pause',
      glyph: paused ? LucideGlyphs.play : LucideGlyphs.pause,
      onTap: onTogglePause,
    ),
  MoreMenuItem(id: 'help', label: 'Keyboard shortcuts', glyph: LucideGlyphs.keyboard, onTap: onToggleHelp),
];

/// MoreMenu.tsx:62-71 — the header button.
class MoreMenuButton extends StatelessWidget {
  const MoreMenuButton({super.key, required this.link, required this.open, required this.onTap});

  final LayerLink link;
  final bool open;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => CompositedTransformTarget(
    link: link,
    child: ToolButton(
      key: const ValueKey('header.more'),
      label: 'More',
      // The website's More button never takes the active colour (no aria-pressed styling).
      onTap: onTap,
      icon: (c) => LucideIcon(LucideGlyphs.moreVertical, size: BluebookTokens.toolIcon, color: c),
    ),
  );
}

/// MoreMenu.tsx:73 — the dropdown, following [link]'s bottom-right corner. A direct child of
/// the runner's Stack (it is a Positioned, so it sizes to its content and the right-edge
/// anchor lines up).
class MoreMenuPanel extends StatelessWidget {
  const MoreMenuPanel({
    super.key,
    required this.link,
    required this.items,
    required this.onClose,
    this.onSaveAndExit,
    this.panelKey,
    this.hitKey,
  });

  /// Keys the menu box (the runner hit-tests it for outside clicks).
  final Key? hitKey;

  final LayerLink link;
  final List<MoreMenuItem> items;
  final VoidCallback onClose;

  /// Past papers only (the divider + Save & Exit row).
  final VoidCallback? onSaveAndExit;
  final Key? panelKey;

  Widget _row(String id, String label, LucideGlyph glyph, VoidCallback onTap, {bool active = false}) => Pressable(
    key: ValueKey('more.$id'),
    semanticLabel: label,
    selected: active,
    onTap: () {
      onTap();
      onClose();
    },
    builder: (context, s) {
      final color = active ? BluebookTokens.menuItemActiveColor : BluebookTokens.menuItemColor;
      return Container(
        color: s.hovered ? BluebookTokens.menuItemHover : null,
        padding: BluebookTokens.menuItemPadding,
        child: Row(
          children: [
            LucideIcon(glyph, size: BluebookTokens.menuItemIcon, color: color),
            const SizedBox(width: BluebookTokens.menuItemGap),
            Expanded(
              child: Text(
                label,
                style: chromeText(
                  BluebookTokens.menuItemSize,
                  weight: FontWeight.w600,
                  color: color,
                  height: BluebookTokens.menuItemLineHeight,
                ),
              ),
            ),
          ],
        ),
      );
    },
  );

  @override
  Widget build(BuildContext context) => Positioned(
    left: 0,
    top: 0,
    child: CompositedTransformFollower(
      link: link,
      targetAnchor: Alignment.bottomRight,
      followerAnchor: Alignment.topRight,
      offset: const Offset(0, BluebookTokens.menuOffset),
      showWhenUnlinked: false,
      child: Semantics(
        container: true,
        label: 'More',
        child: KeyedSubtree(
          key: hitKey,
          child: Container(
            key: panelKey ?? const ValueKey('more.menu'),
            width: BluebookTokens.menuWidth,
            clipBehavior: Clip.antiAlias,
            padding: const EdgeInsets.symmetric(vertical: BluebookTokens.menuPaddingV),
            decoration: BoxDecoration(
              color: TwColors.white,
              border: Border.all(color: BluebookTokens.menuBorder),
              borderRadius: BorderRadius.circular(BluebookTokens.menuRadius),
              boxShadow: BluebookTokens.menuShadow,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final i in items) _row(i.id, i.label, i.glyph, i.onTap, active: i.active),
                if (onSaveAndExit != null) ...[
                  Container(
                    height: 1,
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    color: BluebookTokens.menuDivider,
                  ),
                  _row('saveExit', 'Save & Exit', LucideGlyphs.logOut, onSaveAndExit!),
                ],
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
