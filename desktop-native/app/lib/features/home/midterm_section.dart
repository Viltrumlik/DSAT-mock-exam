// Home → Midterms: rows grouped Available now / Scheduled / Missed / Past attempts (the
// website's MidtermList sections and badges; buckets from midterm_model.dart).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/models/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';
import 'midterm_model.dart';

class MidtermSection extends StatefulWidget {
  const MidtermSection({super.key, required this.midterms, required this.offline, required this.serverNow});

  final List<MidtermRow> midterms;

  /// Starting a midterm needs a connection (a lockdown session and the live module).
  final bool offline;

  /// The server's "now" (ServerClock), for the "starts in …" countdowns.
  final DateTime Function() serverNow;

  @override
  State<MidtermSection> createState() => _MidtermSectionState();
}

class _MidtermSectionState extends State<MidtermSection> {
  Timer? _tick;
  final Set<int> _unlockRefreshed = {};

  @override
  void initState() {
    super.initState();
    _syncTicker();
  }

  @override
  void didUpdateWidget(MidtermSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncTicker();
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  bool get _hasCountdown => widget.midterms.any(
      (m) => !m.submitted && !m.isOpen && m.isBeforeStart && !m.awaitingCode && m.availableAt != null);

  /// A 1 s tick only while a countdown is on screen.
  void _syncTicker() {
    if (_hasCountdown) {
      _tick ??= Timer.periodic(const Duration(seconds: 1), (_) => _onTick());
    } else {
      _tick?.cancel();
      _tick = null;
    }
  }

  void _onTick() {
    if (!mounted) return;
    final now = widget.serverNow();
    // A countdown that reaches zero asks the server (the website's onUnlock): a classroom
    // midterm can open before the teacher starts it, so enterability is the server's call.
    for (final m in widget.midterms) {
      final at = m.availableAt;
      if (at != null && m.isBeforeStart && !at.isAfter(now) && _unlockRefreshed.add(m.midtermId)) {
        unawaited(AppScope.of(context).home.refresh());
      }
    }
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final b = bucketMidterms(widget.midterms);
    final groups = <(String, MidtermCardKind, List<MidtermRow>, Color)>[
      ('Available now', MidtermCardKind.available, b.available, AppColors.indigo),
      ('Scheduled', MidtermCardKind.scheduled, b.scheduled, AppColors.faint),
      ('Missed', MidtermCardKind.missed, b.missed, AppColors.dzDanger),
      ('Past attempts', MidtermCardKind.past, b.past, AppColors.pastBadgeForeground),
    ].where((g) => g.$3.isNotEmpty).toList();
    final now = widget.serverNow();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(
          title: 'Midterms',
          hint: 'Each runs locked down — the app closes everything else until you finish.',
        ),
        if (groups.isEmpty)
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 22),
            child: Text(
              'No midterms yet. When your teacher assigns one, it appears here.',
              style: AppText.bodyMuted,
            ),
          )
        else
          for (final g in groups) ...[
            GroupHeader(label: g.$1, count: g.$3.length, dot: g.$4),
            for (final m in g.$3)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: MidtermRowCard(midterm: m, kind: g.$2, offline: widget.offline, now: now),
              ),
            const SizedBox(height: 14),
          ],
      ],
    );
  }
}

class MidtermRowCard extends StatelessWidget {
  const MidtermRowCard({super.key, required this.midterm, required this.kind, required this.offline, required this.now});

  final MidtermRow midterm;
  final MidtermCardKind kind;
  final bool offline;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final m = midterm;
    final math = !isReadingWriting(m.subject);
    final accent = math ? AppColors.teal : AppColors.indigo;
    final accentSoft = math ? AppColors.tealSoft : AppColors.indigoSoft;
    final (badgeFg, badgeBg) = switch (kind) {
      MidtermCardKind.available =>
        m.resitOpen ? (AppColors.resitForeground, AppColors.resitSoft) : (AppColors.indigoDeep, AppColors.indigoSoft),
      MidtermCardKind.scheduled => (AppColors.mute, AppColors.surface2),
      MidtermCardKind.missed => (AppColors.dzDanger, AppColors.missedBadge),
      MidtermCardKind.past => (AppColors.pastBadgeForeground, AppColors.pastBadge),
    };

