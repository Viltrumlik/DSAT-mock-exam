// Ports of tools/useKeyboardShortcuts.ts (the key table and its rules) and
// tools/KeyboardShortcutsHelp.tsx (the help modal).
//
// Rules (useKeyboardShortcuts.ts:34-37): nothing fires with Ctrl, Alt or Meta held, nor while
// the student is typing in a text field. The runner adds the rest of the "off" list
// (architecture §2.8 "Keyboard and focus"): dialogs, the transition, Check Your Work, inert or
// lockdown screens, the off-screen countdown and inputLocked.
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../runner/icons/lucide_glyphs.dart';
import '../runner/icons/lucide_icon.dart';
import '../runner/runner_style.dart';
import '../tokens/bluebook_tokens.dart';

/// What a shortcut does.
enum RunnerShortcut { previous, next, choiceA, choiceB, choiceC, choiceD, mark, navigator, help }

extension RunnerShortcutChoice on RunnerShortcut {
  /// 0..3 for A..D, else null.
  int? get choiceIndex => switch (this) {
        RunnerShortcut.choiceA => 0,
        RunnerShortcut.choiceB => 1,
        RunnerShortcut.choiceC => 2,
        RunnerShortcut.choiceD => 3,
        _ => null,
      };
}

/// useKeyboardShortcuts.ts:58-64, verbatim (the help list).
const shortcutHelpRows = <({String keys, String action})>[
  (keys: '← / →', action: 'Previous / Next question'),
  (keys: 'A B C D', action: 'Select answer choice'),
  (keys: 'M', action: 'Mark for review'),
  (keys: 'R', action: 'Open question navigator'),
  (keys: '?', action: 'Show this help'),
];

/// The `e.key` switch of useKeyboardShortcuts.ts:39-49. [key] is a DOM `KeyboardEvent.key`
/// value — also what the content island forwards in `key` messages.
RunnerShortcut? shortcutForDomKey(String key) => switch (key) {
      'ArrowLeft' => RunnerShortcut.previous,
      'ArrowRight' => RunnerShortcut.next,
      'a' || 'A' => RunnerShortcut.choiceA,
      'b' || 'B' => RunnerShortcut.choiceB,
      'c' || 'C' => RunnerShortcut.choiceC,
      'd' || 'D' => RunnerShortcut.choiceD,
      'm' || 'M' => RunnerShortcut.mark,
      'r' || 'R' => RunnerShortcut.navigator,
      '?' => RunnerShortcut.help,
      _ => null,
    };

/// A Flutter key event → shortcut, applying the modifier rule. Repeats count, like keydown.
RunnerShortcut? shortcutForKeyEvent(KeyEvent event, {HardwareKeyboard? keyboard}) {
  if (event is KeyUpEvent) return null;
  final kb = keyboard ?? HardwareKeyboard.instance;
  if (kb.isControlPressed || kb.isAltPressed || kb.isMetaPressed) return null;
  final logical = event.logicalKey;
  if (logical == LogicalKeyboardKey.arrowLeft) return RunnerShortcut.previous;
  if (logical == LogicalKeyboardKey.arrowRight) return RunnerShortcut.next;
  final ch = event.character;
  if (ch != null && ch.isNotEmpty) return shortcutForDomKey(ch);
  // No character (some test paths / layouts): fall back to the physical letter keys.
  return switch (logical) {
    LogicalKeyboardKey.keyA => RunnerShortcut.choiceA,
    LogicalKeyboardKey.keyB => RunnerShortcut.choiceB,
    LogicalKeyboardKey.keyC => RunnerShortcut.choiceC,
    LogicalKeyboardKey.keyD => RunnerShortcut.choiceD,
    LogicalKeyboardKey.keyM => RunnerShortcut.mark,
    LogicalKeyboardKey.keyR => RunnerShortcut.navigator,
    LogicalKeyboardKey.question => RunnerShortcut.help,
    _ => null,
  };
}

/// Whether keyboard focus is in a text field (Notes, the report message) —
/// useKeyboardShortcuts.ts:15-20 `isTypingTarget`.
bool isTypingInTextField() {
  final ctx = FocusManager.instance.primaryFocus?.context;
  if (ctx == null) return false;
  if (ctx.widget is EditableText) return true;
  return ctx.findAncestorWidgetOfExactType<EditableText>() != null;
}

/// KeyboardShortcutsHelp.tsx — the modal (toggled with `?`).
class KeyboardShortcutsHelp extends StatelessWidget {
  const KeyboardShortcutsHelp({super.key, required this.onClose});

  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) => PointerSink(
        key: const ValueKey('help.scrim'),
        color: BluebookTokens.helpScrim,
        onTap: onClose,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: GestureDetector(
              onTap: () {}, // clicks inside the card do not close it (stopPropagation)
              child: Container(
                key: const ValueKey('help.card'),
                constraints: const BoxConstraints(maxWidth: BluebookTokens.helpMaxWidth),
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: TwColors.white,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: TwShadows.xl,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text('Keyboard shortcuts',
                                style: chromeText(18,
                                    weight: FontWeight.w700,
                                    color: TwColors.slate900,
                                    trackingEm: BluebookTokens.trackingTight,
                                    height: 28 / 18)),
                          ),
                          Pressable(
                            key: const ValueKey('help.close'),
                            semanticLabel: 'Close keyboard shortcuts',
                            onTap: onClose,
                            builder: (context, s) => LucideIcon(LucideGlyphs.x,
                                size: 20, color: s.hovered ? BluebookTokens.closeIconHover : BluebookTokens.closeIconColor),
                          ),
                        ],
                      ),
                    ),
                    for (var i = 0; i < shortcutHelpRows.length; i++) ...[
                      if (i > 0) const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: Text(shortcutHelpRows[i].action,
                                style: chromeText(14, color: TwColors.slate600, height: 20 / 14)),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: BluebookTokens.kbdBackground,
                              border: Border.all(color: BluebookTokens.kbdBorder),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(shortcutHelpRows[i].keys,
                                style: monoText(12, weight: FontWeight.w700, color: BluebookTokens.kbdColor, height: 16 / 12)),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      );
}
