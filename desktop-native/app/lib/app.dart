// The app shell: services, the root widget, navigation, and THE entry point into the exam.
//
//   AppServices  every long-lived object (API, auth, Home, library, updates, …), built once in
//                main.dart and reachable from any widget with AppScope.of(context)
//   MasterSatApp the MaterialApp stripped of web/mobile habits (instant routes, no ripples)
//   openExam()   the single function every "Start / Resume / Start again / Review" calls;
//                the integrator wires [AppServices.examLauncher] to the real runner
import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import 'core/api/v1_api.dart';
import 'core/auth/auth_controller.dart';
import 'core/auth/launch_links.dart';
import 'core/clock/clock.dart';
import 'core/diagnostics/diagnostics.dart';
import 'core/http/api_config.dart';
import 'core/models/models.dart';
import 'core/store/app_paths.dart';
import 'core/store/unsent_work.dart';
import 'core/store/user_store.dart';
import 'core/store/window_placement_sync.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/controls.dart';
import 'core/theme/toast.dart';
import 'core/theme/tokens.dart';
import 'features/home/home_controller.dart';
import 'features/home/home_screen.dart';
import 'features/home/update_card.dart';
import 'features/home/update_controller.dart';
import 'features/library/library_controller.dart';
import 'features/library/pastpaper_model.dart';
import 'features/results/midterm_result_screen.dart';
import 'features/results/pastpaper_result_screen.dart';
import 'features/results/results_controller.dart';
import 'features/settings/settings_screen.dart';
import 'features/signin/sign_in_screen.dart';
import 'native/native_bridge.dart';

// =============================================================================================
// Entry into the exam
// =============================================================================================

/// What the student asked the exam runner to open.
sealed class ExamRequest {
  const ExamRequest();

  /// A short, human description (the placeholder screen and diagnostics).
  String get describe;
}

/// Start / Resume / Start again on a past-paper card. The engine calls `pastpaperOpen`
/// (v1 `open` resumes an open attempt, restores an abandoned one, or creates a new one).
final class PastpaperExamRequest extends ExamRequest {
  const PastpaperExamRequest({required this.paper, required this.action});

  final PastpaperRow paper;

  /// [PaperAction.start], [PaperAction.resume] or [PaperAction.startAgain].
  final PaperAction action;

  int get practiceTestId => paper.id;

  /// The attempt a Resume continues.
  int? get openAttemptId => paper.state.openAttemptId;

  @override
  String get describe => '${paperAction(PastpaperCardState.fromRow(paper)).label}: ${sectionTitle(paper)} '
      '(${subjectLabel(paper.subject)}, practice test ${paper.id})';
}

/// Start / Resume / Start re-sit on a midterm row. The midterm flow (rules → code →
/// pre-check → lock) is the exam engine's (features/midterm).
final class MidtermExamRequest extends ExamRequest {
  const MidtermExamRequest({required this.midterm});

  final MidtermRow midterm;

  bool get resume => !midterm.resitOpen && !midterm.submitted && midterm.attemptId != null && midterm.state != 'NOT_STARTED';
  bool get resit => midterm.resitOpen;

  @override
  String get describe => '${resit ? 'Re-sit' : resume ? 'Resume' : 'Start'}: ${midterm.title} (midterm ${midterm.midtermId})';
}

/// "Review questions" on a past-paper result: the content island, read-only.
final class ReviewExamRequest extends ExamRequest {
  const ReviewExamRequest({required this.result, this.paper, this.questionId});

  final PastpaperResult result;
  final PastpaperRow? paper;

  /// Open at this question (a click in the question grid); null = the first.
  final int? questionId;

  int get attemptId => result.attemptId;

  @override
  String get describe => 'Review: attempt ${result.attemptId}${questionId == null ? '' : ', question $questionId'}';
}

/// How an exam screen ended.
@immutable
class ExamOutcome {
  const ExamOutcome({required this.kind, this.attemptId, this.finished = false});

  final AttemptKind kind;
  final int? attemptId;

  /// The attempt was submitted (show its result next).
  final bool finished;
}

/// Opens the runner for [request] and completes when the student is back on Home.
typedef ExamLauncher = Future<ExamOutcome?> Function(BuildContext context, ExamRequest request);

/// THE entry point: every Start / Resume / Start again / Start re-sit / Review calls this.
/// Afterwards Home refreshes (one request) and a finished attempt opens its result.
Future<void> openExam(BuildContext context, ExamRequest request) async {
  final services = AppScope.of(context);
  services.log.add('exam', request.describe);
  final outcome = await services.examLauncher(context, request);
  if (!context.mounted) return;
  unawaited(services.home.refresh());
  final id = outcome?.attemptId;
  if (outcome == null || !outcome.finished || id == null) return;
  switch (outcome.kind) {
    case AttemptKind.pastpaper:
      await openPastpaperResult(context, attemptId: id);
    case AttemptKind.midterm:
      final row = services.home.home?.midterms.where((m) => m.attemptId == id).firstOrNull;
      if (row != null) await openMidtermResult(context, row: row);
  }
}

