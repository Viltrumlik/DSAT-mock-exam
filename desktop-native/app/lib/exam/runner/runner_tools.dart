// The runner's UI-only state — the native counterpart of tools/useExamTools.ts plus the bits
// of ExamRunnerPage.tsx state that never reach the engine (Directions, the navigator, the
// More menu, timer Hide, the report dialog, the highlight toolbar, the 500 ms nav freeze).
// Nothing here is persisted or sent anywhere; the engine owns answers, zoom, notes, etc.
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/models/models.dart';
import '../tokens/bluebook_tokens.dart';

/// The Desmos panel's tabs (DesmosCalculator.tsx:17).
enum CalculatorTab { graphing, scientific }

/// What the highlight toolbar edits and where it hangs, in island CSS px (1 CSS px = 1
/// logical px). Built from an island `selection` (a new highlight) or `annot.click` (an
/// existing mark), mirroring useAnnotator's `AnnotatorToolbar` (x, top, bottom, current).
@immutable
class ToolbarRequest {
  const ToolbarRequest({
    required this.qid,
    required this.container,
    required this.x,
    required this.top,
    required this.bottom,
    this.selectionId,
    this.annotId,
    this.color,
    this.underline,
    this.text,
  }) : assert((selectionId == null) != (annotId == null), 'exactly one of selectionId / annotId');

  final int qid;
  final AnnotationContainer container;

  /// Horizontal centre of the selection and its top/bottom edges (island coordinates).
  final double x;
  final double top;
  final double bottom;

  /// The island's handle for the range: a fresh selection or an existing annotation.
  final String? selectionId;
  final String? annotId;

  /// Styles covering the whole range (drive the pressed swatch/underline buttons).
  final HighlightColor? color;
  final UnderlineStyle? underline;

  /// The selected text (≤ 500 chars) — pre-fills Notes from the toolbar's note button.
  final String? text;

  ToolbarRequest copyWith({HighlightColor? color, UnderlineStyle? underline}) => ToolbarRequest(
        qid: qid,
        container: container,
        x: x,
        top: top,
        bottom: bottom,
        selectionId: selectionId,
        annotId: annotId,
        color: color ?? this.color,
        underline: underline ?? this.underline,
        text: text,
      );
}

class RunnerTools extends ChangeNotifier {
  RunnerTools({this.navLockDuration = BluebookTokens.navLock});

  /// ExamRunnerPage.tsx:265-284 — Back/Next freeze after a move.
  final Duration navLockDuration;

  bool _disposed = false;

  // ---- floating tools (useExamTools.ts:21-27) ------------------------------------------------

  bool calculatorOpen = false;
  bool calculatorEnlarged = false;
  CalculatorTab calculatorTab = CalculatorTab.graphing;
  bool referenceOpen = false;
  bool notesOpen = false;
  bool helpOpen = false;

  // ---- runner page state ---------------------------------------------------------------------

  bool directionsOpen = false;
  bool navigatorOpen = false;
  bool moreOpen = false;
  bool timerHidden = false;
  bool reportOpen = false;

  /// The question the open report dialog is about (captured when it opened).
  int? reportQuestionId;
  int? reportQuestionNumber;

  ToolbarRequest? toolbar;

  /// The colour a new selection is painted with (useAnnotator's activeColorRef, default yellow).
  HighlightColor activeColor = HighlightColor.yellow;

  bool navLocked = false;
  Timer? _navTimer;

  void _set(VoidCallback change) {
    if (_disposed) return;
    change();
    notifyListeners();
  }

  /// useExamTools.ts:42-46 — every open/close starts at the normal size.
  void toggleCalculator() => _set(() {
        calculatorEnlarged = false;
        calculatorOpen = !calculatorOpen;
      });

  void toggleCalculatorEnlarge() => _set(() => calculatorEnlarged = !calculatorEnlarged);
  void setCalculatorTab(CalculatorTab tab) => _set(() => calculatorTab = tab);
  void toggleReference() => _set(() => referenceOpen = !referenceOpen);
  void toggleNotes() => _set(() => notesOpen = !notesOpen);
  void openNotes() => _set(() => notesOpen = true);
  void toggleHelp() => _set(() => helpOpen = !helpOpen);
  void closeHelp() => _set(() => helpOpen = false);
  void toggleDirections() => _set(() => directionsOpen = !directionsOpen);
  void closeDirections() => _set(() => directionsOpen = false);
  void toggleNavigator() => _set(() => navigatorOpen = !navigatorOpen);
  void closeNavigator() => _set(() => navigatorOpen = false);
  void toggleMore() => _set(() => moreOpen = !moreOpen);
  void closeMore() => _set(() => moreOpen = false);
  void toggleTimerHidden() => _set(() => timerHidden = !timerHidden);

  void openReport({required int questionId, required int questionNumber}) => _set(() {
        reportOpen = true;
        reportQuestionId = questionId;
        reportQuestionNumber = questionNumber;
      });

  void closeReport() => _set(() => reportOpen = false);

  void showToolbar(ToolbarRequest request) => _set(() => toolbar = request);
  void updateToolbar(ToolbarRequest request) => _set(() => toolbar = request);
  void dismissToolbar() {
    if (toolbar != null) _set(() => toolbar = null);
  }

  void setActiveColor(HighlightColor color) => _set(() => activeColor = color);

  /// Closes everything that hangs over the question card (used when a full screen such as
  /// Check Your Work replaces the frame, and on module change).
  void closeTransient() => _set(() {
        navigatorOpen = false;
        moreOpen = false;
        directionsOpen = false;
        toolbar = null;
      });

  /// Runs [move] unless navigation is frozen, then freezes it for [navLockDuration]
  /// (withNavLock, ExamRunnerPage.tsx:270-280). Returns whether [move] ran.
  bool withNavLock(VoidCallback move) {
    if (navLocked || _disposed) return false;
    move();
    _set(() => navLocked = true);
    _navTimer?.cancel();
    _navTimer = Timer(navLockDuration, () => _set(() => navLocked = false));
    return true;
  }

  /// A one-line fingerprint of the state (tests: "did this button change anything?").
  String get fingerprint => [
        calculatorOpen,
        calculatorEnlarged,
        calculatorTab.name,
        referenceOpen,
        notesOpen,
        helpOpen,
        directionsOpen,
        navigatorOpen,
        moreOpen,
        timerHidden,
        reportOpen,
        toolbar == null ? '-' : '${toolbar!.selectionId ?? toolbar!.annotId}:${toolbar!.color}:${toolbar!.underline}',
        activeColor.name,
      ].join('|');

  @override
  void dispose() {
    _disposed = true;
    _navTimer?.cancel();
    super.dispose();
  }
}
