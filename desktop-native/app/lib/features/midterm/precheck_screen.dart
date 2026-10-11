// The last screen before a midterm (website DesktopScreens.tsx `DesktopPrecheckScreen`, 0.1.0
// LockdownScreens.tsx `PrecheckScreen`): what must change on this computer, fixed in place, and
// the one button that locks it down. The check re-runs every two seconds, so closing Telegram or
// unplugging a projector turns its row green without a click; a closable app gets its own Close
// button (`ms_close_app`).
import 'dart:async';

import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../exam/engine/lockdown_controller.dart';
import '../../exam/engine/midterm_engine.dart' show isLowBattery;
import '../../native/native_bridge.dart';
import 'midterm_copy.dart';
import 'midterm_ui.dart';

class MidtermPrecheckScreen extends StatefulWidget {
  const MidtermPrecheckScreen({
    super.key,
    required this.native,
    required this.resume,
    required this.onContinue,
    this.onBack,
    this.refreshEvery = const Duration(seconds: 2),
  });

  final NativeBridge native;

  /// The paper is already running (the app was reopened mid-midterm, or the lock was lost).
  final bool resume;

  /// Lock the machine and continue. Throws [PrecheckFailed] when the machine is not ready, or
  /// whatever the server or the lock refused (shown under the checklist).
  final Future<void> Function() onContinue;

  /// Back (releases the machine if this screen locked it). Disabled while locking.
  final VoidCallback? onBack;
  final Duration refreshEvery;

  @override
  State<MidtermPrecheckScreen> createState() => _MidtermPrecheckScreenState();
}

