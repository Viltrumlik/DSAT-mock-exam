// THE exam launcher (AppServices.examLauncher): every Start / Resume / Start again / Start
// re-sit / Review from Home and the result screens lands here (app.dart openExam()).
//
//   PastpaperExamRequest → rt.pastpaper(id).open() → PastpaperSittingScreen (the runner)
//       Start, Resume and Start again are the same call, as on the website: v1 `open` resumes
//       the open sitting, restores an abandoned one, or creates a new one when the last is
//       finished (backend/desktop/v1/pastpapers.py) — it never abandons.
//   MidtermExamRequest   → rt.midterm(id) → MidtermSittingScreen (MidtermFlow + the runner)
//   ReviewExamRequest    → PastpaperReviewScreen (the content island in review mode)
//
// It returns the ExamOutcome openExam() acts on: a finished sitting opens its result.
import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../app.dart';
import '../../core/models/models.dart';
import '../../core/theme/toast.dart';
import '../../island/island_host.dart';
import '../engine/exam_runtime.dart';
import 'midterm_sitting.dart';
import 'pastpaper_sitting.dart';
import 'review_screen.dart';

class ExamLauncherWiring {
  ExamLauncherWiring({
    required this.islandFactory,
    this.animate = true,
    this.batteryPeriod = const Duration(seconds: 30),
  });

  /// The platform's island hosts (island_host_factory.dart), or a test's.
  final IslandHostFactory islandFactory;
  final bool animate;
  final Duration batteryPeriod;

  /// Use as `examLauncher: wiring.call` (an [ExamLauncher]).
  Future<ExamOutcome?> call(BuildContext context, ExamRequest request) async {
    final services = AppScope.of(context);
    switch (request) {
      case ReviewExamRequest():
        return _review(context, services, request);
      case PastpaperExamRequest():
        final rt = await _runtime(services);
        if (rt == null || !context.mounted) return null;
        return _pastpaper(context, services, rt, request);
      case MidtermExamRequest():
        final rt = await _runtime(services);
        if (rt == null || !context.mounted) return null;
        return _midterm(context, services, rt, request);
    }
  }

  /// The signed-in student's runtime (opened when their store opened; opened here if the
  /// student is known but it is not open yet).
  Future<ExamRuntime?> _runtime(AppServices services) async {
    final host = services.exams;
    if (host == null) return null;
    final open = host.runtime;
    if (open != null) return open;
    final userId = services.home.store?.userId ?? services.auth.session?.userId;
    if (userId == null) {
      services.toasts.show('Your tests are still loading — try again in a moment.');
      return null;
    }
    try {
      return await host.openFor(userId);
    } on Object catch (e) {
      services.log.add('exam', 'runtime open failed: $e');
      services.toasts.show("Your tests couldn't be opened on this computer. Try again.", tone: ToastTone.error);
      return null;
    }
  }

  String _studentName(AppServices s) => s.home.home?.student.fullName ?? s.auth.session?.displayName ?? '';

  void Function(String, String) _diagnostic(AppServices s) => (where, message) => s.log.add(where, message);

  Future<ExamOutcome?> _pastpaper(BuildContext context, AppServices s, ExamRuntime rt, PastpaperExamRequest r) {
    final engine = s.exams!.track(rt.pastpaper(r.practiceTestId, studentName: _studentName(s)));
    unawaited(engine.open());
    final nav = Navigator.of(context);
    return nav.push<ExamOutcome>(instantRoute(
      settings: RouteSettings(name: '/exam/pastpaper/${r.practiceTestId}'),
      (_) => PastpaperSittingScreen(
        engine: engine,
        native: s.native,
        islandFactory: islandFactory,
        islandDiagnostics: s.islandDiagnostics,
        onDiagnostic: _diagnostic(s),
        batteryPeriod: batteryPeriod,
        animate: animate,
        onExit: ({required bool finished}) => nav.pop(ExamOutcome(
          kind: AttemptKind.pastpaper,
          attemptId: engine.attemptId == 0 ? null : engine.attemptId,
          finished: finished,
        )),
        // Disposing the engine releases the machine too (the sitting already has).
        onDispose: () {
          s.exams?.untrack(engine);
          engine.dispose();
        },
      ),
    ));
  }

  Future<ExamOutcome?> _midterm(BuildContext context, AppServices s, ExamRuntime rt, MidtermExamRequest r) {
    final engine = s.exams!.track(rt.midterm(r.midterm.midtermId, studentName: _studentName(s)));
    final nav = Navigator.of(context);
    final policyUrl = s.home.home?.app.updateUrl ?? '';
    final download = Uri.tryParse(policyUrl.isNotEmpty ? policyUrl : s.config.origin.replace(path: '/downloads/desktop/MasterSAT-Setup.exe').toString());
    return nav.push<ExamOutcome>(instantRoute(
      settings: RouteSettings(name: '/exam/midterm/${r.midterm.midtermId}'),
      (_) => MidtermSittingScreen(
        row: r.midterm,
        engine: engine,
        native: s.native,
        islandFactory: islandFactory,
        auth: s.auth,
        updates: s.updates,
        openDownload: download == null || s.openExternal == null ? null : () => unawaited(s.openExternal!(download)),
        islandDiagnostics: s.islandDiagnostics,
        onDiagnostic: _diagnostic(s),
        animate: animate,
        onExit: ({required bool finished}) => nav.pop(ExamOutcome(
          kind: AttemptKind.midterm,
          attemptId: engine.attemptId == 0 ? null : engine.attemptId,
          finished: finished,
        )),
        // MidtermFlowController disposed the engine (and released the machine) already.
        onDispose: () => s.exams?.untrack(engine),
      ),
    ));
  }

  Future<ExamOutcome?> _review(BuildContext context, AppServices s, ReviewExamRequest r) async {
    final nav = Navigator.of(context);
    final fetch = s.fetchMedia;
    if (fetch == null) return null;
    await nav.push<void>(instantRoute(
      settings: RouteSettings(name: '/review/pastpaper/${r.attemptId}'),
      (_) => PastpaperReviewScreen(
        result: r.result,
        paper: r.paper,
        questionId: r.questionId,
        islandFactory: islandFactory,
        fetchMedia: fetch,
        runtime: s.exams?.runtime,
        api: s.api,
        native: s.native,
        studentName: _studentName(s),
        islandDiagnostics: s.islandDiagnostics,
        onDiagnostic: _diagnostic(s),
        onClose: () => nav.pop(),
      ),
    ));
    return null;
  }
}