/// The stand-in until the integrator wires the real runner.
Future<ExamOutcome?> placeholderExamLauncher(BuildContext context, ExamRequest request) =>
    Navigator.of(context).push<ExamOutcome>(instantRoute((_) => ExamPlaceholderScreen(request: request)));

// =============================================================================================
// Navigation
// =============================================================================================

/// A route with no transition (native screens switch instantly).
PageRoute<T> instantRoute<T>(WidgetBuilder builder, {RouteSettings? settings}) => PageRouteBuilder<T>(
      settings: settings,
      transitionDuration: Duration.zero,
      reverseTransitionDuration: Duration.zero,
      pageBuilder: (context, _, _) => builder(context),
    );

Future<void> openPastpaperResult(BuildContext context, {required int attemptId, PastpaperRow? paper}) {
  final services = AppScope.of(context);
  final row = paper ?? services.home.home?.pastpapers.where((p) => p.history.any((h) => h.attemptId == attemptId) || p.state.lastAttemptId == attemptId).firstOrNull;
  return Navigator.of(context).push<void>(instantRoute(
    (_) => PastpaperResultScreen(attemptId: attemptId, paper: row),
    settings: RouteSettings(name: '/results/pastpaper/$attemptId'),
  ));
}

Future<void> openMidtermResult(BuildContext context, {required MidtermRow row}) {
  return Navigator.of(context).push<void>(instantRoute(
    (_) => MidtermResultScreen(row: row),
    settings: RouteSettings(name: '/results/midterm/${row.attemptId}'),
  ));
}

Future<void> openSettings(BuildContext context) =>
    Navigator.of(context).push<void>(instantRoute((_) => const SettingsScreen(), settings: const RouteSettings(name: '/settings')));

// =============================================================================================
// Services
// =============================================================================================

class AppServices {
  AppServices({
    required this.config,
    required this.paths,
    required this.native,
    required this.api,
    required this.auth,
    required this.home,
    required this.library,
    required this.updates,
    required this.unsentWork,
    required this.clock,
    required this.serverClock,
    required this.log,
    required this.toasts,
    required this.documents,
    this.links,
    this.windowPlacement,
    ExamLauncher? examLauncher,
    Future<void> Function(String text)? copyToClipboard,
    this.openExternal,
  })  : examLauncher = examLauncher ?? placeholderExamLauncher,
        copyToClipboard = copyToClipboard ?? _copy {
    home.onStoreOpened = (store) {
      library.attach(store.settings);
      unawaited(windowPlacement?.attach(store.settings));
    };
    home.onUpdateRequired = (e) => updates.required.value = e;
    auth.addListener(_onAuthChanged);
    _lastStatus = auth.status;
  }

  final ApiConfig config;
  final AppPaths paths;
  final NativeBridge native;
  final V1Api api;
  final AuthController auth;
  final HomeController home;
  final LibraryController library;
  final UpdateController updates;

  /// The exam engine registers its outbox counter here; sign-out and "Delete data on this
  /// computer" are blocked while it reports anything.
  final UnsentWork unsentWork;
  final Clock clock;
  final ServerClock serverClock;
  final EventLog log;
  final ToastController toasts;
  final DocumentSaver documents;
  final LaunchLinks? links;
  final WindowPlacementSync? windowPlacement;

  /// Where [openExam] sends the student. Replace with the real runner.
  ExamLauncher examLauncher;

  final Future<void> Function(String text) copyToClipboard;

  /// Opens a website link in the browser (update fallback). Null in tests = no-op.
  final Future<bool> Function(Uri url)? openExternal;

  final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
  AuthStatus? _lastStatus;

  static Future<void> _copy(String text) => Clipboard.setData(ClipboardData(text: text));

  void _onAuthChanged() {
    final s = auth.status;
    final was = _lastStatus;
    _lastStatus = s;
    if (s == was) return;
    if (s == AuthStatus.signedIn) {
      log.add('auth', 'signed in');
      unawaited(home.start());
    } else if (was == AuthStatus.signedIn) {
      log.add('auth', 'signed out${auth.problem == null ? '' : ' (${auth.problem!.kind.name})'}');
      navigatorKey.currentState?.popUntil((r) => r.isFirst);
      windowPlacement?.detach();
      library.reset();
      unawaited(home.reset());
    }
  }

  /// Settings → "Delete data on this computer". Blocked while unsent work remains. Removes
  /// this student's database and the shared caches, then signs out.
  Future<UnsentSummary?> deleteLocalData() async {
    final unsent = await unsentWork.check();
    if (!unsent.isEmpty) return unsent;
    final userId = home.store?.userId ?? auth.session?.userId;
    await home.reset();
    if (userId != null) await UserStore.removeFiles(paths, userId);
    await UserStore.removeSharedCaches(paths);
    await auth.signOut(force: true);
    log.add('data', 'local data removed');
    return null;
  }

