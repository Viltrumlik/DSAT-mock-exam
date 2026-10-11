// Home: "Your tests" — midterms grouped by when they can be sat, then the past-paper library
// (architecture §2.3, §8). Drawn from the cache on the first frame; one conditional `home`
// request refreshes it; an offline banner says when it was last updated.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/models/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';
import '../library/library_section.dart';
import 'app_header.dart';
import 'home_controller.dart';
import 'midterm_section.dart';
import 'update_controller.dart';

/// Ctrl+F (Cmd+F on the macOS dev runner) — focus the library search.
class FocusSearchIntent extends Intent {
  const FocusSearchIntent();
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final FocusNode _searchFocus = FocusNode(debugLabel: 'library search');
  final GlobalKey _searchKey = GlobalKey(debugLabel: 'library search box');
  final ScrollController _scroll = ScrollController();
  late final AppServices _services;

  @override
  void initState() {
    super.initState();
    _services = AppScope.of(context);
    _services.home.setVisible(true);
    _services.updates.startPeriodic();
  }

  @override
  void dispose() {
    _services.home.setVisible(false);
    _services.updates.stopPeriodic();
    _searchFocus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _focusSearch() {
    final ctx = _searchKey.currentContext;
    if (ctx != null) {
      Scrollable.ensureVisible(ctx, alignment: 0.1, duration: Duration.zero);
    }
    _searchFocus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.keyF, control: true): FocusSearchIntent(),
        SingleActivator(LogicalKeyboardKey.keyF, meta: true): FocusSearchIntent(),
      },
      child: Actions(
        actions: {FocusSearchIntent: CallbackAction<FocusSearchIntent>(onInvoke: (_) => _focusSearch())},
        child: Focus(
          autofocus: true,
          child: Scaffold(
            backgroundColor: AppColors.background,
            body: Column(
              children: [
                const AppHeader(),
                Expanded(
                  child: ListenableBuilder(
                    listenable: _services.home,
                    builder: (context, _) => _body(context, _services.home),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, HomeController home) {
    final data = home.home;
    return Scrollbar(
      controller: _scroll,
      child: SingleChildScrollView(
        controller: _scroll,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1180),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(32, 28, 32, 48),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('YOUR TESTS', style: AppText.eyebrow),
                  const SizedBox(height: 8),
                  Text(
                    data == null ? 'Your tests' : 'Welcome back, ${data.student.firstName.trim().isEmpty ? data.student.fullName : data.student.firstName.trim()}',
                    style: AppText.title,
                  ),
                  const SizedBox(height: 18),
                  ..._banners(context, home),
                  if (data == null)
                    _NoData(home: home)
                  else ...[
                    MidtermSection(midterms: data.midterms, offline: home.offline, serverNow: _services.serverClock.now),
                    const SizedBox(height: 44),
                    LibrarySection(
                      papers: data.pastpapers,
                      searchFocus: _searchFocus,
                      searchKey: _searchKey,
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

  List<Widget> _banners(BuildContext context, HomeController home) {
    final out = <Widget>[];
    void add(Widget w) => out.add(Padding(padding: const EdgeInsets.only(bottom: 12), child: w));

    final updates = _services.updates;
    final policy = home.home?.app;
    out.add(ListenableBuilder(
      listenable: updates,
      builder: (context, _) => UpdateBanner(updates: updates, policy: policy),
    ));

    if (home.home != null && home.offline) {
      final at = home.fetchedAt;
      add(NoticeBanner(
        tone: NoticeTone.offline,
        title: at == null ? "You're offline" : "You're offline — updated ${DateFormat.Hm().format(at.toLocal())}",
        message: 'Your tests are shown as they were then. Midterms need a connection to start.',
        actionLabel: 'Try again',
        actionBusy: home.refreshing,
        onAction: home.refresh,
      ));
    } else if (home.home != null && home.problem == HomeProblem.server) {
      add(NoticeBanner(
        tone: NoticeTone.warning,
        title: "Couldn't refresh your tests",
        message: home.problemDetail ?? 'Something went wrong on our end. Try again in a moment.',
        actionLabel: 'Try again',
        actionBusy: home.refreshing,
        onAction: home.refresh,
      ));
    }
    return out;
  }
}

/// Nothing cached and nothing fetched yet: loading, offline or an error.
class _NoData extends StatelessWidget {
  const _NoData({required this.home});

  final HomeController home;

  @override
  Widget build(BuildContext context) {
    final problem = home.problem;
    if (problem == null) return const _Skeleton();
    final offline = problem == HomeProblem.offline;
    return EmptyState(
      error: true,
      icon: offline ? LucideIcons.wifiOff : LucideIcons.triangleAlert,
      title: offline ? "You're offline" : "Couldn't load your tests",
      message: offline
          ? 'Connect to the internet to see your tests. Anything you saved on this computer is safe.'
          : (home.problemDetail ?? 'Something went wrong on our end. Check your connection and try again.'),
      actionLabel: home.refreshing ? 'Trying again…' : 'Try again',
      actionIcon: LucideIcons.refreshCw,
      onAction: home.refreshing ? null : home.refresh,
    );
  }
}

class _Skeleton extends StatelessWidget {
  const _Skeleton();

  @override
  Widget build(BuildContext context) {
    Widget bar(double h) => Container(
          height: h,
          margin: const EdgeInsets.only(bottom: 12),
          decoration: BoxDecoration(color: AppColors.skeleton, borderRadius: BorderRadius.circular(AppRadii.lg)),
        );
    return Semantics(
      label: 'Loading your tests',
      child: Column(children: [bar(72), bar(72), const SizedBox(height: 24), bar(200)]),
    );
  }
}

/// "A new version is ready — Restart to update" (Home only, never in a test).
class UpdateBanner extends StatelessWidget {
  const UpdateBanner({super.key, required this.updates, this.policy});

  final UpdateController updates;
  final AppPolicy? policy;

  @override
  Widget build(BuildContext context) {
    final banner = _banner();
    if (banner == null) return const SizedBox.shrink();
    return Padding(padding: const EdgeInsets.only(bottom: 12), child: banner);
  }

  Widget? _banner() {
    if (updates.isReady) {
      return NoticeBanner(
        tone: NoticeTone.info,
        icon: LucideIcons.download,
        title: updates.version == null ? 'A new version of MasterSAT is ready' : 'MasterSAT ${updates.version} is ready',
        message: 'Restart to update — it takes a few seconds.',
        actionLabel: 'Restart to update',
        onAction: updates.restartToUpdate,
      );
    }
    final p = policy;
    if (p != null && p.update == AppUpdate.available) {
      final downloading = updates.phase == UpdatePhase.downloading;
      return NoticeBanner(
        tone: NoticeTone.info,
        icon: LucideIcons.download,
        title: p.message.trim().isNotEmpty ? p.message.trim() : 'A new version of MasterSAT is available',
        message: downloading ? 'Downloading the update… ${updates.percent}%' : 'It downloads in the background while you work.',
        actionLabel: downloading ? null : 'Update now',
        actionBusy: updates.phase == UpdatePhase.checking,
        onAction: () => unawaited(updates.checkAndDownload()),
      );
    }
    return null;
  }
}
