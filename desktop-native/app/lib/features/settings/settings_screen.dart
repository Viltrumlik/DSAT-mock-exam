// Settings / Diagnostics (architecture §2.3), the sidebar's third page: version and update
// channel, "Copy diagnostics" (one JSON document for support — no tokens, no answers), and
// "Delete data on this computer", which is blocked while answers saved here have not reached
// MasterSAT yet. Drawn in the website's UI kit (Geist, Card.tsx cards, Field.tsx labels).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/store/settings_store.dart';
import '../../core/store/unsent_work.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/toast.dart';
import '../../core/theme/tokens.dart';
import '../home/app_header.dart';
import '../home/update_controller.dart';
import '../shell/shell_page.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final AppServices _services;
  UnsentSummary? _unsent;
  bool _copying = false;
  bool _deleting = false;

  @override
  void initState() {
    super.initState();
    _services = AppScope.of(context);
    unawaited(_refreshUnsent());
  }

  Future<void> _refreshUnsent() async {
    final u = await _services.unsentWork.check();
    if (mounted) setState(() => _unsent = u);
  }

  Future<void> _copyDiagnostics() async {
    setState(() => _copying = true);
    try {
      await _services.copyToClipboard(await _services.diagnostics());
      _services.toasts.show('Diagnostics copied — paste them into your message to support.', tone: ToastTone.success);
    } catch (_) {
      _services.toasts.show("Couldn't copy the diagnostics. Try again.", tone: ToastTone.error);
    } finally {
      if (mounted) setState(() => _copying = false);
    }
  }

  Future<void> _setChannel(UpdateChannel c) async {
    final settings = _services.home.store?.settings;
    if (settings == null || settings.updateChannel == c) return;
    await settings.setUpdateChannel(c);
    _services.log.add('update', 'channel ${c.wire}');
    if (mounted) setState(() {});
    unawaited(_services.updates.checkAndDownload());
  }

  Future<void> _deleteData() async {
    final unsent = await _services.unsentWork.check();
    if (!mounted) return;
    if (!unsent.isEmpty) {
      setState(() => _unsent = unsent);
      await _showBlocked(unsent);
      return;
    }
    final confirmed = await showAppDialog<bool>(
      context,
      builder: (context) => AppDialog(
        icon: LucideIcons.trash2,
        danger: true,
        title: 'Delete data on this computer?',
        message: 'This signs you out and removes your saved tests, filters and settings from this computer. '
            'Your scores and results on MasterSAT stay exactly as they are.',
        actions: [
          AppButton(
            label: 'Cancel',
            tone: AppButtonTone.secondary,
            autofocus: true,
            onPressed: () => Navigator.of(context).pop(false),
          ),
          AppButton(
            label: 'Delete and sign out',
            tone: AppButtonTone.danger,
            onPressed: () => Navigator.of(context).pop(true),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _deleting = true);
    final blocked = await _services.deleteLocalData();
    if (blocked != null && mounted) {
      // Something was saved between the check and the delete: nothing was removed.
      setState(() {
        _deleting = false;
        _unsent = blocked;
      });
      await _showBlocked(blocked);
    }
  }

  Future<void> _showBlocked(UnsentSummary unsent) => showAppDialog<bool>(
        context,
        builder: (context) => UnsentWorkDialog(
          unsent: unsent,
          title: "Some answers haven't been sent yet",
          message: unsentMessage(unsent, 'Deleting the data now would lose them, so it has to wait until they are sent.'),
          keepLabel: 'Keep my data',
        ),
      );

  @override
  Widget build(BuildContext context) {
    final services = _services;
    return ShellPage(
      board: false,
      maxWidth: 760,
      children: [
        const HomeBanners(),
        const PageHeading(eyebrow: 'SETTINGS', title: 'Settings'),
        const SizedBox(height: 24),
        _AppCard(services: services, onChannel: (c) => unawaited(_setChannel(c))),
        const SizedBox(height: 16),
        _SettingsCard(
          icon: LucideIcons.clipboardList,
          title: 'Diagnostics',
          body: "If something isn't working, copy these details and send them to your teacher or "
              'MasterSAT support. They never include your password or your answers.',
          child: AppButton(
            label: 'Copy diagnostics',
            icon: LucideIcons.copy,
            tone: AppButtonTone.secondary,
            busy: _copying,
            busyLabel: 'Copying…',
            onPressed: () => unawaited(_copyDiagnostics()),
          ),
        ),
        const SizedBox(height: 16),
        _SettingsCard(
          icon: LucideIcons.hardDrive,
          title: 'Data on this computer',
          body: 'Your sign-in, a copy of your tests and anything waiting to be sent are kept on this '
              'computer so the app opens instantly and keeps working offline.',
          footer: _UnsentLine(unsent: _unsent),
          child: AppButton(
            label: 'Delete data on this computer',
            icon: LucideIcons.trash2,
            tone: AppButtonTone.dangerOutline,
            busy: _deleting,
            busyLabel: 'Deleting…',
            onPressed: () => unawaited(_deleteData()),
          ),
        ),
      ],
    );
  }
}

/// Version, update channel and update state.
class _AppCard extends StatelessWidget {
  const _AppCard({required this.services, required this.onChannel});

  final AppServices services;
  final ValueChanged<UpdateChannel> onChannel;

  @override
  Widget build(BuildContext context) {
    final updates = services.updates;
    final settings = services.home.store?.settings;
    return _SettingsCard(
      icon: LucideIcons.monitor,
      title: 'MasterSAT for Windows',
      child: ListenableBuilder(
        listenable: updates,
        builder: (context, _) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _Row(label: 'Version', child: Text(services.config.appVersion, style: _value)),
            _Row(
              label: 'Update channel',
              hint: 'Beta gets new versions first. Stay on Stable unless your teacher asks you to switch.',
              child: Align(
                alignment: Alignment.centerLeft,
                child: SegmentedFilter<UpdateChannel>(
                  label: '',
                  tray: AppColors.surface2,
                  selected: settings?.updateChannel ?? UpdateChannel.stable,
                  onChanged: onChannel,
                  options: const [
                    FilterOption(UpdateChannel.stable, 'Stable'),
                    FilterOption(UpdateChannel.beta, 'Beta'),
                  ],
                ),
              ),
            ),
            _Row(
              label: 'Updates',
              last: true,
              child: Row(
                children: [
                  Expanded(child: Text(updateStatusText(updates), style: _value)),
                  const SizedBox(width: 12),
                  if (updates.isReady)
                    AppButton(
                      label: 'Restart to update',
                      icon: LucideIcons.refreshCw,
                      size: AppButtonSize.small,
                      onPressed: updates.restartToUpdate,
                    )
                  else
                    AppButton(
                      label: 'Check for updates',
                      icon: LucideIcons.refreshCw,
                      tone: AppButtonTone.secondary,
                      size: AppButtonSize.small,
                      busy: updates.isBusy,
                      busyLabel: updates.phase == UpdatePhase.downloading ? 'Downloading…' : 'Checking…',
                      onPressed: () => unawaited(updates.checkAndDownload()),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static final _value = AppText.body.copyWith(fontWeight: FontWeight.w600, color: AppColors.textPrimary);
}

/// The one line that says where the updater is.
String updateStatusText(UpdateController u) => switch (u.phase) {
      UpdatePhase.idle => 'Not checked yet',
      UpdatePhase.checking => 'Checking for updates…',
      UpdatePhase.upToDate => "You're up to date",
      UpdatePhase.downloading => 'Downloading ${u.version ?? 'the update'}… ${u.percent}%',
      UpdatePhase.ready => '${u.version == null ? 'A new version' : 'Version ${u.version}'} is ready to install',
      UpdatePhase.failed => u.error ?? "Couldn't check for updates",
    };

class _UnsentLine extends StatelessWidget {
  const _UnsentLine({required this.unsent});

  final UnsentSummary? unsent;

  @override
  Widget build(BuildContext context) {
    final u = unsent;
    if (u == null) return const SizedBox.shrink();
    final clear = u.isEmpty;
    return Row(
      children: [
        Icon(clear ? LucideIcons.circleCheck : LucideIcons.cloudUpload,
            size: 15, color: clear ? AppColors.success : AppColors.warningForeground),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            clear
                ? 'Everything you did has reached MasterSAT.'
                : '${u.total} ${u.total == 1 ? 'item is' : 'items are'} waiting to be sent. '
                    'Keep the app open while you are online.',
            style: AppText.small.copyWith(color: clear ? AppColors.successForeground : AppColors.warningForeground),
          ),
        ),
      ],
    );
  }
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard({required this.icon, required this.title, this.body, required this.child, this.footer});

  final IconData icon;
  final String title;
  final String? body;
  final Widget child;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: AppColors.primarySoft, borderRadius: BorderRadius.circular(AppRadii.sm)),
                child: Icon(icon, size: 18, color: AppColors.primary),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: AppText.cardTitle.copyWith(fontWeight: FontWeight.w600, height: 1.4, color: AppColors.textPrimary),
                ),
              ),
            ],
          ),
          if (body != null) ...[
            const SizedBox(height: 10),
            Text(body!, style: AppText.body.copyWith(fontWeight: FontWeight.w400, height: 1.6, color: AppColors.textSecondary)),
          ],
          const SizedBox(height: 16),
          if (footer != null) ...[footer!, const SizedBox(height: 16)],
          Align(alignment: Alignment.centerLeft, child: child),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.child, this.hint, this.last = false});

  final String label;
  final Widget child;
  final String? hint;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        border: last ? null : const Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 160,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 34),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(label, style: AppText.body.copyWith(fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ConstrainedBox(constraints: const BoxConstraints(minHeight: 34), child: Align(alignment: Alignment.centerLeft, child: child)),
                if (hint != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(hint!, style: AppText.small.copyWith(fontWeight: FontWeight.w400, color: AppColors.textSecondary)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
