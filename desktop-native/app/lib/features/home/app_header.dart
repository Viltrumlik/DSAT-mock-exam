// The bar across the top of every screen outside the exam: logo and wordmark, an optional
// Back, and on the right the student's name, Settings and Sign out.
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/store/unsent_work.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/brand.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';

class AppHeader extends StatelessWidget {
  const AppHeader({super.key, this.backLabel, this.onBack, this.showSettings = true});

  /// "Your tests" — shows a Back button before the logo.
  final String? backLabel;
  final VoidCallback? onBack;
  final bool showSettings;

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      decoration: const BoxDecoration(
        color: AppColors.panel,
        border: Border(bottom: BorderSide(color: AppColors.line)),
      ),
      child: Row(
        children: [
          if (onBack != null) ...[
            AppLinkButton(label: backLabel ?? 'Back', icon: LucideIcons.arrowLeft, onPressed: onBack),
            const SizedBox(width: 12),
            const SizedBox(height: 22, child: VerticalDivider(width: 1, color: AppColors.line)),
            const SizedBox(width: 16),
          ],
          const BrandWordmark(size: 26),
          const Spacer(),
          ListenableBuilder(
            listenable: Listenable.merge([services.home, services.auth]),
            builder: (context, _) {
              final name = services.home.home?.student.fullName ?? services.auth.session?.displayName;
              return Row(
                children: [
                  if (name != null && name.isNotEmpty) ...[
                    const Icon(LucideIcons.circleUser, size: 17, color: AppColors.mute),
                    const SizedBox(width: 7),
                    Text(name, style: AppText.small.copyWith(color: AppColors.ink, fontWeight: FontWeight.w700)),
                    const SizedBox(width: 14),
                  ],
                  if (showSettings) ...[
                    AppIconButton(
                      icon: LucideIcons.settings,
                      semanticLabel: 'Settings',
                      onPressed: () => openSettings(context),
                    ),
                    const SizedBox(width: 4),
                  ],
                  AppLinkButton(
                    label: 'Sign out',
                    icon: LucideIcons.logOut,
                    onPressed: () => confirmSignOut(context),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

/// Signs out, or — when answers saved on this computer have not reached MasterSAT yet — asks
/// first, with an explicit "Sign out anyway" (design §1.12).
Future<void> confirmSignOut(BuildContext context) async {
  final services = AppScope.of(context);
  final result = await services.auth.signOut();
  if (result is! SignOutBlocked || !context.mounted) return;
  final force = await showAppDialog<bool>(
    context,
    builder: (context) => UnsentWorkDialog(
      unsent: result.unsent,
      title: "Some answers haven't been sent yet",
      message: unsentMessage(result.unsent,
          'Signing out now would leave them on this computer, where they can no longer be sent.'),
      keepLabel: 'Stay signed in',
      proceedLabel: 'Sign out anyway',
    ),
  );
  if (force == true) await services.auth.signOut(force: true);
}

/// "3 answers are saved on this computer but MasterSAT hasn't received them yet. Connect to
/// the internet and keep the app open until they're sent."
String unsentMessage(UnsentSummary unsent, String consequence) {
  final n = unsent.total;
  final what = n == 1 ? '1 item is' : '$n items are';
  return '$what saved on this computer, but MasterSAT hasn\'t received ${n == 1 ? 'it' : 'them'} yet. '
      'Connect to the internet and keep the app open until ${n == 1 ? 'it is' : 'they are'} sent. $consequence';
}

/// The "work not sent yet" dialog (sign-out and "Delete data on this computer").
class UnsentWorkDialog extends StatelessWidget {
  const UnsentWorkDialog({
    super.key,
    required this.unsent,
    required this.title,
    required this.message,
    required this.keepLabel,
    this.proceedLabel,
  });

  final UnsentSummary unsent;
  final String title;
  final String message;
  final String keepLabel;

  /// The destructive way through; null = no way through (Delete data).
  final String? proceedLabel;

  @override
  Widget build(BuildContext context) {
    return AppDialog(
      icon: LucideIcons.cloudUpload,
      title: title,
      message: message,
      actions: [
        if (proceedLabel != null)
          AppButton(
            label: proceedLabel!,
            tone: AppButtonTone.dangerOutline,
            onPressed: () => Navigator.of(context).pop(true),
          ),
        AppButton(label: keepLabel, autofocus: true, onPressed: () => Navigator.of(context).pop(false)),
      ],
    );
  }
}
