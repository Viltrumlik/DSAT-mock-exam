// The midterm rules — the FIRST thing a student sees (the access code is asked for only after
// this screen). Ported from the website's MidtermRulesScreen.tsx and 0.1.0's copy of it: same
// copy, same layout, no Back (as on the website). Every rule stated is one the platform
// enforces; the off-screen numbers, the calculator rule, the pass mark and the retake line all
// come from the server's `rules` block.
import 'package:flutter/widgets.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/models/models.dart';
import '../../exam/session_contract.dart';
import 'midterm_copy.dart';
import 'midterm_ui.dart';

class MidtermRulesScreen extends StatelessWidget {
  const MidtermRulesScreen({
    super.key,
    required this.rules,
    required this.requiresCode,
    required this.onProceed,
    this.scoringScale,
    this.passMark,
    this.isRetake,
  });

  final MidtermRules rules;

  /// Unknown until prepare answers — the caller passes true then, so no one is told to start
  /// without a code they will be asked for.
  final bool requiresCode;
  final VoidCallback onProceed;

  /// Overrides for [MidtermRules.scoringScale], [MidtermRules.passMark] and
  /// [MidtermRules.isRetake]; null (the default) reads the server's `rules`.
  final String? scoringScale;
  final int? passMark;
  final bool? isRetake;

