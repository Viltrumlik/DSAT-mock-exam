// Port of features/question-reports/ReportProblemModal.tsx (and the components/ui Modal,
// Field, Select, Textarea and Button it is built from): "Report a problem" for the current
// question. The report goes out through an injected [ReportSubmitter] — the integrator wires
// it to `POST /api/question-reports/reports/ {system:"exam", question_id, category, message,
// attempt_id}` (low-priority lane, idempotency key); the runner's default hands it to
// ExamSession.reportProblem.
//
// App addition (architecture §2.8 "Report a problem"): when it opens, the student's current
// selection in the question (if any) pre-fills the details as a quote they can edit.
import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart' show InputBorder, InputDecoration, Material, MaterialType, TextField;
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../../core/api/v1_api.dart';
import '../../core/models/models.dart';
import '../runner/icons/lucide_glyphs.dart';
import '../runner/icons/lucide_icon.dart';
import '../runner/runner_style.dart';
import '../session_contract.dart';
import '../tokens/bluebook_tokens.dart';

/// Sends one report. Throws on failure (the dialog stays open and says so).
typedef ReportSubmitter = Future<ReportOutcome> Function(QuestionReportRequest request);

/// frontend/src/lib/questionReportApi.ts:34-40, verbatim.
const reportCategoryLabels = <ReportCategory, String>{
  ReportCategory.wrongAnswer: 'Wrong / no correct answer',
  ReportCategory.answerKey: 'Answer key looks wrong',
  ReportCategory.typoUnclear: 'Typo / unclear wording',
  ReportCategory.imageFigure: 'Image / figure problem',
  ReportCategory.other: 'Something else',
};

/// ReportProblemModal.tsx:65-70 (+ the app's offline queue).
String reportOutcomeMessage(ReportOutcome outcome) => switch (outcome) {
  ReportOutcome.sent => 'Thanks! Your report was sent to our team.',
  ReportOutcome.deduped => "You've already reported this question — thanks!",
  ReportOutcome.queued => ExamNotice.reportQueued.message,
};

/// The error toast text for a failed send.
String reportErrorMessage(Object error) {
  if (error is ApiError) {
    final detail = error.body.detail;
    if (detail != null && detail.trim().isNotEmpty) return detail;
  }
  return "We couldn't send your report just now. Please try again.";
}

class ReportProblemDialog extends StatefulWidget {
  const ReportProblemDialog({
    super.key,
    required this.questionId,
    required this.questionNumber,
    required this.attemptId,
    required this.submit,
    required this.onClose,
    required this.onToast,
    this.prefill,
  });

  final int questionId;

  /// 1-based number shown to the student (the dialog subtitle).
  final int? questionNumber;
  final int attemptId;
  final ReportSubmitter submit;
  final VoidCallback onClose;

  /// Shows a toast (`error: true` for the red tone).
  final void Function(String message, {bool error}) onToast;

  /// The student's current selection in the question, if any.
  final Future<String?> Function()? prefill;

  @override
  State<ReportProblemDialog> createState() => ReportProblemDialogState();
}

class ReportProblemDialogState extends State<ReportProblemDialog> {
  ReportCategory _category = ReportCategory.wrongAnswer;
  final TextEditingController _message = TextEditingController();
  final FocusNode _messageFocus = FocusNode(debugLabel: 'report.message');
  final FocusScopeNode _scope = FocusScopeNode(debugLabel: 'report.dialog');
  bool _submitting = false;
  bool _messageFocused = false;
  bool _menuOpen = false;
  final LayerLink _selectLink = LayerLink();

  ReportCategory get category => _category;
  bool get submitting => _submitting;
  TextEditingController get message => _message;

  @override
  void initState() {
    super.initState();
    _messageFocus.addListener(() => setState(() => _messageFocused = _messageFocus.hasFocus));
    final prefill = widget.prefill;
    if (prefill != null) {
      unawaited(
        prefill().then((text) {
          final t = text?.trim() ?? '';
          if (!mounted || t.isEmpty || _message.text.isNotEmpty) return;
          _message.text = '"$t"\n';
          _message.selection = TextSelection.collapsed(offset: _message.text.length);
        }),
      );
    }
  }

