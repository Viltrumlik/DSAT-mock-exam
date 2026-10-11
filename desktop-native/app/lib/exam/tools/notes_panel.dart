// Port of tools/notes/NotesPanel.tsx: the scratch-notes pad in a floating panel. Local only —
// the text lives in the engine's per-attempt notes (ExamSession.notes / setNotes, the `notes`
// table) and is never sent anywhere.
import 'package:flutter/material.dart' show Material, MaterialType, TextField, InputDecoration, InputBorder;
import 'package:flutter/widgets.dart';

import '../runner/runner_style.dart';
import '../session_contract.dart';
import '../tokens/bluebook_tokens.dart';
import 'floating_panel.dart';

const notesPlaceholder = 'Scratch notes (saved locally on this device, never submitted)…';

class NotesPanel extends StatefulWidget {
  const NotesPanel({super.key, required this.session, required this.onClose, this.focusNode, this.docked = false});

  final ExamSession session;
  final VoidCallback onClose;
  final FocusNode? focusNode;

  /// Docked beside the question card (windowed fallback) instead of floating.
  final bool docked;

  @override
  State<NotesPanel> createState() => NotesPanelState();
}

class NotesPanelState extends State<NotesPanel> {
  late final TextEditingController _controller = TextEditingController(text: widget.session.notes);
  late final FocusNode _focus = widget.focusNode ?? FocusNode(debugLabel: 'notes');
  bool _focused = false;

  TextEditingController get controller => _controller;

  @override
  void initState() {
    super.initState();
    _focus.addListener(_onFocus);
    widget.session.addListener(_onSession);
  }

  void _onFocus() => setState(() => _focused = _focus.hasFocus);

  /// Text appended from outside (the highlight toolbar's note button).
  void _onSession() {
    final text = widget.session.notes;
    if (text != _controller.text) {
      _controller.value = TextEditingValue(
        text: text,
        selection: TextSelection.collapsed(offset: text.length),
      );
    }
  }

  @override
  void dispose() {
    widget.session.removeListener(_onSession);
    _focus.removeListener(_onFocus);
    if (widget.focusNode == null) _focus.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FloatingPanel(
    panelKey: const ValueKey('panel.notes'),
    docked: widget.docked,
    title: 'Notes',
    onClose: widget.onClose,
    initial: BluebookTokens.notesRect,
    minSize: BluebookTokens.notesMin,
    child: Padding(
      padding: const EdgeInsets.all(12),
      // NotesPanel.tsx:29 `h-full w-full resize-none rounded-lg border border-slate-200 p-3
      // text-sm leading-relaxed text-slate-800 outline-none focus:border-blue-500`.
      child: Container(
        decoration: BoxDecoration(
          border: Border.all(color: _focused ? BluebookTokens.notesFocusBorder : BluebookTokens.notesBorder),
          borderRadius: BorderRadius.circular(8),
        ),
        padding: const EdgeInsets.all(11), // p-3 minus the 1 px border
        child: Material(
          type: MaterialType.transparency,
          child: TextField(
            key: const ValueKey('notes.field'),
            controller: _controller,
            focusNode: _focus,
            expands: true,
            maxLines: null,
            minLines: null,
            textAlignVertical: TextAlignVertical.top,
            keyboardType: TextInputType.multiline,
            // No browser habits: no right-click menu.
            contextMenuBuilder: null,
            cursorColor: BluebookTokens.notesColor,
            cursorWidth: 1,
            style: chromeText(14, color: BluebookTokens.notesColor, height: 1.625),
            decoration: InputDecoration(
              isCollapsed: true,
              border: InputBorder.none,
              hintText: notesPlaceholder,
              hintMaxLines: 3,
              // Tailwind v4 placeholder: currentColor at 50%.
              hintStyle: chromeText(14, color: BluebookTokens.notesColor.withValues(alpha: 0.5), height: 1.625),
            ),
            onChanged: widget.session.setNotes,
          ),
        ),
      ),
    ),
  );
}