  @override
  Widget build(BuildContext context) {
    final subject = subjectLabelFor(rules.subject);
    final minutes = rules.durationsMin.fold<int>(0, (s, m) => s + m);
    final scale = scoringScale ?? rules.scoringScale;
    final mark = passMark ?? rules.passMark;
    final retake = isRetake ?? rules.isRetake;
    // Quote a pass mark ONLY when the scale is known (the website's rule: the two scales don't
    // share a floor, so a guess would put a number in front of the student that the server
    // would then disagree with) — and only when the sitting has one: the server resolves the
    // scale default itself, so a null mark means the sitting is not judged (a pre-midterm).
    final passLabel = scale == null || mark == null ? null : midtermPassMarkLabel(scale, mark);
    final grace = rules.offscreenGraceSeconds > 0 ? rules.offscreenGraceSeconds : midtermOffscreenGraceSeconds;
    final limit = rules.offscreenLimit > 0 ? rules.offscreenLimit : midtermOffscreenViolationLimit;

    final required = [
      const _Rule(LucideIcons.batteryCharging, MidtermCopy.requiredDevice),
      const _Rule(LucideIcons.wifi, MidtermCopy.requiredInternet),
      if (requiresCode) const _Rule(LucideIcons.keyRound, MidtermCopy.requiredCode),
    ];
    final allowed = [
      const _Rule(LucideIcons.notebookPen, MidtermCopy.allowedPaper),
      const _Rule(LucideIcons.flag, MidtermCopy.allowedFlag),
      if (rules.calculator != null)
        _Rule(
          LucideIcons.calculator,
          rules.calculator == CalculatorMode.scientific ? MidtermCopy.allowedScientific : MidtermCopy.allowedCalculator,
        ),
    ];
    final prohibited = [
      // A Math paper with no calculator (Foundation since 2026-10-11, the learning center's
      // request: it is worked by hand) says so FIRST, rather than only leaving the calculator
      // out of Allowed — a student who has had Desmos on every other Math paper reads a missing
      // line as an oversight and goes looking for the button. R&W gets no calculator line.
      if (rules.isMath && rules.calculator == null)
        const _Rule(LucideIcons.calculator, MidtermCopy.prohibitedCalculatorByHand),
      const _Rule(LucideIcons.monitorX, MidtermCopy.prohibitedApps),
      const _Rule(LucideIcons.bookX, MidtermCopy.prohibitedNotes),
      const _Rule(LucideIcons.smartphone, MidtermCopy.prohibitedDevices),
      const _Rule(LucideIcons.camera, MidtermCopy.prohibitedRecording),
      _Rule(LucideIcons.ban, MidtermCopy.prohibitedLeaving(grace: grace, limit: limit)),
    ];

    return MidtermPage(
      child: LayoutBuilder(builder: (context, c) {
        final wide = c.maxWidth >= 768; // Tailwind `md:`
        return SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 32),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 896),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    MidtermCopy.rulesEyebrow.toUpperCase(),
                    textAlign: TextAlign.center,
                    style: MidtermText.size(12, weight: FontWeight.w700, color: MidtermColors.blue700)
                        .copyWith(letterSpacing: 12 * 0.2),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    rules.title.isEmpty ? 'Midterm' : rules.title,
                    textAlign: TextAlign.center,
                    style: MidtermText.size(30, weight: FontWeight.w700, tracking: MidtermText.tight),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    MidtermCopy.rulesLead(subject),
                    textAlign: TextAlign.center,
                    style: MidtermText.size(14, weight: FontWeight.w500, color: MidtermColors.slate500),
                  ),
                  const SizedBox(height: 24),
                  Center(
                    child: ConstrainedBox(
                      constraints: BoxConstraints(maxWidth: passLabel != null ? 672 : 448),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: _gap([
                          Expanded(
                            child: _StatTile(
                              icon: LucideIcons.clock,
                              value: minutes > 0 ? '$minutes min' : '—',
                              label: MidtermCopy.time,
                              // Spell the split out: each module ends at its own buzzer.
                              detail: rules.durationsMin.length > 1 ? '${rules.durationsMin.join(' + ')} min' : null,
                            ),
                          ),
                          Expanded(
                            child: _StatTile(
                              icon: LucideIcons.listChecks,
                              value: rules.questionCount > 0 ? '${rules.questionCount}' : '—',
                              label: MidtermCopy.questions,
                            ),
                          ),
                          if (passLabel != null)
                            Expanded(
                              child: _StatTile(icon: LucideIcons.target, value: passLabel, label: MidtermCopy.toPass),
                            ),
                        ], 12),
                      ),
                    ),
                  ),
                  const SizedBox(height: 32),
                  _columns(
                    wide: wide,
                    gap: 20,
                    children: [
                      MidtermCard(
                        radius: 16,
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const _ListHeading(MidtermCopy.required, MidtermColors.emerald700),
                            _RuleList(required, tone: _Tone.ok),
                            const SizedBox(height: 24),
                            const DecoratedBox(
                              decoration: BoxDecoration(border: Border(top: BorderSide(color: MidtermColors.slate100))),
                              child: SizedBox(height: 20, width: double.infinity),
                            ),
                            const _ListHeading(MidtermCopy.allowed, MidtermColors.emerald700),
                            _RuleList(allowed, tone: _Tone.ok),
                          ],
                        ),
                      ),
                      MidtermCard(
                        radius: 16,
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const _ListHeading(MidtermCopy.prohibited, MidtermColors.red600),
                            _RuleList(prohibited, tone: _Tone.no),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  _columns(
                    wide: wide,
                    gap: 12,
                    children: [
                      _NoteBox(
                        icon: LucideIcons.clock,
                        iconColor: MidtermColors.amber600,
                        border: MidtermColors.amber200,
                        fill: MidtermColors.amber50,
                        text: MidtermColors.amber900,
                        spans: const [
                          TextSpan(text: MidtermCopy.timerRuleLead),
                          TextSpan(text: MidtermCopy.timerRuleStrong, style: TextStyle(fontWeight: FontWeight.w700)),
                          TextSpan(text: MidtermCopy.timerRuleTail),
                        ],
                      ),
                      _NoteBox(
                        icon: LucideIcons.shieldAlert,
                        iconColor: MidtermColors.red600,
                        border: MidtermColors.red200,
                        fill: MidtermColors.red50,
                        text: MidtermColors.red900,
                        spans: [
                          const TextSpan(text: MidtermCopy.offscreenRuleLead),
                          TextSpan(
                            text: MidtermCopy.offscreenRuleStrong(grace),
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          TextSpan(text: MidtermCopy.offscreenRuleMiddle(limit)),
                          const TextSpan(
                            text: MidtermCopy.offscreenRuleStrong2,
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                          const TextSpan(text: MidtermCopy.offscreenRuleTail),
                        ],
                      ),
                      _NoteBox(
                        icon: LucideIcons.rotateCcw,
                        iconColor: MidtermColors.slate500,
                        border: MidtermColors.slate200,
                        fill: MidtermColors.slate50,
                        text: MidtermColors.slate700,
                        spans: retake
                            ? const [
                                TextSpan(text: MidtermCopy.retakeLead),
                                TextSpan(text: MidtermCopy.retakeStrong, style: TextStyle(fontWeight: FontWeight.w700)),
                                TextSpan(text: MidtermCopy.retakeTail),
                              ]
                            : [
                                if (passLabel != null) ...[
                                  const TextSpan(text: MidtermCopy.passLead),
                                  TextSpan(text: passLabel, style: const TextStyle(fontWeight: FontWeight.w700)),
                                  const TextSpan(text: MidtermCopy.passTail),
                                ] else
                                  const TextSpan(text: MidtermCopy.passUnknown),
                                const TextSpan(text: MidtermCopy.sitOnce),
                              ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 28),
                  Center(
                    child: MidtermButton(
                      label: MidtermCopy.ready,
                      icon: LucideIcons.chevronRight,
                      expand: false,
                      autofocus: true,
                      padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 12),
                      onPressed: onProceed,
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
          ),
        );
      }),
    );
  }

  /// Side by side at `md:` width (equal height, like a CSS grid row); stacked below it.
  static Widget _columns({required bool wide, required double gap, required List<Widget> children}) {
    if (!wide) {
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: _gap(children, gap));
    }
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _gap([for (final c in children) Expanded(child: c)], gap),
      ),
    );
  }

  static List<Widget> _gap(List<Widget> children, double gap) => [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) SizedBox(width: gap, height: gap),
          children[i],
        ],
      ];
}