  @override
  void dispose() {
    _message.dispose();
    _messageFocus.dispose();
    _scope.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_submitting) return;
    setState(() => _submitting = true);
    try {
      final outcome = await widget.submit(
        QuestionReportRequest(
          system: 'exam',
          questionId: widget.questionId,
          category: _category,
          message: _message.text.trim(),
          attemptId: widget.attemptId,
        ),
      );
      widget.onToast(reportOutcomeMessage(outcome));
      widget.onClose();
    } on Object catch (e) {
      widget.onToast(reportErrorMessage(e), error: true);
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _close() {
    if (_submitting) return;
    widget.onClose();
  }

  Widget _label(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(
      text,
      style: uiText(14, weight: FontWeight.w600, height: 20 / 14),
    ),
  );

  Widget _select() => CompositedTransformTarget(
    link: _selectLink,
    child: Pressable(
      key: const ValueKey('report.category'),
      semanticLabel: "What's the issue?",
      onTap: _submitting ? null : () => setState(() => _menuOpen = !_menuOpen),
      builder: (context, s) => Container(
        height: BluebookTokens.controlHeight,
        padding: const EdgeInsets.only(left: 14, right: 12),
        decoration: BoxDecoration(
          color: BluebookTokens.fieldBackground,
          border: Border.all(color: _menuOpen || s.focused ? BluebookTokens.brandPrimary : BluebookTokens.dialogBorder),
          borderRadius: BorderRadius.circular(BluebookTokens.controlRadius),
          boxShadow: _menuOpen || s.focused
              ? const [BoxShadow(color: BluebookTokens.brandPrimarySoft, spreadRadius: 3)]
              : BluebookTokens.fieldShadow,
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                reportCategoryLabels[_category]!,
                key: const ValueKey('report.category.value'),
                style: uiText(14, height: 20 / 14),
              ),
            ),
            const LucideIcon(LucideGlyphs.chevronDown, size: 16, color: BluebookTokens.textLabel),
          ],
        ),
      ),
    ),
  );

  Widget _menu() => CompositedTransformFollower(
    link: _selectLink,
    targetAnchor: Alignment.bottomLeft,
    followerAnchor: Alignment.topLeft,
    offset: const Offset(0, 4),
    child: Align(
      alignment: Alignment.topLeft,
      child: Container(
        key: const ValueKey('report.category.menu'),
        width: 384 - 40 - 2,
        padding: const EdgeInsets.symmetric(vertical: 4),
        decoration: BoxDecoration(
          color: TwColors.white,
          border: Border.all(color: TwColors.slate300),
          borderRadius: BorderRadius.circular(8),
          boxShadow: TwShadows.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final c in ReportCategory.values)
              Pressable(
                key: ValueKey('report.category.${c.wire}'),
                semanticLabel: reportCategoryLabels[c],
                selected: c == _category,
                onTap: () => setState(() {
                  _category = c;
                  _menuOpen = false;
                }),
                builder: (context, s) => Container(
                  color: s.hovered ? TwColors.slate100 : null,
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                  child: Text(
                    reportCategoryLabels[c]!,
                    style: uiText(
                      14,
                      height: 20 / 14,
                      weight: c == _category ? FontWeight.w600 : FontWeight.w400,
                      color: c == _category ? BluebookTokens.brandPrimary : BluebookTokens.textPrimary,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    ),
  );

  Widget _button({
    required Key key,
    required String label,
    required VoidCallback? onTap,
    required bool primary,
    bool loading = false,
  }) => Pressable(
    key: key,
    semanticLabel: label,
    enabled: onTap != null,
    onTap: onTap,
    builder: (context, s) {
      final disabled = !s.enabled;
      final Color bg;
      final Color fg;
      if (primary) {
        bg = s.hovered ? BluebookTokens.brandPrimaryHover : BluebookTokens.brandPrimary;
        fg = TwColors.white;
      } else {
        bg = s.hovered ? BluebookTokens.ghostHover : const Color(0x00000000);
        fg = s.hovered ? BluebookTokens.textPrimary : BluebookTokens.textSecondary;
      }
      return Opacity(
        opacity: disabled ? 0.5 : 1,
        child: Container(
          height: BluebookTokens.controlHeight,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(BluebookTokens.controlRadius),
            boxShadow: primary ? BluebookTokens.brandButtonShadow : null,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (loading) ...[
                BorderSpinner(size: 18, stroke: 2.5 * 18 / 24, track: fg.withValues(alpha: 0.2), arc: fg),
                const SizedBox(width: 8),
              ],
              Text(
                label,
                style: uiText(14, weight: FontWeight.w600, color: fg, height: 20 / 14),
              ),
            ],
          ),
        ),
      );
    },
  );

  @override
  Widget build(BuildContext context) {
    final description = widget.questionNumber != null
        ? 'Question ${widget.questionNumber} — tell us what looks wrong.'
        : 'Tell us what looks wrong with this question.';
    final card = Container(
      key: const ValueKey('report.card'),
      constraints: const BoxConstraints(maxWidth: BluebookTokens.dialogMaxWidth),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: TwColors.white,
        border: Border.all(color: BluebookTokens.dialogBorder),
        borderRadius: BorderRadius.circular(BluebookTokens.dialogRadius),
        boxShadow: BluebookTokens.dialogShadow,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Modal.tsx:83-102 — header.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: BluebookTokens.dialogBorder)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Report a problem',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: uiText(
                          BluebookTokens.dialogTitleSize,
                          weight: FontWeight.w600,
                          height: 1.3,
                          trackingEm: BluebookTokens.dialogTitleTracking,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        description,
                        key: const ValueKey('report.description'),
                        style: uiText(14, color: BluebookTokens.textSecondary, height: 20 / 14),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                Transform.translate(
                  offset: const Offset(6, -6), // -m-1.5
                  child: Pressable(
                    key: const ValueKey('report.close'),
                    semanticLabel: 'Close',
                    onTap: _close,
                    builder: (context, s) => Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: s.hovered ? BluebookTokens.ghostHover : null,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: LucideIcon(
                        LucideGlyphs.x,
                        size: 20,
                        color: s.hovered ? BluebookTokens.textPrimary : BluebookTokens.textSecondary,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Body (ReportProblemModal.tsx:101-123).
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _label("What's the issue?"),
                _select(),
                const SizedBox(height: 16),
                _label('Details (optional)'),
                Container(
                  height: 4 * 20 + 20 + 2, // rows=4 × 20 px + py-2.5 + border
                  padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 9),
                  decoration: BoxDecoration(
                    color: BluebookTokens.fieldBackground,
                    border: Border.all(
                      color: _messageFocused ? BluebookTokens.brandPrimary : BluebookTokens.dialogBorder,
                    ),
                    borderRadius: BorderRadius.circular(BluebookTokens.controlRadius),
                    boxShadow: _messageFocused
                        ? const [BoxShadow(color: BluebookTokens.brandPrimarySoft, spreadRadius: 3)]
                        : BluebookTokens.fieldShadow,
                  ),
                  child: Material(
                    type: MaterialType.transparency,
                    child: TextField(
                      key: const ValueKey('report.message'),
                      controller: _message,
                      focusNode: _messageFocus,
                      enabled: !_submitting,
                      expands: true,
                      maxLines: null,
                      minLines: null,
                      maxLength: 2000,
                      maxLengthEnforcement: MaxLengthEnforcement.enforced,
                      buildCounter: (context, {required currentLength, required isFocused, maxLength}) => null,
                      textAlignVertical: TextAlignVertical.top,
                      keyboardType: TextInputType.multiline,
                      contextMenuBuilder: null,
                      cursorColor: BluebookTokens.textPrimary,
                      cursorWidth: 1,
                      style: uiText(14, height: 20 / 14),
                      decoration: InputDecoration(
                        isCollapsed: true,
                        border: InputBorder.none,
                        hintText: 'e.g. The correct answer should be B, not C.',
                        hintStyle: uiText(14, color: BluebookTokens.textLabel, height: 20 / 14),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Anything that helps us find and fix it.',
                  style: uiText(13, color: BluebookTokens.textSecondary, height: 1.5),
                ),
              ],
            ),
          ),
          // Modal.tsx:105-109 — footer.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            decoration: const BoxDecoration(
              color: BluebookTokens.dialogFooterBackground,
              border: Border(top: BorderSide(color: BluebookTokens.dialogBorder)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                _button(
                  key: const ValueKey('report.cancel'),
                  label: 'Cancel',
                  primary: false,
                  onTap: _submitting ? null : _close,
                ),
                const SizedBox(width: 12),
                _button(
                  key: const ValueKey('report.send'),
                  label: 'Send report',
                  primary: true,
                  loading: _submitting,
                  onTap: _submitting ? null : _send,
                ),
              ],
            ),
          ),
        ],
      ),
    );

    return FocusScope(
      node: _scope,
      autofocus: true,
      child: CallbackShortcuts(
        bindings: {const SingleActivator(LogicalKeyboardKey.escape): _close},
        child: Stack(
          children: [
            // Modal.tsx:69-73 — scrim with a 2 px backdrop blur; a click closes.
            Positioned.fill(
              child: BackdropFilter(
                filter: ui.ImageFilter.blur(sigmaX: 2, sigmaY: 2),
                child: PointerSink(
                  key: const ValueKey('report.scrim'),
                  color: BluebookTokens.dialogScrim,
                  onTap: _close,
                ),
              ),
            ),
            Positioned.fill(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: GestureDetector(
                    onTap: () {
                      if (_menuOpen) setState(() => _menuOpen = false);
                    },
                    child: card,
                  ),
                ),
              ),
            ),
            if (_menuOpen) _menu(),
          ],
        ),
      ),
    );
  }
}
