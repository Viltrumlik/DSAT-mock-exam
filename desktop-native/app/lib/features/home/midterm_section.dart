// Midterms: the website's MidtermList (app/(main)/midterm/MidtermList.tsx) — the filter tabs
// (All / Available now / Scheduled / Past) and the midterms as a timeline: one section per
// bucket (Available now / Scheduled / Missed / Past attempts; buckets from midterm_model.dart),
// each with a 10 px dot, its title and count, and a hairline rail through the rows' markers.
// Rows: white, radius 16, --dz-border, a 40 px slate-100 tile, the title (16/800) with its
// badge, the meta line, and the row's action on the right.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/models/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';
import 'midterm_model.dart';

/// The filter tabs above the timeline.
enum MidtermTab {
  all('All'),
  available('Available now'),
  scheduled('Scheduled'),
  past('Past');

  const MidtermTab(this.label);
  final String label;
}

/// MidtermList.tsx's own colours (`C` and the badge/dot literals).
abstract final class _C {
  static const navy = Color(0xFF0F1729);
  static const blue = Color(0xFF2A68C0);
  static const slate = Color(0xFF64748B);
  static const border = Color(0xFFE7EBF3);
  static const scheduledDot = Color(0xFF94A3B8);
  static const pastDot = Color(0xFF0B7A4F);
  static const missedDot = Color(0xFFB91C1C);
}

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
  MidtermTab _tab = MidtermTab.all;

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

  bool _shows(MidtermTab t) => _tab == MidtermTab.all || _tab == t;

  @override
  Widget build(BuildContext context) {
    final b = bucketMidterms(widget.midterms);
    final groups = <(String, MidtermCardKind, List<MidtermRow>, Color)>[
      if (_shows(MidtermTab.available)) ('Available now', MidtermCardKind.available, b.available, _C.blue),
      if (_shows(MidtermTab.scheduled)) ('Scheduled', MidtermCardKind.scheduled, b.scheduled, _C.scheduledDot),
      if (_shows(MidtermTab.past)) ('Missed', MidtermCardKind.missed, b.missed, _C.missedDot),
      if (_shows(MidtermTab.past)) ('Past attempts', MidtermCardKind.past, b.past, _C.pastDot),
    ].where((g) => g.$3.isNotEmpty).toList();
    final now = widget.serverNow();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final t in MidtermTab.values) _TabButton(tab: t, active: t == _tab, onTap: () => setState(() => _tab = t)),
          ],
        ),
        const SizedBox(height: 32),
        if (widget.midterms.isEmpty)
          Container(
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              color: AppColors.panel,
              borderRadius: BorderRadius.circular(AppRadii.kitLg),
              border: Border.all(color: _C.border),
            ),
            child: Text(
              'No midterms yet. When your teacher assigns one, it appears here.',
              textAlign: TextAlign.center,
              style: AppText.body.copyWith(fontWeight: FontWeight.w400, color: AppColors.slate500),
            ),
          )
        else
          for (final g in groups)
            _TimelineSection(
              title: g.$1,
              dot: g.$4,
              rows: [
                for (final m in g.$3) MidtermRowCard(midterm: m, kind: g.$2, offline: widget.offline, now: now),
              ],
            ),
      ],
    );
  }
}

/// A filter tab: `rounded-[11px] border px-[17px] py-[10px] text-sm font-semibold`; the active
/// one is filled blue.
class _TabButton extends StatelessWidget {
  const _TabButton({required this.tab, required this.active, required this.onTap});

  final MidtermTab tab;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onPressed: onTap,
      selected: active,
      semanticLabel: tab.label,
      builder: (context, s) => FocusRing(
        visible: s.focused,
        radius: AppRadii.button,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 10),
          decoration: BoxDecoration(
            color: active ? _C.blue : (s.hovered || s.pressed ? AppColors.surface : AppColors.panel),
            borderRadius: BorderRadius.circular(AppRadii.button),
            border: Border.all(color: active ? _C.blue : _C.border),
          ),
          child: Text(
            tab.label,
            style: AppText.body.copyWith(
              fontWeight: FontWeight.w600,
              height: 1.43,
              color: active ? AppColors.onPrimary : (s.hovered ? _C.navy : _C.slate),
            ),
          ),
        ),
      ),
    );
  }
}

/// One bucket: the header (a 10 px dot, the title 14/700, the count 13/600) and the rows on a
/// 1 px rail (`left-[5px] top-4 bottom-4 bg-slate-200`), 12 apart, 32 below.
class _TimelineSection extends StatelessWidget {
  const _TimelineSection({required this.title, required this.dot, required this.rows});

