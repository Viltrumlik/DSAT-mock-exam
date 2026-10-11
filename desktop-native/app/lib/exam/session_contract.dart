// The contract between the exam ENGINE (lib/exam/engine, implements ExamSession) and the
// runner UI (lib/exam/runner, renders an ExamSession). The runner never talks to the network,
// the store or the clock directly: everything it shows comes from here and every control
// calls one method here. FakeExamSession (fake_exam_session.dart) implements it in memory
// from the contract fixtures so the runner can be built and tested before the engine exists.
//
// Rules every implementation follows (the runner relies on them):
//  * State changes call notifyListeners(); the countdown is a separate ValueListenable so the
//    timer redraws once a second without rebuilding the runner.
//  * Answer/flag/eliminate actions are silently ignored while [ExamSession.inputLocked] or
//    when [ExamSession.phase] is not running/review — the runner need not guard them.
//  * Actions never wait on the network. Futures returned by pause/resume/saveAndExit/
//    reportProblem/submitModule complete quickly (bounded waits, e.g. Save & Exit ≤ 1.5 s).
//  * Eliminations are memory-only and reset per module (website draftStore rule).
import 'package:flutter/foundation.dart';

import '../core/models/models.dart';

/// Past paper or midterm.
enum ExamKind { pastpaper, midterm }

/// What the runner shows.
enum ExamPhase {
  /// Bundle/images still loading (first open only). The runner shows a progress state.
  loading,

  /// Welcome screen; the clock starts on [ExamSession.start] (website WelcomeScreen).
  welcome,

  /// Answering questions.
  running,

  /// Check Your Work page.
  review,

  /// Between modules ([ExamSession.transition] says which, and whether we wait on the server).
  transition,

  /// The final module was handed in; waiting for the outbox/result.
  submitting,

  /// Midterm boundary or finish while offline: "Reconnecting — answers saved on this computer".
  offlineWaiting,

  /// Finished ([ExamSession.doneReason]).
  done,
}

/// The quiet safety-copy indicator.
enum SyncStatus {
  /// Everything is on disk; some items are not on the server yet (normal while answering).
  savedLocally,

  /// A request is in flight.
  syncing,

  /// The server has everything.
  synced,

  /// No connection; items wait in the outbox.
  offline,
}

/// Why the sitting ended.
enum ExamDoneReason {
  /// The last module was handed in (by the student or at 0:00).
  submitted,

  /// Midterm: third off-screen strike.
  terminated,

  /// Past paper: Save & Exit.
  savedAndExited,
}

/// Shown during [ExamPhase.transition].
@immutable
class ModuleTransition {
  const ModuleTransition({required this.fromOrder, required this.toOrder, required this.waitingForServer});

  final int fromOrder;
  final int toOrder;

  /// Midterms: module 2 arrives with the submit response, sent at the server deadline.
  final bool waitingForServer;

  @override
  bool operator ==(Object other) =>
      other is ModuleTransition &&
      other.fromOrder == fromOrder &&
      other.toOrder == toOrder &&
      other.waitingForServer == waitingForServer;

  @override
  int get hashCode => Object.hash(fromOrder, toOrder, waitingForServer);
}

/// Midterm off-screen state (null for past papers and while no warning is due).
@immutable
class OffscreenStatus {
  const OffscreenStatus({required this.violations, required this.limit, this.graceRemaining, this.terminated = false});

  /// Strikes so far (server count + unacknowledged local events).
  final int violations;
  final int limit;

  /// Non-null while the "come back" countdown runs (3 s grace).
  final Duration? graceRemaining;
  final bool terminated;

  bool get countingDown => graceRemaining != null;

  @override
  bool operator ==(Object other) =>
      other is OffscreenStatus &&
      other.violations == violations &&
      other.limit == limit &&
      other.graceRemaining == graceRemaining &&
      other.terminated == terminated;

  @override
  int get hashCode => Object.hash(violations, limit, graceRemaining, terminated);
}

/// Transient messages for a toast/banner. [message] is the default English copy.
enum ExamNoticeKind {
  pauseNeedsConnection,
  reportSent,
  reportDeduped,
  reportQueued,
  reconnecting,
  reconnected,
  savedOffline,
  timeUp,
}

@immutable
class ExamNotice {
  const ExamNotice(this.kind, this.message);

  final ExamNoticeKind kind;
  final String message;