  /// The diagnostics JSON for "Copy diagnostics".
  Future<String> diagnostics() async {
    final unsent = await unsentWork.check();
    final h = home.home;
    return diagnosticsJson(DiagnosticsInput(
      appVersion: config.appVersion,
      buildMode: kReleaseMode ? 'release' : (kProfileMode ? 'profile' : 'debug'),
      apiOrigin: config.target == ApiTarget.inProcessFixtures ? 'fixtures (in-process)' : config.origin.toString(),
      clientHeader: config.clientHeader,
      nativeLibraryVersion: _safe(() => native.libraryVersion),
      signedIn: auth.isSignedIn,
      userId: auth.session?.userId,
      accessExpiresAt: auth.session?.accessExpiresAt,
      nextRefreshAt: auth.nextRefreshAt,
      homeFetchedAt: home.fetchedAt,
      homeEtag: home.etag,
      midtermCount: h?.midterms.length,
      pastpaperCount: h?.pastpapers.length,
      online: !home.offline,
      unsent: unsent.toJson(),
      updateChannel: home.store?.settings.updateChannel.wire ?? 'stable',
      updateState: updates.stateLabel,
      serverClockOffset: serverClock.observed ? serverClock.offset : null,
      events: log.events,
      now: clock.now(),
    ));
  }

  static String _safe(String Function() f) {
    try {
      return f();
    } catch (e) {
      return 'unavailable';
    }
  }

  void dispose() {
    auth.removeListener(_onAuthChanged);
    windowPlacement?.dispose();
    links?.dispose();
    updates.dispose();
    home.dispose();
    library.dispose();
    auth.dispose();
    toasts.dispose();
  }
}

/// Makes [AppServices] reachable from any widget.
class AppScope extends InheritedWidget {
  const AppScope({super.key, required this.services, required super.child});

  final AppServices services;

  static AppServices of(BuildContext context) {
    final scope = context.getInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope missing above $context');
    return scope!.services;
  }

  @override
  bool updateShouldNotify(AppScope oldWidget) => !identical(services, oldWidget.services);
}

// =============================================================================================
// The app
// =============================================================================================

/// Desktop scrolling: no overscroll glow/stretch, mouse-drag never scrolls (only the wheel and
/// the scrollbar), scrollbars shown.
class _DesktopScrollBehavior extends MaterialScrollBehavior {
  const _DesktopScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices => const {PointerDeviceKind.touch, PointerDeviceKind.stylus, PointerDeviceKind.trackpad};

  @override
  Widget buildOverscrollIndicator(BuildContext context, Widget child, ScrollableDetails details) => child;
}

class MasterSatApp extends StatefulWidget {
  const MasterSatApp({super.key, required this.services});

  final AppServices services;

  @override
  State<MasterSatApp> createState() => _MasterSatAppState();
}

class _MasterSatAppState extends State<MasterSatApp> {
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    // The window coming back to the front refreshes Home (one conditional request).
    _lifecycle = AppLifecycleListener(onResume: () {
      final s = widget.services;
      if (s.auth.isSignedIn) unawaited(s.home.refresh());
    });
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final services = widget.services;
    return AppScope(
      services: services,
      child: MaterialApp(
        title: 'MasterSAT',
        debugShowCheckedModeBanner: false,
        theme: buildAppTheme(),
        navigatorKey: services.navigatorKey,
        scrollBehavior: const _DesktopScrollBehavior(),
        // No browser habits: nothing here binds reload, find-in-page or zoom keys.
        builder: (context, child) => ToastHost(
          controller: services.toasts,
          child: UpdateRequiredGate(child: child ?? const SizedBox.shrink()),
        ),
        home: const AppRoot(),
      ),
    );
  }
}

/// Sign-in or Home, from the auth state.
class AppRoot extends StatelessWidget {
  const AppRoot({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = AppScope.of(context).auth;
    return ListenableBuilder(
      listenable: auth,
      builder: (context, _) => switch (auth.status) {
        AuthStatus.starting => const ColoredBox(color: AppColors.background, child: SizedBox.expand()),
        AuthStatus.signedIn => const HomeScreen(),
        _ => const SignInScreen(),
      },
    );
  }
}

// =============================================================================================
// Placeholder exam screen (until the integrator wires the runner)
// =============================================================================================

class ExamPlaceholderScreen extends StatelessWidget {
  const ExamPlaceholderScreen({super.key, required this.request});

  final ExamRequest request;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: AppCard(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  const Icon(LucideIcons.clipboardList, size: 22, color: AppColors.indigo),
                  const SizedBox(width: 10),
                  Expanded(child: Text('The exam runner opens here', style: AppText.heading)),
                ]),
                const SizedBox(height: 10),
                Text(request.describe, style: AppText.body),
                const SizedBox(height: 6),
                Text(
                  'This build connects the screens around the test. The timed runner is wired in by the next step of the build.',
                  style: AppText.bodyMuted,
                ),
                const SizedBox(height: 20),
                AppButton(
                  label: 'Back to your tests',
                  icon: LucideIcons.arrowLeft,
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Whether the platform is the shipping one (Windows).
bool get isWindowsHost => !kIsWeb && Platform.isWindows;
