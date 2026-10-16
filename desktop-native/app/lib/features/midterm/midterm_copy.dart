// Every student-facing line of the midterm flow, ported word for word from the website
// (frontend/src/features/testing-simulation/components: MidtermRulesScreen, MidtermCodeScreen,
// OffscreenWarning, DesktopScreens, DesktopBattery; features/desktop/DesktopDone) and from the
// 0.1.0 app (desktop/app/src/exam/midterm + lockdown). Lines the app adds are marked NATIVE.
//
// The numbers (grace, limit, pass mark) mirror backend/midterms/proctoring.py and outcomes.py
// as lib/midtermRules.ts does; the server's live values win whenever it sends them.
import '../../core/api/v1_api.dart';
import '../../exam/engine/lockdown_controller.dart';
import '../../exam/engine/midterm_engine.dart';
import '../../native/native_bridge.dart';

/// The server's defaults (backend/midterms/proctoring.py).
const int midtermOffscreenGraceSeconds = 3;
const int midtermOffscreenViolationLimit = 3;

/// A blank 800-scale paper still scores 200, so both scales share one rule: half the questions.
const double midtermDefaultPassFraction = 0.5;

/// Offences left before the sitting is forfeited.
int offscreenChancesLeft(int violations, [int limit = midtermOffscreenViolationLimit]) {
  final left = limit - (violations < 0 ? 0 : violations);
  return left < 0 ? 0 : left;
}

/// "2 chances left" / "1 chance left" / "no chances left".
String offscreenChancesLabel(int violations, [int limit = midtermOffscreenViolationLimit]) {
  final left = offscreenChancesLeft(violations, limit);
  if (left == 0) return 'no chances left';
  return '$left ${left == 1 ? 'chance' : 'chances'} left';
}

/// The warning's pill: "2 chances left" / "No chances left".
String offscreenChancesPill(int chancesLeft) =>
    chancesLeft <= 0 ? 'No chances left' : '$chancesLeft ${chancesLeft == 1 ? 'chance' : 'chances'} left';

(int, int) midtermScaleBounds(String? scoringScale) => switch (scoringScale) {
      'SCALE_800' => (200, 800),
      _ => (0, 100),
    };

int midtermPassMark(String? scoringScale, [int? passMark]) {
  if (passMark != null) return passMark;
  final (floor, ceiling) = midtermScaleBounds(scoringScale);
  return (floor + midtermDefaultPassFraction * (ceiling - floor)).round();
}

/// "500 out of 800" — how the pass mark is quoted to a student.
String midtermPassMarkLabel(String? scoringScale, [int? passMark]) {
  final (_, ceiling) = midtermScaleBounds(scoringScale);
  return '${midtermPassMark(scoringScale, passMark)} out of $ceiling';
}

abstract final class MidtermCopy {
  // ---- rules ----------------------------------------------------------------------------
  static const rulesEyebrow = 'Midterm';
  static String rulesLead(String subjectLabel) =>
      'Read the rules below, then continue to start your $subjectLabel midterm.';
  static const time = 'Time';
  static const questions = 'Questions';
  static const toPass = 'To pass';
  static const required = 'Required';
  static const allowed = 'Allowed';
  static const prohibited = 'Prohibited';
  static const requiredCode =
      "The 6-digit access code from your teacher — you'll enter it right before you start.";
  static const requiredDevice = 'A fully charged device that stays on for the whole test — roughly 1–2 hours.';
  static const requiredInternet = 'A stable internet connection. Your answers save automatically as you go.';
  static const allowedPaper = 'Blank scratch paper and a pen or pencil for your working.';
  static const allowedFlag = 'Flagging questions to review and return to them before time runs out.';
  static const allowedCalculator =
      'The built-in Desmos calculator, opened from the toolbar. No physical calculator.';
  static const allowedScientific =
      'The built-in Desmos scientific calculator, opened from the toolbar. No physical calculator.';
  /// BY_HAND (MidtermRulesScreen.tsx, 2026-10-11): FIRST under Prohibited on a Math paper with
  /// no calculator (Foundation Math, or an untagged Math midterm). R&W gets no calculator line.
  static const prohibitedCalculatorByHand =
      'Any calculator, built-in or physical — this paper is worked out by hand, on your scratch paper.';
  static const prohibitedApps = 'Other apps, browser tabs, or programs — close everything else before you begin.';
  static const prohibitedNotes = 'Notes, books, or any other reference material.';
  static const prohibitedDevices = 'Phones, smartwatches, headphones, or earbuds.';
  static const prohibitedRecording = 'Any camera, screen recorder, or recording device.';

  /// The one prohibition the software enforces, stated in full.
  static String prohibitedLeaving({int grace = midtermOffscreenGraceSeconds, int limit = midtermOffscreenViolationLimit}) =>
      'Leaving full screen or switching to another window. You get $grace seconds '
      'to come back, and only ${limit - 1} warnings — the '
      '${limit == 3 ? 'third' : '${limit}th'} time, '
      'your paper is submitted immediately.';