class _Rule {
  const _Rule(this.icon, this.text);
  final IconData icon;
  final String text;
}

enum _Tone { ok, no }

class _ListHeading extends StatelessWidget {
  const _ListHeading(this.text, this.color);
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Text(
          text.toUpperCase(),
          style: MidtermText.size(14, weight: FontWeight.w800, color: color, tracking: MidtermText.wide),
        ),
      );
}

class _RuleList extends StatelessWidget {
  const _RuleList(this.rules, {required this.tone});
  final List<_Rule> rules;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final ok = tone == _Tone.ok;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < rules.length; i++)
          Padding(
            padding: EdgeInsets.only(top: i == 0 ? 0 : 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  margin: const EdgeInsets.only(top: 2),
                  width: 32,
                  height: 32,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: ok ? MidtermColors.emerald50 : MidtermColors.red50,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(rules[i].icon, size: 16, color: ok ? MidtermColors.emerald600 : MidtermColors.red500),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    rules[i].text,
                    style: MidtermText.size(14, color: MidtermColors.slate700).copyWith(height: 1.625),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.icon, required this.value, required this.label, this.detail});
  final IconData icon;
  final String value;
  final String label;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    return MidtermCard(
      radius: 16,
      padding: const EdgeInsets.all(16),
      color: MidtermColors.slate50,
      shadow: MidtermShadow.none,
      child: Column(
        children: [
          const SizedBox(height: 0),
          Icon(icon, size: 20, color: MidtermColors.slate500),
          const SizedBox(height: 8),
          Text(value, textAlign: TextAlign.center, style: MidtermText.size(18, weight: FontWeight.w700)),
          Text(
            label.toUpperCase(),
            textAlign: TextAlign.center,
            style: MidtermText.size(11, weight: FontWeight.w600, color: MidtermColors.slate400, tracking: MidtermText.wide),
          ),
          if (detail != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                detail!,
                textAlign: TextAlign.center,
                style: MidtermText.size(11, weight: FontWeight.w500, color: MidtermColors.slate500),
              ),
            ),
        ],
      ),
    );
  }
}

class _NoteBox extends StatelessWidget {
  const _NoteBox({
    required this.icon,
    required this.iconColor,
    required this.border,
    required this.fill,
    required this.text,
    required this.spans,
  });

  final IconData icon;
  final Color iconColor;
  final Color border;
  final Color fill;
  final Color text;
  final List<InlineSpan> spans;

  @override
  Widget build(BuildContext context) {
    return MidtermCard(
      radius: 16,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      border: border,
      color: fill,
      shadow: MidtermShadow.none,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: iconColor),
          const SizedBox(height: 8),
          Text.rich(
            TextSpan(children: spans),
            style: MidtermText.size(14, weight: FontWeight.w500, color: text),
          ),
        ],
      ),
    );
  }
}
