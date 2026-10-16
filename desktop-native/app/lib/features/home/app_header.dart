// Signing out, from the shell's account menu or its sidebar (features/shell/app_shell.dart),
// and the "work not sent yet" dialog it shares with Settings → "Delete data on this computer".
// (The old top header that lived here gave way to the shell's sidebar and top bar.)
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/store/unsent_work.dart';
import '../../core/theme/controls.dart';

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
