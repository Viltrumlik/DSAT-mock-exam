// The exam runner's public surface for the integrator (app shell, exam engine, midterm flow).
//
//   ExamRunnerScreen(
//     key: ValueKey(session.attemptId),           // one screen per sitting
//     session: engineSession,                     // lib/exam/engine (implements ExamSession)
//     islandFactory: createIslandHost,            // lib/island/island_host_factory.dart
//     contentHost: preOpenedContentHost,          // optional: WebView2 started early
//     submitReport: (r) => outbox.report(r),      // POST /api/question-reports/reports/
//     window: windowControls,                     // full screen (null: item hidden)
//     battery: batteryReading,                    // NativeBridge.battery(), polled
//     inert: lockdownScreenShowing,               // shortcuts off under another screen
//     overlay: offscreenWarning,                  // drawn over the runner (midterms)
//     onExit: (exit) => router.leaveRunner(exit), // submitted / terminated / Save & Exit
//   )
//
// The app shell must provide MaterialLocalizations (Notes and Report a problem use text
// fields): MaterialApp does.
export '../tools/report_problem_dialog.dart' show ReportSubmitter;
export 'exam_runner_screen.dart' show ExamRunnerScreen, ExamRunnerScreenState, RunnerExit, runnerShortcutsEnabled;
export 'runner_window.dart';