    return Semantics(
      container: true,
      label: '${m.title}, ${midtermBadgeLabel(m, kind)}',
      child: AppCard(
        padding: const EdgeInsets.fromLTRB(16, 14, 18, 14),
        child: Row(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(color: accentSoft, borderRadius: BorderRadius.circular(14)),
                  child: Icon(math ? LucideIcons.calculator : LucideIcons.bookOpen, size: 21, color: accent),
                ),
                Positioned(
                  right: -4,
                  bottom: -4,
                  child: Container(
                    width: 20,
                    height: 20,
                    decoration: BoxDecoration(
                      color: AppColors.panel,
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.line),
                    ),
                    child: const Icon(LucideIcons.lock, size: 11, color: AppColors.mute),
                  ),
                ),
              ],
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(m.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.cardTitle),
                      ),
                      const SizedBox(width: 8),
                      StatusBadge(label: midtermBadgeLabel(m, kind), foreground: badgeFg, background: badgeBg),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(midtermMeta(m), maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.small),
                ],
              ),
            ),
            const SizedBox(width: 16),
            _trailing(context),
          ],
        ),
      ),
    );
  }

  Widget _trailing(BuildContext context) {
    final m = midterm;
    switch (kind) {
      case MidtermCardKind.available:
        final button = AppButton(
          label: midtermActionLabel(m),
          icon: isResumable(m) && !m.resitOpen ? LucideIcons.circlePlay : LucideIcons.play,
          tone: m.resitOpen ? AppButtonTone.resit : AppButtonTone.primary,
          onPressed: offline ? null : () => openExam(context, MidtermExamRequest(midterm: m)),
        );
        if (!offline) return button;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          mainAxisSize: MainAxisSize.min,
          children: [
            button,
            const SizedBox(height: 4),
            Text('Needs a connection to start', style: AppText.caption.copyWith(fontSize: 11)),
          ],
        );
      case MidtermCardKind.scheduled:
        final at = m.availableAt;
        final countdown = (!m.awaitingCode && at != null) ? countdownLabel(at, now) : null;
        return _Pill(
          icon: LucideIcons.lock,
          label: m.awaitingCode ? 'Waiting for teacher' : (at != null ? 'Opens ${_shortDay(at)}' : 'Scheduled'),
          caption: m.awaitingCode ? "Your teacher hasn't started this yet" : (countdown == null ? null : 'starts in $countdown'),
        );
      case MidtermCardKind.missed:
        final dl = m.deadline;
        return _Pill(
          icon: LucideIcons.lock,
          label: 'Deadline passed',
          caption: dl == null ? null : 'closed ${formatClosed(dl)}',
          danger: true,
        );
      case MidtermCardKind.past:
        final attemptId = m.attemptId;
        if (m.resultsVisible) {
          return Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text.rich(
                TextSpan(children: [
                  TextSpan(text: '${m.score ?? '—'}', style: AppText.heading.copyWith(fontSize: 21)),
                  TextSpan(text: ' / ${m.scoreCeiling}', style: AppText.small.copyWith(color: AppColors.faint)),
                ]),
              ),
              if (attemptId != null) ...[
                const SizedBox(width: 12),
                AppButton(
                  label: 'View result',
                  trailingIcon: LucideIcons.arrowRight,
                  tone: AppButtonTone.secondary,
                  size: AppButtonSize.small,
                  onPressed: () => openMidtermResult(context, row: m),
                ),
              ],
            ],
          );
        }
        if (attemptId != null) {
          return AppButton(
            label: 'Awaiting results',
            trailingIcon: LucideIcons.arrowRight,
            tone: AppButtonTone.secondary,
            size: AppButtonSize.small,
            onPressed: () => openMidtermResult(context, row: m),
          );
        }
        return Text('Awaiting results', style: AppText.small.copyWith(color: AppColors.faint));
    }
  }

  static String _shortDay(DateTime t) {
    final l = t.toLocal();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${months[l.month - 1]} ${l.day}';
  }
}

/// A quiet, non-interactive status pill with an optional caption underneath.
class _Pill extends StatelessWidget {
  const _Pill({required this.icon, required this.label, this.caption, this.danger = false});

  final IconData icon;
  final String label;
  final String? caption;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final fg = danger ? AppColors.dzDanger : AppColors.faint;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: danger ? const Color(0xFFFDF2F2) : null,
            borderRadius: BorderRadius.circular(AppRadii.button),
            border: Border.all(color: danger ? const Color(0xFFF0D4D4) : AppColors.line),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 13, color: fg),
              const SizedBox(width: 6),
              Text(label, style: AppText.small.copyWith(color: fg)),
            ],
          ),
        ),
        if (caption != null) ...[
          const SizedBox(height: 4),
          Text(caption!, style: AppText.caption.copyWith(fontSize: 11)),
        ],
      ],
    );
  }
}
