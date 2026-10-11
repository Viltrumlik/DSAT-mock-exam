// "Update required": a blocking card over the whole app when the server answers 426, or
// Home's policy says `update: "required"` (architecture §6). One-click Velopack update with
// real download progress, and the website's installer link as the fallback.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/api/v1_api.dart';
import '../../core/models/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/brand.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';
import 'update_controller.dart';

/// Shows [UpdateRequiredCard] over [child] while an update is required.
class UpdateRequiredGate extends StatelessWidget {
  const UpdateRequiredGate({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    return ListenableBuilder(
      listenable: Listenable.merge([services.updates.required, services.home]),
      builder: (context, _) {
        final gate = services.updates.required.value;
        final policy = services.home.home?.app;
        final required = gate != null || policy?.update == AppUpdate.required;
        if (!required) return child;
        return Stack(
          children: [
            ExcludeFocus(child: ExcludeSemantics(child: child)),
            const Positioned.fill(child: ColoredBox(color: AppColors.scrim)),
            Positioned.fill(
              child: UpdateRequiredCard(
                updates: services.updates,
                detail: gate?.detail ?? (policy?.message.trim().isNotEmpty ?? false ? policy!.message.trim() : null),
                updateUrl: (gate?.updateUrl.isNotEmpty ?? false) ? gate!.updateUrl : policy?.updateUrl,
                minimumVersion: gate?.minimumVersion ?? policy?.minimumVersion,
              ),
            ),
          ],
        );
      },
    );
  }
}

class UpdateRequiredCard extends StatelessWidget {
  const UpdateRequiredCard({super.key, required this.updates, this.detail, this.updateUrl, this.minimumVersion});

  final UpdateController updates;
  final String? detail;
  final String? updateUrl;
  final String? minimumVersion;

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Container(
          margin: const EdgeInsets.all(24),
          padding: const EdgeInsets.fromLTRB(28, 26, 28, 24),
          decoration: BoxDecoration(
            color: AppColors.panel,
            borderRadius: BorderRadius.circular(AppRadii.xl),
            boxShadow: dialogShadow,
          ),
          child: ListenableBuilder(
            listenable: updates,
            builder: (context, _) {
              final phase = updates.phase;
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const BrandLogo(size: 34),
                  const SizedBox(height: 16),
                  Text('Update required', style: AppText.heading.copyWith(fontSize: 22)),
                  const SizedBox(height: 8),
                  Text(
                    detail ??
                        'This version of MasterSAT is out of date. Update to keep going — it only takes a minute, and your saved answers stay on this computer.',
                    style: AppText.bodyMuted.copyWith(height: 1.5, color: AppColors.textSecondary),
                  ),
                  if (minimumVersion != null) ...[
                    const SizedBox(height: 6),
                    Text('You have ${services.config.appVersion}; version $minimumVersion or newer is needed.',
                        style: AppText.caption),
                  ],
                  const SizedBox(height: 18),
                  if (phase == UpdatePhase.downloading) ...[
                    Text('Downloading the update… ${updates.percent}%', style: AppText.small.copyWith(color: AppColors.ink)),
                    const SizedBox(height: 8),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(3),
                      child: LinearProgressIndicator(
                        value: updates.percent / 100,
                        minHeight: 6,
                        color: AppColors.indigo,
                        backgroundColor: AppColors.indigoSoft,
                      ),
                    ),
                    const SizedBox(height: 18),
                  ],
                  if (phase == UpdatePhase.failed) ...[
                    Text(updates.error ?? 'The update could not be downloaded.',
                        style: AppText.small.copyWith(color: AppColors.dangerForeground)),
                    const SizedBox(height: 14),
                  ],
                  if (phase == UpdatePhase.upToDate) ...[
                    Text("No update is ready for this computer yet. Download the installer from the website instead.",
                        style: AppText.small),
                    const SizedBox(height: 14),
                  ],
                  Row(
                    children: [
                      if (phase == UpdatePhase.ready)
                        AppButton(label: 'Restart to update', icon: LucideIcons.refreshCw, onPressed: updates.restartToUpdate)
                      else
                        AppButton(
                          label: phase == UpdatePhase.failed ? 'Try again' : 'Update now',
                          icon: LucideIcons.download,
                          busy: updates.isBusy,
                          busyLabel: phase == UpdatePhase.checking ? 'Checking…' : 'Downloading…',
                          onPressed: () => unawaited(updates.checkAndDownload()),
                        ),
                      const SizedBox(width: 10),
                      if (updateUrl != null && updateUrl!.isNotEmpty)
                        AppButton(
                          label: 'Download from the website',
                          tone: AppButtonTone.secondary,
                          onPressed: () {
                            final open = services.openExternal;
                            if (open != null) unawaited(open(Uri.parse(updateUrl!)));
                          },
                        ),
                    ],
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

/// Whether [e] means this build must update (used by screens that catch API errors).
bool isUpdateRequired(Object e) => e is UpdateRequired;