  final String title;
  final Color dot;
  final List<MidtermRowCard> rows;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            key: ValueKey('midterms.section.$title'),
            header: true,
            child: Row(
              children: [
                Container(width: 10, height: 10, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
                const SizedBox(width: 8),
                Text(title, style: AppText.body.copyWith(fontWeight: FontWeight.w700, height: 1.43, color: _C.slate)),
                const SizedBox(width: 8),
                Text('${rows.length}', style: AppText.small.copyWith(color: AppColors.slate400)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Stack(
            children: [
              const Positioned(
                left: 5,
                top: 16,
                bottom: 16,
                width: 1,
                child: ColoredBox(color: AppColors.slate200),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final r in rows) ...[
                    if (r != rows.first) const SizedBox(height: 12),
                    _TimelineRow(dot: _markerFor(r.kind), child: r),
                  ],
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  static Color _markerFor(MidtermCardKind kind) => switch (kind) {
        MidtermCardKind.available => _C.blue,
        MidtermCardKind.scheduled => _C.scheduledDot,
        MidtermCardKind.missed => _C.missedDot,
        MidtermCardKind.past => _C.pastDot,
      };
}

/// A row on the rail: `pl-7`, a 12 px white marker ringed in the bucket's colour, centred on
/// the card.
class _TimelineRow extends StatelessWidget {
  const _TimelineRow({required this.dot, required this.child});

  final Color dot;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.centerLeft,
      children: [
        Padding(padding: const EdgeInsets.only(left: 28), child: child),
        Container(
          width: 12,
          height: 12,
          decoration: BoxDecoration(
            color: AppColors.panel,
            shape: BoxShape.circle,
            border: Border.all(color: dot, width: 2),
          ),
        ),
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
    // MidtermList.tsx `Badge`: rounded-md px-2.5 py-0.5, 11/700.
    final (badgeFg, badgeBg) = switch (kind) {
      MidtermCardKind.available =>
        m.resitOpen ? (AppColors.resitForeground, AppColors.resitSoft) : (AppColors.indigoDeep, AppColors.indigoSoft),
      MidtermCardKind.scheduled => (_C.slate, AppColors.slate100),
      MidtermCardKind.missed => (AppColors.dzDanger, AppColors.missedBadge),
      MidtermCardKind.past => (AppColors.pastBadgeForeground, AppColors.pastBadge),
    };

    return Semantics(
      container: true,
      label: '${m.title}, ${midtermBadgeLabel(m, kind)}',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        decoration: BoxDecoration(
          color: AppColors.panel,
          borderRadius: BorderRadius.circular(AppRadii.kitLg),
          border: Border.all(color: _C.border),
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: AppColors.slate100, borderRadius: BorderRadius.circular(AppRadii.kitMd)),
              child: const Icon(LucideIcons.fileText, size: 20, color: AppColors.slate500),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          m.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.cardTitle.copyWith(height: 1.5, color: _C.navy),
                        ),
                      ),
                      const SizedBox(width: 8),
                      StatusBadge(
                        label: midtermBadgeLabel(m, kind),
                        foreground: badgeFg,
                        background: badgeBg,
                        weight: FontWeight.w700,
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                        radius: 6,
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(midtermMeta(m), maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.small.copyWith(color: _C.slate)),
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
          trailingIcon: LucideIcons.arrowRight,
          size: AppButtonSize.row,
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
            Text('Needs a connection to start', style: AppText.caption.copyWith(fontSize: 11, color: _C.slate)),
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
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text('${m.score ?? '—'}', style: AppText.score.copyWith(fontSize: 20, letterSpacing: 0, color: _C.navy)),
              Text(' / ${m.scoreCeiling}', style: AppText.caption.copyWith(color: AppColors.slate400)),
              if (attemptId != null) ...[
                const SizedBox(width: 16),
                AppButton(
                  label: 'View result',
                  trailingIcon: LucideIcons.arrowRight,
                  tone: AppButtonTone.line,
                  size: AppButtonSize.link,
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
            tone: AppButtonTone.line,
            size: AppButtonSize.link,
            onPressed: () => openMidtermResult(context, row: m),
          );
        }
        return const _Pill(label: 'Awaiting results');
    }
  }

  static String _shortDay(DateTime t) {
    final l = t.toLocal();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${months[l.month - 1]} ${l.day}';
  }
}

/// A quiet, non-interactive status pill (`rounded-xl border px-[18px] py-[11px] text-sm
/// font-semibold`) with an optional 11 px caption underneath.
class _Pill extends StatelessWidget {
  const _Pill({required this.label, this.icon, this.caption, this.danger = false});

  final IconData? icon;
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
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 11),
          decoration: BoxDecoration(
            color: danger ? const Color(0xFFFDF2F2) : null,
            borderRadius: BorderRadius.circular(AppRadii.kitMd),
            border: Border.all(color: danger ? const Color(0xFFF0D4D4) : _C.border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 14, color: fg), const SizedBox(width: 6)],
              Text(label, style: AppText.body.copyWith(fontWeight: FontWeight.w600, height: 1.43, color: fg)),
            ],
          ),
        ),
        if (caption != null) ...[
          const SizedBox(height: 4),
          Text(
            caption!,
            style: AppText.caption.copyWith(fontSize: 11, color: danger ? AppColors.slate400 : _C.slate),
          ),
        ],
      ],
    );
  }
}
