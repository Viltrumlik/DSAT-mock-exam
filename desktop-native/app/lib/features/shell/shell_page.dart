// The pieces every page inside the shell shares: the scrolling column the page sits in, the
// banners at its top (a new version, offline, a failed refresh), and what a page shows before
// Home has ever arrived (loading, offline, an error).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/models/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';
import '../home/home_controller.dart';
import '../home/update_controller.dart';

/// A page's scrolling column: centred, at most [maxWidth] wide (padding included), in the
/// dashboard face when [board].
class ShellPage extends StatelessWidget {
  const ShellPage({
    super.key,
    required this.children,
    this.controller,
    this.maxWidth = 1280,
    this.padding = const EdgeInsets.fromLTRB(32, 20, 32, 48),
    this.board = true,
  });

  final List<Widget> children;
  final ScrollController? controller;
  final double maxWidth;
  final EdgeInsets padding;

  /// The student dashboard's face (Plus Jakarta Sans), as `.dzboard` pages are on the website.
  final bool board;

  @override
  Widget build(BuildContext context) {
    Widget column = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
    if (board) column = BoardFace(child: column);
    return Scrollbar(
      controller: controller,
      child: SingleChildScrollView(
        controller: controller,
        padding: padding,
        child: Center(
          child: ConstrainedBox(constraints: BoxConstraints(maxWidth: maxWidth), child: column),
        ),
      ),
    );
  }
}

/// The notices at the top of whichever page is open: "A new version is ready", "You're
/// offline — updated 14:00", "Couldn't refresh your tests". Each comes with its own space
/// below; none shows when there is nothing to say.
class HomeBanners extends StatelessWidget {
  const HomeBanners({super.key});

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    final home = services.home;
    return ListenableBuilder(
      listenable: Listenable.merge([home, services.updates]),
      builder: (context, _) {
        final out = <Widget>[];
        void add(Widget w) => out.add(Padding(padding: const EdgeInsets.only(bottom: 16), child: w));

        out.add(UpdateBanner(
          updates: services.updates,
          policy: home.home?.app,
          openWebsite: (url) {
            final open = services.openExternal;
            if (open != null) unawaited(open(url));
          },
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
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: out);
      },
    );
  }
}

/// "A new version is ready — Restart to update" (outside a test only).
class UpdateBanner extends StatelessWidget {
  const UpdateBanner({super.key, required this.updates, this.policy, this.openWebsite});

  final UpdateController updates;
  final AppPolicy? policy;

  /// Opens the installer page when the in-app updater has nothing (the feed lags the policy).
  final void Function(Uri url)? openWebsite;

  @override
  Widget build(BuildContext context) {
    final banner = _banner();
    if (banner == null) return const SizedBox.shrink();
    return Padding(padding: const EdgeInsets.only(bottom: 16), child: banner);
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
      // The in-app updater found nothing (or failed): the website's installer is the way.
      final viaWebsite = (updates.phase == UpdatePhase.upToDate || updates.phase == UpdatePhase.failed) &&
          p.updateUrl.trim().isNotEmpty &&
          openWebsite != null;
      return NoticeBanner(
        tone: NoticeTone.info,
        icon: LucideIcons.download,
        title: p.message.trim().isNotEmpty ? p.message.trim() : 'A new version of MasterSAT is available',
        message: downloading
            ? 'Downloading the update… ${updates.percent}%'
            : viaWebsite
                ? 'Get the new version from the MasterSAT website.'
                : 'It downloads in the background while you work.',
        actionLabel: downloading ? null : (viaWebsite ? 'Download from the website' : 'Update now'),
        actionBusy: updates.phase == UpdatePhase.checking,
        onAction: viaWebsite
            ? () => openWebsite!(Uri.parse(p.updateUrl.trim()))
            : () => unawaited(updates.checkAndDownload()),
      );
    }
    return null;
  }
}

/// Nothing cached and nothing fetched yet: loading (the website's skeleton cards), offline or
/// an error (the website's error block).
class HomeNoData extends StatelessWidget {
  const HomeNoData({super.key, required this.home, this.skeleton = const HomeSkeleton()});

  final HomeController home;
  final Widget skeleton;

  @override
  Widget build(BuildContext context) {
    final problem = home.problem;
    if (problem == null) return skeleton;
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

/// The loading placeholder: --dz-skel blocks (no shimmer — nothing moves for decoration).
class HomeSkeleton extends StatelessWidget {
  const HomeSkeleton({super.key, this.heights = const [200, 200, 200, 200], this.grid = true});

  final List<double> heights;

  /// Two columns of card-sized blocks (Past papers) or one column of rows (Midterms).
  final bool grid;

  @override
  Widget build(BuildContext context) {
    Widget block(double h) => Container(
          height: h,
          decoration: BoxDecoration(color: AppColors.skeleton, borderRadius: BorderRadius.circular(AppRadii.lg)),
        );
    final blocks = [for (final h in heights) block(h)];
    return Semantics(
      label: 'Loading your tests',
      child: grid
          ? LayoutBuilder(builder: (context, c) {
              final cols = ((c.maxWidth + 18) / (380 + 18)).floor().clamp(1, 4);
              final rows = <Widget>[];
              for (var i = 0; i < blocks.length; i += cols) {
                rows.add(Padding(
                  padding: const EdgeInsets.only(bottom: 18),
                  child: Row(children: [
                    for (var j = 0; j < cols; j++) ...[
                      if (j > 0) const SizedBox(width: 18),
                      Expanded(child: i + j < blocks.length ? blocks[i + j] : const SizedBox.shrink()),
                    ],
                  ]),
                ));
              }
              return Column(children: rows);
            })
          : Column(children: [
              for (final b in blocks) Padding(padding: const EdgeInsets.only(bottom: 12), child: b),
            ]),
    );
  }
}