  static const timerRuleLead = 'The timer starts as soon as you begin and ';
  static const timerRuleStrong = 'cannot be paused or reset';
  static const timerRuleTail = ". You can't submit early — the midterm submits itself when time runs out.";

  static const offscreenRuleLead = 'If you leave the exam window you have ';
  static String offscreenRuleStrong(int grace) => '$grace seconds';
  static String offscreenRuleMiddle(int limit) => ' to return. It can happen ${limit - 1} times; on the next one your paper is';
  static const offscreenRuleStrong2 = ' submitted immediately';
  static const offscreenRuleTail = ', however much time is left.';

  static const retakeLead = 'This is your ';
  static const retakeStrong = 'retake';
  static const retakeTail =
      " — it is offered because you didn't reach the pass mark first time. You sit a midterm once; there is no retake of a retake.";
  static const passLead = 'You need ';
  static const passTail = ' to pass. ';
  static const passUnknown = "You need to reach this midterm's pass mark. ";
  static const sitOnce = 'You sit this midterm once — if you miss it, your teacher can open a retake for you.';
  static const ready = "I'm ready — continue";

  // ---- code -----------------------------------------------------------------------------
  static const codeTitle = 'Enter your access code';
  static const codeLead = 'Your teacher will read out a 6-digit code. Enter it below to start the midterm.';
  static const codeWrong = "That code isn't right. Ask your teacher for the current code.";
  static const codeVerify = 'Verify & begin';
  static const codeStarting = 'Starting…';
  static const backToRules = 'Back to rules';

  /// NATIVE: the code could not be checked (no answer from the server).
  static const codeNetwork = "That didn't go through. Check your internet connection and try again.";

  // ---- pre-check ------------------------------------------------------------------------
  static const precheckTitle = 'Get this computer ready';
  static const precheckResumeTitle = 'Resume your midterm';
  static const precheckLead =
      'When you continue, MasterSAT locks this computer until your midterm ends. Only MasterSAT '
      'stays open: every other app must be closed, and notifications, screenshots and copying '
      'are turned off.';
  static const checking = 'Checking this computer…';
  static const oneScreen = 'One screen';
  static String screensConnected(int n) => '$n screens connected';
  static const disconnectScreen = 'Disconnect the second monitor or projector.';
  static const remoteTitle = 'Remote Desktop session';
  static const remoteHint = 'Take the midterm on this computer itself, not over Remote Desktop.';
  static const vmTitle = 'Virtual machine';
  static const vmHint = "Midterms can't be taken inside a virtual machine.";
  static const noApps = 'No chat or screen-sharing apps open';
  static const noOtherApps = 'No other apps open';
  static String closeApp(String name) => 'Close $name';
  static String closeFromTray(String name) => 'Close $name from the system tray, then come back.';
  static const close = 'Close';
  static const closing = 'Closing…';
  static String battery(int? percent, {required bool charging}) =>
      charging ? 'Battery ${percent ?? '—'}%, charging' : 'Battery ${percent ?? '—'}%';
  static const plugIn = 'Plug in your charger before you start.';
  static const lockAndStart = 'Lock and start';
  static const lockAndResume = 'Lock and resume';
  static const locking = 'Locking…';
  static const back = 'Back';
  static const cannotCheck = 'This computer could not be checked. Close the MasterSAT app and open it again.';
  static const proofInvalid = 'The app could not prove it is locked down. Restart the MasterSAT app and try again.';
  static const network = "That didn't go through. Check your internet connection and try again.";

  /// NATIVE: the lock itself failed (Windows refused) — never "check your connection".
  static const lockFailed = "This computer couldn't be locked. Close the MasterSAT app and open it again.";
  static const desktopRequired = 'This midterm can only be taken in the MasterSAT app for Windows.';

  /// NATIVE: the server's challenge expired before the proof arrived.
  static const challengeExpired = 'That took too long. Try again.';

  // ---- status ---------------------------------------------------------------------------
  static const opening = 'Opening your midterm…';
  static const checkingMidterm = 'Checking your midterm…';
  static const openFailedTitle = 'This midterm couldn’t be opened';
  static const openFailedBody = 'Check your connection and try again. Anything you’ve answered is saved.';
  static const notOpenTitle = 'This midterm isn’t open right now';
  static const notOpenBody = 'It may have ended or not begun yet. Anything you answered is saved.';
  static const tryAgain = 'Try again';
  static const backToTests = 'Back to my tests';

  /// NATIVE: between modules, while the server hands Module 2 over.
  static String continuingTo(int order) => 'Continuing to Module $order';

  /// NATIVE: the module boundary passed with no connection.
  static const waitingForConnection =
      'Waiting for the connection — your answers are saved on this computer and will be sent the moment it is back.';

  /// NATIVE: the final hand-in is on its way.
  static const handingIn = 'Handing in your midterm…';