  static const pauseNeedsConnection = ExamNotice(
    ExamNoticeKind.pauseNeedsConnection,
    'Pause needs a connection — your answers are safe.',
  );
  static const reportSent = ExamNotice(ExamNoticeKind.reportSent, 'Thanks — your report was sent.');
  static const reportDeduped = ExamNotice(ExamNoticeKind.reportDeduped, 'You already reported this question. Thanks!');
  static const reportQueued = ExamNotice(
    ExamNoticeKind.reportQueued,
    'Your report is saved and will be sent when you are online.',
  );
  static const reconnecting = ExamNotice(ExamNoticeKind.reconnecting, 'Reconnecting — answers saved on this computer.');
  static const reconnected = ExamNotice(ExamNoticeKind.reconnected, 'Back online.');
  static const savedOffline = ExamNotice(
    ExamNoticeKind.savedOffline,
    "Your answers are saved on this computer and will be sent when you're online.",
  );
  static const timeUp = ExamNotice(ExamNoticeKind.timeUp, "Time's up for this module.");
}

/// Result of [ExamSession.reportProblem].
enum ReportOutcome { sent, deduped, queued }

/// Result of [ExamSession.saveAndExit].
@immutable
class SaveAndExitResult {
  const SaveAndExitResult({required this.pausedOnServer});

  /// False when offline (or the pause did not answer within 1.5 s): the timer keeps running
  /// on the server while away, and the runner should say so honestly.
  final bool pausedOnServer;
}

/// An image for the content island (`media.put`).
@immutable
class MediaBlob {
  const MediaBlob({required this.key, required this.mime, required this.bytes});

  final String key;
  final String mime;
  final Uint8List bytes;
}

/// Zoom range (website 0.8–1.6).
const double examMinZoom = 0.8;
const double examMaxZoom = 1.6;
const double examZoomStep = 0.1;

/// The website's grid-in rule (SprInput.tsx:59-63): `^[-0-9./]*$`, at most 5 characters.
bool isValidSprInput(String value) => value.length <= 5 && RegExp(r'^[-0-9./]*$').hasMatch(value);

/// "Reading and Writing" | "Math".
String subjectLabelFor(String subject) => subject == 'MATH' ? 'Math' : 'Reading and Writing';

/// The runner header title — the website's `moduleLabel` (state/selectors.ts:38-55):
///  * past paper: `Section 1, Module 2: Reading and Writing` (Math is Section 2);
///  * midterm: the midterm title (or `<Subject> Midterm`), plus ` — Module N` when it has
///    more than one module.
String examModuleTitle({
  required ExamKind kind,
  required String subject,
  required String testTitle,
  required int moduleOrder,
  required int moduleCount,
}) {
  final label = subjectLabelFor(subject);
  if (kind == ExamKind.midterm) {
    final base = testTitle.trim().isNotEmpty ? testTitle.trim() : '$label Midterm';
    return moduleCount > 1 ? '$base — Module $moduleOrder' : base;
  }
  final section = subject == 'MATH' ? 2 : 1;
  return 'Section $section, Module $moduleOrder: $label';
}

/// One sitting, as the runner sees it.
abstract class ExamSession extends ChangeNotifier {
  // ---- identity -----------------------------------------------------------------------------

  ExamKind get kind;
  int get attemptId;

  /// Footer name ("Aziza Karimova").
  String get studentName;
  TestInfo get test;

  /// Header title ([examModuleTitle]).
  String get title => examModuleTitle(
    kind: kind,
    subject: test.subject,
    testTitle: test.title,
    moduleOrder: moduleOrder,
    moduleCount: moduleCount,
  );

  String get subjectLabel => subjectLabelFor(test.subject);

  /// 1 = Reading and Writing, 2 = Math (the SAT section rail).
  int get sectionIndex => test.isMath ? 2 : 1;

  /// 1-based order of the live module.
  int get moduleOrder;
  int get moduleCount;
  int get moduleId;

  // ---- questions ----------------------------------------------------------------------------

  /// The live module's questions, in order (passed to the island unchanged).
  List<Question> get questions;

  /// 0-based index into [questions].
  int get currentIndex;
  Question get currentQuestion => questions[currentIndex];

  /// The current answer ("A".."D" or the grid-in text), null when unanswered.
  String? answerFor(int questionId);
  bool isFlagged(int questionId);
  bool isAnswered(int questionId) => (answerFor(questionId) ?? '').isNotEmpty;
  int get answeredCount => questions.where((q) => isAnswered(q.id)).length;

  /// Struck-out choices (memory only, reset per module).
  Set<String> eliminatedFor(int questionId);

