// The frame every signed-in screen sits in — the website's student shell
// (frontend/src/components/shell/AppShell.tsx):
//
//   * a white sidebar, 272 px, hairline on its right: the brand row (64 px, the 48 px shield and
//     "MasterSAT" in 19/800), then Past papers / Midterms / Settings as rounded rows (radius 16,
//     15/600) with a 40 px icon tile (radius 12, on --surface-2); the page you are on is the one
//     solid block of brand colour, with its shadow. Midterms carries a count while a midterm can
//     be sat now. Sign out sits in the footer. Below 1000 px of window the sidebar folds to a
//     72 px icon rail (labels become tooltips);
//   * a 64 px top bar (white at 80 % over the page, hairline below): the page title and the
//     greeting on the left, the student's name on the right with a menu (Sign out);
//   * the page itself, over the faint shield watermark in the bottom-right corner.
//
// Native habits stay: the arrow cursor, no ripples, nothing selectable, pages switch instantly.
// A sidebar press from a pushed page (a result) goes back to the shell's page first.
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/brand.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';
import '../home/app_header.dart' show confirmSignOut;
import 'shell_controller.dart';

/// Below this window width the sidebar is an icon rail.
const double kSidebarRailBreakpoint = 1000;

class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.section, required this.child, this.title});

  /// The sidebar row shown as current.
  final ShellSection section;

  /// The top bar's title; the section's name by default.
  final String? title;
  final Widget child;

  /// Opens [section]: back to the shell's own page first when a result is on top.
  static void go(BuildContext context, ShellSection section) {
    final services = AppScope.of(context);
    services.navigatorKey.currentState?.popUntil((r) => r.isFirst);
    services.shell.select(section);
  }

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: LayoutBuilder(
        builder: (context, constraints) {
          final rail = constraints.maxWidth < kSidebarRailBreakpoint;
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ListenableBuilder(
                listenable: services.home,
                builder: (context, _) => AppSidebar(
                  active: section,
                  rail: rail,
                  midtermsAvailable: availableMidterms(services.home.home),
                  onSelect: (s) => go(context, s),
                  onSignOut: () => confirmSignOut(context),
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ShellTopBar(title: title ?? section.label),
                    Expanded(
                      child: ClipRect(
                        child: Stack(
                          children: [
                            const _Watermark(),
                            Positioned.fill(child: child),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

// =============================================================================================
// Sidebar
// =============================================================================================

class AppSidebar extends StatelessWidget {
  const AppSidebar({
    super.key,
    required this.active,
    required this.rail,
    required this.midtermsAvailable,
    required this.onSelect,
    required this.onSignOut,
  });

  final ShellSection active;

  /// The folded 72 px icon rail.
  final bool rail;
  final int midtermsAvailable;
  final ValueChanged<ShellSection> onSelect;
  final VoidCallback onSignOut;

  static const _icons = {
    ShellSection.pastPapers: LucideIcons.bookOpen,
    ShellSection.midterms: LucideIcons.fileText,
    ShellSection.settings: LucideIcons.settings,
  };

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      explicitChildNodes: true,
      label: 'Main',
      child: Container(
        width: rail ? 72 : 272,
        decoration: const BoxDecoration(
          color: AppColors.card,
          border: Border(right: BorderSide(color: AppColors.border)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Brand: h-16, hairline below, px-4, the 48 px shield and the name.
            Container(
              height: 64,
              padding: EdgeInsets.symmetric(horizontal: rail ? 0 : 16),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: AppColors.border)),
              ),
              child: Row(
                mainAxisAlignment: rail ? MainAxisAlignment.center : MainAxisAlignment.start,
                children: [
                  BrandLogo(size: rail ? 40 : 48),
                  if (!rail) ...[
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'MasterSAT',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.base.copyWith(
                          fontSize: 19,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 19 * -0.025,
                          height: 1.3,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Expanded(
              child: FocusTraversalGroup(
                child: ListView(
                  padding: EdgeInsets.symmetric(horizontal: rail ? 8 : 12, vertical: 16),
                  children: [
                    for (final s in ShellSection.values) ...[
                      if (s != ShellSection.values.first) const SizedBox(height: 6),
                      _NavItem(
                        label: s.label,
                        icon: _icons[s]!,
                        active: s == active,
                        rail: rail,
                        count: s == ShellSection.midterms && midtermsAvailable > 0 ? midtermsAvailable : null,
                        onPressed: () => onSelect(s),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            // Footer: Sign out (rounded-xl px-3 py-2.5, 14/600, muted).
            Container(
              padding: EdgeInsets.all(rail ? 8 : 12),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: Pressable(
                onPressed: onSignOut,
                semanticLabel: 'Sign out',
                tooltip: rail ? 'Sign out' : null,
                builder: (context, s) {
                  final fg = s.hovered ? AppColors.textPrimary : AppColors.textSecondary;
                  return FocusRing(
                    visible: s.focused,
                    radius: AppRadii.kitMd,
                    child: Container(
                      padding: EdgeInsets.symmetric(horizontal: rail ? 8 : 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: s.pressed ? AppColors.surface3 : (s.hovered ? AppColors.surface2 : null),
                        borderRadius: BorderRadius.circular(AppRadii.kitMd),
                      ),
                      child: Row(
                        mainAxisAlignment: rail ? MainAxisAlignment.center : MainAxisAlignment.start,
                        children: [
                          Icon(LucideIcons.logOut, size: 18, color: fg),
                          if (!rail) ...[
                            const SizedBox(width: 12),
                            Text(
                              'Sign out',
                              style: AppText.body.copyWith(fontWeight: FontWeight.w600, height: 1.43, color: fg),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.label,
    required this.icon,
    required this.active,
    required this.rail,
    required this.onPressed,
    this.count,
  });

  final String label;
  final IconData icon;
  final bool active;
  final bool rail;
  final int? count;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final countLabel = count == null ? '' : ', $count available now';
    return Pressable(
      onPressed: onPressed,
      selected: active,
      semanticLabel: '$label$countLabel',
      tooltip: rail ? label : null,
      builder: (context, s) {
        final fg = active ? AppColors.onPrimary : AppColors.textPrimary;
        final tile = active ? null : (s.hovered ? AppColors.card : AppColors.surface2);
        final badge = count == null
            ? null
            : Container(
                constraints: const BoxConstraints(minWidth: 20),
                height: 20,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: active ? const Color(0x33FFFFFF) : AppColors.primary,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$count',
                  style: AppText.badge.copyWith(color: AppColors.onPrimary, fontSize: 11, height: 1.2),
                ),
              );
        final iconTile = Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(color: tile, borderRadius: BorderRadius.circular(AppRadii.kitMd)),
          child: Icon(icon, size: 18, color: fg),
        );
        return FocusRing(
          visible: s.focused,
          radius: AppRadii.kitLg,
          child: Container(
            padding: EdgeInsets.symmetric(horizontal: rail ? 6 : 10, vertical: 8),
            decoration: BoxDecoration(
              color: active ? AppColors.primary : (s.hovered || s.pressed ? AppColors.surface2 : null),
              borderRadius: BorderRadius.circular(AppRadii.kitLg),
              boxShadow: active ? AppShadows.navActive : null,
            ),
            child: rail
                ? Center(
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        iconTile,
                        if (badge != null) Positioned(right: -6, top: -6, child: badge),
                      ],
                    ),
                  )
                : Row(
                    children: [
                      iconTile,
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.base.copyWith(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            height: 1.4,
                            color: fg,
                          ),
                        ),
                      ),
                      ?badge,
                    ],
                  ),
          ),
        );
      },
    );
  }
}

// =============================================================================================
// Top bar
// =============================================================================================

class ShellTopBar extends StatelessWidget {
  const ShellTopBar({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    return Container(
      height: 64,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      decoration: const BoxDecoration(
        color: AppColors.topBar,
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: ListenableBuilder(
        listenable: Listenable.merge([services.home, services.auth]),
        builder: (context, _) {
          final student = services.home.home?.student;
          final name = student?.fullName ?? services.auth.session?.displayName;
          final first = student == null
              ? (name ?? '').trim().split(RegExp(r'\s+')).first
              : (student.firstName.trim().isEmpty ? student.fullName : student.firstName.trim());
          return Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Semantics(
                      header: true,
                      child: Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.base.copyWith(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 16 * -0.025,
                          height: 1.3,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                    if (first.isNotEmpty)
                      Text(
                        'Welcome back, $first',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.caption.copyWith(
                          fontWeight: FontWeight.w500,
                          height: 1.4,
                          color: AppColors.textLabel,
                        ),
                      ),
                  ],
                ),
              ),
              if (name != null && name.isNotEmpty) ...[const SizedBox(width: 16), AccountMenuButton(name: name)],
            ],
          );
        },
      ),
    );
  }
}

/// Initials in a primary-soft circle (Avatar.tsx).
class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.name, this.size = 36});

  final String name;
  final double size;

  static String initialsOf(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).take(2);
    final s = parts.map((p) => p.characters.first.toUpperCase()).join();
    return s.isEmpty ? '?' : s;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: const BoxDecoration(color: AppColors.primarySoft, shape: BoxShape.circle),
      child: Text(
        initialsOf(name),
        style: AppText.base.copyWith(
          fontSize: math.max(11, size * 0.36),
          fontWeight: FontWeight.w600,
          height: 1,
          color: AppColors.primary,
        ),
      ),
    );
  }
}

/// The student's name in the top bar; it opens a small menu (the website's account menu:
/// 224 wide, radius 12, the modal shadow) with their name and Sign out.
class AccountMenuButton extends StatefulWidget {
  const AccountMenuButton({super.key, required this.name});

  final String name;

  @override
  State<AccountMenuButton> createState() => _AccountMenuButtonState();
}

class _AccountMenuButtonState extends State<AccountMenuButton> {
  final OverlayPortalController _menu = OverlayPortalController(debugLabel: 'account menu');
  final LayerLink _link = LayerLink();
  final FocusNode _button = FocusNode(debugLabel: 'account');
  final FocusNode _firstItem = FocusNode(debugLabel: 'account menu: Sign out');
  final Object _group = Object();

  @override
  void dispose() {
    _button.dispose();
    _firstItem.dispose();
    super.dispose();
  }

  void _toggle() {
    if (_menu.isShowing) {
      _close();
    } else {
      setState(_menu.show);
      // Keyboard users land on the first item; a mouse click shows no ring anyway.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _menu.isShowing) _firstItem.requestFocus();
      });
    }
  }

  void _close({bool refocus = false}) {
    if (!_menu.isShowing) return;
    setState(_menu.hide);
    if (refocus) _button.requestFocus();
  }

  Future<void> _signOut() async {
    _close();
    await confirmSignOut(context);
  }

  @override
  Widget build(BuildContext context) {
    return TapRegion(
      groupId: _group,
      onTapOutside: (_) => _close(),
      child: CompositedTransformTarget(
        link: _link,
        child: OverlayPortal(
          controller: _menu,
          overlayChildBuilder: (context) => Positioned(
            width: 224,
            child: CompositedTransformFollower(
              link: _link,
              targetAnchor: Alignment.bottomRight,
              followerAnchor: Alignment.topRight,
              offset: const Offset(0, 8),
              child: TapRegion(
                groupId: _group,
                child: CallbackShortcuts(
                  bindings: {const SingleActivator(LogicalKeyboardKey.escape): () => _close(refocus: true)},
                  child: FocusTraversalGroup(
                    child: _AccountMenu(name: widget.name, onSignOut: _signOut, firstItem: _firstItem),
                  ),
                ),
              ),
            ),
          ),
          child: Semantics(
            container: true,
            child: Pressable(
              onPressed: _toggle,
              focusNode: _button,
              semanticLabel: 'Your account',
              builder: (context, s) => FocusRing(
                visible: s.focused,
                radius: AppRadii.kitMd,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(4, 4, 10, 4),
                  decoration: BoxDecoration(
                    color: s.pressed || _menu.isShowing ? AppColors.surface3 : (s.hovered ? AppColors.surface2 : null),
                    borderRadius: BorderRadius.circular(AppRadii.kitMd),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Avatar(name: widget.name),
                      const SizedBox(width: 10),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 220),
                        child: Text(
                          widget.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.body.copyWith(
                            fontWeight: FontWeight.w600,
                            height: 1.4,
                            color: AppColors.textPrimary,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      const Icon(LucideIcons.chevronDown, size: 16, color: AppColors.textLabel),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AccountMenu extends StatelessWidget {
  const _AccountMenu({required this.name, required this.onSignOut, required this.firstItem});

  final String name;
  final VoidCallback onSignOut;
  final FocusNode firstItem;

  @override
  Widget build(BuildContext context) {
    return DefaultTextStyle(
      style: appDefaultTextStyle,
      child: Semantics(
        container: true,
        explicitChildNodes: true,
        label: 'Account menu',
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 4),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(AppRadii.kitMd),
            border: Border.all(color: AppColors.border),
            boxShadow: AppShadows.lg,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
                child: Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.body.copyWith(fontWeight: FontWeight.w700, height: 1.43, color: AppColors.textPrimary),
                ),
              ),
              Pressable(
                onPressed: onSignOut,
                focusNode: firstItem,
                semanticLabel: 'Sign out',
                builder: (context, s) => Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: s.hovered || s.focused || s.pressed ? AppColors.surface2 : null,
                    border: const Border(top: BorderSide(color: AppColors.border)),
                  ),
                  child: Row(
                    children: [
                      const Icon(LucideIcons.logOut, size: 16, color: AppColors.textSecondary),
                      const SizedBox(width: 10),
                      Text(
                        'Sign out',
                        style: AppText.body.copyWith(
                          fontWeight: FontWeight.w600,
                          height: 1.43,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The large faint shield hanging off the bottom-right corner behind every page (AppShell.tsx:
/// `w-[min(55vw,560px)]`, -80 px bottom, -64 px right, 4.5 % opacity).
class _Watermark extends StatelessWidget {
  const _Watermark();

  @override
  Widget build(BuildContext context) {
    final width = math.min(MediaQuery.sizeOf(context).width * 0.55, 560.0);
    return Positioned(
      right: -64,
      bottom: -80,
      child: IgnorePointer(
        child: ExcludeSemantics(
          child: Opacity(opacity: 0.045, child: BrandLogo(size: width * 500 / 434)),
        ),
      ),
    );
  }
}

/// The way back from a page pushed over the shell ("Back to midterms", "Past papers"): the
/// website's link above a result (14/600 or 13/700, muted, an arrow).
class ShellBackLink extends StatelessWidget {
  const ShellBackLink({super.key, required this.label, required this.onPressed, this.fontSize = 13});

  final String label;
  final VoidCallback onPressed;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Pressable(
        onPressed: onPressed,
        semanticLabel: label,
        builder: (context, s) {
          final fg = s.hovered ? AppColors.ink : AppColors.mute;
          return FocusRing(
            visible: s.focused,
            radius: AppRadii.kitSm,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(LucideIcons.arrowLeft, size: fontSize + 2, color: fg),
                  const SizedBox(width: 6),
                  Text(
                    label,
                    style: AppText.body.copyWith(
                      fontSize: fontSize,
                      fontWeight: FontWeight.w700,
                      height: 1.4,
                      color: fg,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