class _MidtermPrecheckScreenState extends State<MidtermPrecheckScreen> {
  PrecheckReport? _report;
  BatteryStatus? _battery;
  bool _busy = false;
  String? _closing;
  String? _error;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(widget.refreshEvery, (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _refresh() {
    if (!mounted) return;
    PrecheckReport? report;
    BatteryStatus? battery;
    var failed = false;
    try {
      report = widget.native.precheck();
    } on Object {
      failed = true;
    }
    try {
      final b = widget.native.battery();
      battery = b != null && b.hasBattery ? b : null;
    } on Object {
      battery = _battery; // keep the last reading
    }
    setState(() {
      if (report != null) _report = report;
      if (failed) {
        _error = MidtermCopy.cannotCheck;
      } else if (_error == MidtermCopy.cannotCheck) {
        _error = null;
      }
      _battery = battery;
    });
  }

  Future<void> _closeApp(String exe) async {
    setState(() => _closing = exe);
    // Let "Closing…" paint before the (synchronous) native call.
    await SchedulerBinding.instance.endOfFrame;
    try {
      widget.native.closeApp(exe);
    } on Object {
      // The next check shows whether it closed.
    }
    if (!mounted) return;
    setState(() => _closing = null);
    _refresh();
  }

  Future<void> _proceed() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onContinue();
    } on PrecheckFailed catch (e) {
      if (mounted) setState(() => _report = e.report);
    } on Object catch (e) {
      if (mounted) setState(() => _error = precheckErrorText(e));
    } finally {
      // Whatever happened, the student gets their buttons back: a continue that returned
      // without leaving this screen must not strand them on "Locking…".
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final report = _report;
    final battery = _battery;
    final rows = <Widget>[];
    if (report == null) {
      rows.add(Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(children: [
          const Icon(LucideIcons.refreshCw, size: 16, color: MidtermColors.slate500),
          const SizedBox(width: 12),
          Text(MidtermCopy.checking, style: MidtermText.size(14, weight: FontWeight.w600, color: MidtermColors.slate500)),
        ]),
      ));
    } else {
      final oneScreen = report.displays <= 1;
      rows.add(_CheckRow(
        state: oneScreen ? _RowState.ok : _RowState.fix,
        title: oneScreen ? MidtermCopy.oneScreen : MidtermCopy.screensConnected(report.displays),
        hint: oneScreen ? null : MidtermCopy.disconnectScreen,
      ));
      if (report.remote) {
        rows.add(const _CheckRow(state: _RowState.fix, title: MidtermCopy.remoteTitle, hint: MidtermCopy.remoteHint));
      }
      if (report.vm) {
        rows.add(const _CheckRow(state: _RowState.fix, title: MidtermCopy.vmTitle, hint: MidtermCopy.vmHint));
      }
      if (report.apps.isEmpty) {
        rows.add(const _CheckRow(state: _RowState.ok, title: MidtermCopy.noApps));
      } else {
        for (final app in report.apps) {
          rows.add(_CheckRow(
            key: ValueKey('app:${app.exe}'),
            state: _RowState.fix,
            title: MidtermCopy.closeApp(app.name),
            hint: app.closable ? null : MidtermCopy.closeFromTray(app.name),
            action: app.closable
                ? MidtermButton(
                    label: _closing == app.exe ? MidtermCopy.closing : MidtermCopy.close,
                    kind: MidtermButtonKind.outline,
                    expand: false,
                    textSize: 14,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    semanticLabel: MidtermCopy.closeApp(app.name),
                    onPressed: _closing == app.exe ? null : () => unawaited(_closeApp(app.exe)),
                  )
                : null,
          ));
        }
      }
      if (battery != null) {
        final low = isLowBattery(battery);
        rows.add(_CheckRow(
          state: low ? _RowState.warn : _RowState.ok,
          title: MidtermCopy.battery(battery.percent, charging: battery.charging),
          hint: low ? MidtermCopy.plugIn : null,
        ));
      }
    }

    return MidtermFrame(
      children: [
        const IconBadge(LucideIcons.lock),
        MidtermTitle(widget.resume ? MidtermCopy.precheckResumeTitle : MidtermCopy.precheckTitle),
        const MidtermLead(MidtermCopy.precheckLead),
        const SizedBox(height: 24),
        DecoratedBox(
          decoration: const BoxDecoration(
            border: Border.symmetric(horizontal: BorderSide(color: MidtermColors.slate100)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < rows.length; i++)
                i == 0
                    ? rows[i]
                    : DecoratedBox(
                        decoration: const BoxDecoration(
                          border: Border(top: BorderSide(color: MidtermColors.slate100)),
                        ),
                        child: rows[i],
                      ),
            ],
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 16),
            child: Text(
              _error!,
              textAlign: TextAlign.center,
              style: MidtermText.size(14, weight: FontWeight.w600, color: MidtermColors.red600),
            ),
          ),
        const SizedBox(height: 28),
        MidtermButton(
          label: _busy
              ? MidtermCopy.locking
              : widget.resume
                  ? MidtermCopy.lockAndResume
                  : MidtermCopy.lockAndStart,
          icon: LucideIcons.lock,
          onPressed: (report?.ok ?? false) && !_busy ? () => unawaited(_proceed()) : null,
        ),
        if (widget.onBack != null) ...[
          const SizedBox(height: 16),
          Center(
            child: MidtermLinkButton(
              label: MidtermCopy.back,
              icon: LucideIcons.arrowLeft,
              // Not while locking: Back mid-"Locking…" let the start land behind the student.
              onPressed: _busy ? null : widget.onBack,
            ),
          ),
        ],
      ],
    );
  }
}

enum _RowState { ok, fix, warn }

class _CheckRow extends StatelessWidget {
  const _CheckRow({super.key, required this.state, required this.title, this.hint, this.action});

  final _RowState state;
  final String title;
  final String? hint;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final icon = switch (state) {
      _RowState.ok => const Icon(LucideIcons.circleCheck, size: 20, color: MidtermColors.green700),
      _RowState.warn => const Icon(LucideIcons.triangleAlert, size: 20, color: MidtermColors.amber600),
      _RowState.fix => const Icon(LucideIcons.circleX, size: 20, color: MidtermColors.red600),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(padding: const EdgeInsets.only(top: 2), child: icon),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: MidtermText.size(14, weight: FontWeight.w700, color: MidtermColors.slate900)),
                if (hint != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(hint!, style: MidtermText.size(14, color: MidtermColors.slate600)),
                  ),
              ],
            ),
          ),
          if (action != null) ...[const SizedBox(width: 12), action!],
        ],
      ),
    );
  }
}
