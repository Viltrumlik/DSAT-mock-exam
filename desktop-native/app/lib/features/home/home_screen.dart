// The signed-in app: the shell (sidebar + top bar, features/shell/app_shell.dart) around the
// page the student has open — Past papers, Midterms or Settings (architecture §2.3, §8). Both
// lists are drawn from the cached Home on the first frame; one conditional `home` request
// refreshes them; the banners (update, offline, a failed refresh) sit at the top of the page.
//
// The two list pages stay built while hidden, so switching is instant and each keeps its scroll
// position, filters and search. Settings is built afresh each time it opens (it re-reads what
// is waiting to be sent).
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app.dart';
import '../library/past_papers_page.dart';
import '../settings/settings_screen.dart';
import '../shell/app_shell.dart';
import '../shell/shell_controller.dart';
import 'midterms_page.dart';

/// Ctrl+F (Cmd+F on the macOS dev runner) — open Past papers and focus its search.
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
  final ScrollController _papersScroll = ScrollController();
  final ScrollController _midtermsScroll = ScrollController();
  late final AppServices _services;

  @override
  void initState() {
    super.initState();
    _services = AppScope.of(context);
    _services.home.setVisible(true);
    _services.updates.startPeriodic();
    _services.home.addListener(_land);
    _land();
  }

  @override
  void dispose() {
    _services.home.removeListener(_land);
    _services.home.setVisible(false);
    _services.updates.stopPeriodic();
    _searchFocus.dispose();
    _papersScroll.dispose();
    _midtermsScroll.dispose();
    super.dispose();
  }

  /// The landing rule (shell_controller.dart): the first Home there is picks the page.
  void _land() => _services.shell.land(_services.home.home);

  void _focusSearch() {
    _services.shell.select(ShellSection.pastPapers);
    // The page was hidden (and so unfocusable) until this frame.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final ctx = _searchKey.currentContext;
      if (ctx != null) Scrollable.ensureVisible(ctx, alignment: 0.1, duration: Duration.zero);
      _searchFocus.requestFocus();
    });
  }

  @override
  Widget build(BuildContext context) {
    final shell = _services.shell;
    return Shortcuts(
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.keyF, control: true): FocusSearchIntent(),
        SingleActivator(LogicalKeyboardKey.keyF, meta: true): FocusSearchIntent(),
      },
      child: Actions(
        actions: {FocusSearchIntent: CallbackAction<FocusSearchIntent>(onInvoke: (_) => _focusSearch())},
        child: Focus(
          autofocus: true,
          child: ListenableBuilder(
            listenable: shell,
            builder: (context, _) {
              final section = shell.section;
              return AppShell(
                section: section,
                child: IndexedStack(
                  index: section.index,
                  sizing: StackFit.expand,
                  children: [
                    PastPapersPage(controller: _papersScroll, searchFocus: _searchFocus, searchKey: _searchKey),
                    MidtermsPage(controller: _midtermsScroll),
                    if (section == ShellSection.settings) const SettingsScreen() else const SizedBox.shrink(),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