  static const sessionMovedTitle = 'This midterm was opened in another window';
  static const sessionMovedBody = 'Your answers are saved. Continue in the MasterSAT window where it is open now.';

  static const updateTitle = 'Update the MasterSAT app';

  /// NATIVE (the website says "close the app and open it again"): the app updates in one click.
  static const updateBody =
      "This version can't start midterms any more. Update the MasterSAT app and open it again — your work is saved.";
  static const updateNow = 'Update now';
  static String updating(int percent) => 'Updating… $percent%';
  static const updateFailed = "The update didn't download. Check your internet connection, or download the app instead.";
  static const downloadForWindows = 'Download for Windows';

  // ---- off-screen -----------------------------------------------------------------------
  static const comeBackTitle = 'Come back to your exam';
  static const comeBackBody =
      'You left the exam window. Midterms are proctored — return now or your paper will be taken in and '
      'submitted as it stands.';
  static String secondsToReturn(int s) => '${s == 1 ? 'second' : 'seconds'} to return';
  static const gotIt = 'Got it';
  static const terminatedTitle = 'Your exam was submitted';
  static const terminatedBody =
      'You left the exam window too many times, so your midterm was taken in and graded as it stood. Your '
      'answers up to that point were all saved.';
  static const seeResult = 'See your result';

  // ---- battery + connection -------------------------------------------------------------
  static String lowBattery(int? percent) => 'Your battery is low ($percent%). Plug in your device.';
  static const dismissBattery = 'Dismiss battery warning';
  static const reconnecting =
      'Reconnecting… Keep working — your answers will save as soon as the connection is back.';

  // ---- done -----------------------------------------------------------------------------
  static const finished = "You're all finished!";
  static const scoring = 'Scoring your answers…';
  static const resultFailed = 'Your answers are saved, but the result could not be loaded. Check your internet connection.';
  static const yourScore = 'Your score';
  static const awaitingRelease =
      "Your answers are in. Your teacher will release the result — you'll see it here and on the website.";
  static const openReport = 'Open the full report';
}

/// The pre-check's lines that name the paper. Midterms use [midterm] (the website's words); a
/// past paper locks the same way since 0.2.4 and says "test" where a midterm is named ([test]).
/// Every other line of the screen is shared.
class PrecheckCopy {
  const PrecheckCopy({
    required this.title,
    required this.resumeTitle,
    required this.lead,
    required this.remoteHint,
    required this.vmHint,
    required this.back,
  });

  final String title;
  final String resumeTitle;
  final String lead;
  final String remoteHint;
  final String vmHint;

  /// The link under the button.
  final String back;

  static const midterm = PrecheckCopy(
    title: MidtermCopy.precheckTitle,
    resumeTitle: MidtermCopy.precheckResumeTitle,
    lead: MidtermCopy.precheckLead,
    remoteHint: MidtermCopy.remoteHint,
    vmHint: MidtermCopy.vmHint,
    back: MidtermCopy.back,
  );

  /// NATIVE (0.2.4): a past paper. The midterm's words with "test" for "midterm"; Back leaves
  /// the paper, so it says where it goes (as the sitting's other screens do).
  static const test = PrecheckCopy(
    title: MidtermCopy.precheckTitle,
    resumeTitle: 'Resume your test',
    lead:
        'When you continue, MasterSAT locks this computer until your test ends. Other apps, '
        'notifications, screenshots and copying are turned off.',
    remoteHint: 'Take the test on this computer itself, not over Remote Desktop.',
    vmHint: "Tests can't be taken inside a virtual machine.",
    back: 'Back to Home',
  );
}

/// What to say under the pre-check when "Lock and start/resume" fails.
String precheckErrorText(Object e) {
  if (e is ProofRefused) return MidtermCopy.proofInvalid;
  if (e is NativeBridgeException) return MidtermCopy.lockFailed;
  if (e is MidtermBlocked) {
    final detail = e.detail;
    if (detail != null && detail.trim().isNotEmpty) return detail;
    return switch (e.reason) {
      MidtermBlockReason.proofInvalid => MidtermCopy.proofInvalid,
      MidtermBlockReason.challengeInvalid => MidtermCopy.challengeExpired,
      MidtermBlockReason.lockLost => MidtermCopy.lockFailed,
      MidtermBlockReason.desktopRequired => MidtermCopy.desktopRequired,
      MidtermBlockReason.sessionReplaced => MidtermCopy.sessionMovedTitle,
      MidtermBlockReason.updateRequired => MidtermCopy.updateTitle,
      MidtermBlockReason.notLive => MidtermCopy.notOpenBody,
    };
  }
  if (e is ApiException && e.isTransient) return MidtermCopy.network;
  if (e is ApiError) {
    final detail = e.body.detail;
    if (detail != null && detail.trim().isNotEmpty) return detail;
  }
  return MidtermCopy.network;
}