  /// The ABC eliminator mode toggle.
  bool get eliminatorOn;

  /// Highlights/underlines per container for a question.
  Map<AnnotationContainer, List<Annotation>> annotationsFor(int questionId);

  // ---- tools and view -----------------------------------------------------------------------

  /// `calculatorAllowed` (every Math past paper; midterm only if `calculator_enabled`).
  bool get calculatorAllowed => test.tools.calculatorAllowed;

  /// Midterm `calculator_mode = scientific`: Desmos Scientific only.
  bool get scientificOnly => test.tools.scientificOnly;

  /// Past-paper Math only (never midterms).
  bool get referenceSheetAvailable => test.tools.referenceSheet && kind == ExamKind.pastpaper;

  bool get highlighterOn;

  /// [examMinZoom]..[examMaxZoom]; drives a CSS variable inside the island.
  double get zoom;

  /// R&W passage/question split as a fraction of the card width (0.25–0.75).
  double get split;

  /// The local-only notepad for this attempt (never sent).
  String get notes;

  /// Saved Desmos `getState()` JSON for this attempt (restored after a crash/resume).
  Object? get desmosState;

  // ---- time ---------------------------------------------------------------------------------

  /// Time left in the live module, ticking once a second (monotonic, server-anchored).
  ValueListenable<Duration> get remaining;
  bool get paused;

  /// Past papers only, online, while running.
  bool get canPause;

  /// Past papers only (hidden on midterms).
  bool get canSaveAndExit => kind == ExamKind.pastpaper;

  /// Past papers: Check Your Work has "Next Module"/"Submit". Midterms: no hand-in before 0:00.
  bool get canSubmitEarly => kind == ExamKind.pastpaper;

  // ---- status -------------------------------------------------------------------------------

  ExamPhase get phase;
  SyncStatus get syncStatus;
  bool get online;

  /// True at 0:00, during the transition, the off-screen countdown and Check Your Work.
  bool get inputLocked;

  /// Non-null during [ExamPhase.transition].
  ModuleTransition? get transition;

  /// Midterm off-screen warning state; always null for past papers.
  ValueListenable<OffscreenStatus?> get offscreen;

  /// Non-null once [phase] is [ExamPhase.done].
  ExamDoneReason? get doneReason;

  /// Toasts/banners.
  Stream<ExamNotice> get notices;

  // ---- media for the island -----------------------------------------------------------------

  /// Every image key the live module needs.
  Iterable<String> get moduleMediaKeys => questions.expand((q) => q.imageKeys).toSet();

  /// Bytes for one image (past papers: the sealed cache; midterms: memory). Null if missing.
  Future<MediaBlob?> media(String key);

  // ---- actions ------------------------------------------------------------------------------

  /// Welcome → running; starts the clock locally at once (the server call goes in the background).
  Future<void> start();

  /// Choose an answer ("A".."D") or set the grid-in text (validated with [isValidSprInput]).
  void select(int questionId, String value);
  void clearAnswer(int questionId);
  void toggleFlag(int questionId);
  void toggleEliminator();
  void toggleEliminate(int questionId, String choiceKey);

  /// Jump to a question (from the navigator or Check Your Work; review → running).
  void goTo(int index);

  /// Next question; on the last question opens Check Your Work.
  void next();

  /// Previous question (no-op on the first).
  void back();

  /// Open Check Your Work (navigator "Go to Review Page").
  void openReview();

  /// Hand in the live module (Check Your Work "Next Module"/"Submit"). Past papers move on at
  /// once (module 2 is cached); midterms ignore an early call ([canSubmitEarly] is false) —
  /// the engine submits at the server deadline itself.
  Future<void> submitModule();

  /// Past papers: pause on the server (optimistic freeze). Returns false (and emits
  /// [ExamNotice.pauseNeedsConnection]) when offline.
  Future<bool> pause();
  Future<void> resume();

  /// Past papers: pause (waits ≤ 1.5 s), flush, then the runner leaves for Home.
  Future<SaveAndExitResult> saveAndExit();

  /// Queue a question report (low-priority lane, idempotency key) — also on midterms.
  Future<ReportOutcome> reportProblem({
    required int questionId,
    required ReportCategory category,
    required String message,
  });

  void setZoom(double zoom);
  void setSplit(double split);
  void toggleHighlighter();

  /// Store the island's merged annotation list for (question, container); synced debounced.
  void recordAnnotations(int questionId, AnnotationContainer container, List<Annotation> annotations);
  void setNotes(String text);
  void saveDesmosState(Object? state);
}
