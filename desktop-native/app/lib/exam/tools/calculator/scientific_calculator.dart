// Port of frontend/src/features/testing-simulation/tools/calculator/ScientificCalculator.tsx:
// the built-in scientific calculator body (no panel chrome), the offline fallback for Desmos.
import 'package:flutter/widgets.dart';

import '../../runner/runner_style.dart';
import '../../tokens/bluebook_tokens.dart';
import 'expression.dart';

enum _Act { clear, back }

class _Key {
  const _Key(this.label, {this.insert, this.act});
  final String label;
  final String? insert;
  final _Act? act;
}

/// ScientificCalculator.tsx:5-12, in order.
const _keys = <_Key>[
  _Key('sin', insert: 'sin('), _Key('cos', insert: 'cos('), _Key('tan', insert: 'tan('), _Key('^', insert: '^'), _Key('√', insert: 'sqrt('), //
  _Key('ln', insert: 'ln('), _Key('log', insert: 'log('), _Key('(', insert: '('), _Key(')', insert: ')'), _Key('!', insert: '!'), //
  _Key('7', insert: '7'), _Key('8', insert: '8'), _Key('9', insert: '9'), _Key('÷', insert: '/'), _Key('π', insert: 'pi'), //
  _Key('4', insert: '4'), _Key('5', insert: '5'), _Key('6', insert: '6'), _Key('×', insert: '*'), _Key('e', insert: 'e'), //
  _Key('1', insert: '1'), _Key('2', insert: '2'), _Key('3', insert: '3'), _Key('−', insert: '-'), _Key('%', insert: '%'), //
  _Key('0', insert: '0'), _Key('.', insert: '.'), _Key('C', act: _Act.clear), _Key('⌫', act: _Act.back), _Key('+', insert: '+'), //
];

/// The scientific calculator. State is per mount, like the website's `useState`.
class ScientificCalculator extends StatefulWidget {
  const ScientificCalculator({super.key});

  @override
  State<ScientificCalculator> createState() => ScientificCalculatorState();
}

class ScientificCalculatorState extends State<ScientificCalculator> {
  String _expr = '';
  bool _degrees = true;

  /// Current input (tests).
  String get expression => _expr;
  bool get degrees => _degrees;

  String get _preview => _expr.isEmpty ? '' : tryEvaluate(_expr, EvalOptions(degrees: _degrees));

  void _press(_Key k) {
    setState(() {
      if (k.act == _Act.clear) {
        _expr = '';
      } else if (k.act == _Act.back) {
        if (_expr.isNotEmpty) _expr = _expr.substring(0, _expr.length - 1);
      } else if (k.insert != null) {
        _expr += k.insert!;
      }
    });
  }

  void _equals() {
    try {
      final v = evaluate(_expr, EvalOptions(degrees: _degrees));
      setState(() => _expr = formatCalculatorResult(v));
    } on ExpressionError {
      // Leave the input; the preview shows "Error" (ScientificCalculator.tsx:28-30).
    }
  }

  @override
  Widget build(BuildContext context) {
    final preview = _preview;
    return Padding(
      padding: const EdgeInsets.all(12), // p-3
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ScientificCalculator.tsx:35-40
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('SCIENTIFIC',
                    style: chromeText(11,
                        weight: FontWeight.w700,
                        color: TwColors.slate400,
                        trackingEm: BluebookTokens.trackingWidest,
                        height: 1.5)),
                Pressable(
                  key: const ValueKey('sci.degrees'),
                  semanticLabel: _degrees ? 'DEG' : 'RAD',
                  onTap: () => setState(() => _degrees = !_degrees),
                  builder: (context, s) => Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: s.hovered ? TwColors.slate50 : null,
                      border: Border.all(color: TwColors.slate300),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(_degrees ? 'DEG' : 'RAD',
                        style: chromeText(12, weight: FontWeight.w700, color: TwColors.slate600, height: 16 / 12)),
                  ),
                ),
              ],
            ),
          ),
          // ScientificCalculator.tsx:41-44
          Container(
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: TwColors.slate50,
              border: Border.all(color: TwColors.slate200),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 20),
                  child: Text(_expr.isEmpty ? '0' : _expr,
                      key: const ValueKey('sci.expr'),
                      textAlign: TextAlign.right,
                      style: monoText(14, color: TwColors.slate500, height: 20 / 14)),
                ),
                ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 28),
                  child: Text(preview.isEmpty ? '0' : preview,
                      key: const ValueKey('sci.result'),
                      textAlign: TextAlign.right,
                      style: monoText(24, weight: FontWeight.w700, color: TwColors.slate900, height: 32 / 24)),
                ),
              ],
            ),
          ),
          // ScientificCalculator.tsx:45-61: grid flex-1 grid-cols-5 gap-1.5; every auto row
          // grows by the same amount, the "=" row carries mt-1 + py-2 on top.
          Expanded(
            child: LayoutBuilder(builder: (context, c) {
              const gap = 6.0;
              const keyRows = 6;
              const keyBase = 20.0; // text-sm line box
              const equalsBase = 4 + 8 + 20 + 8.0; // mt-1 + py-2 + line
              final extra = ((c.maxHeight - keyRows * gap - keyRows * keyBase - equalsBase) / (keyRows + 1))
                  .clamp(0.0, double.infinity);
              final rowH = keyBase + extra;
              return Column(
                children: [
                  for (var r = 0; r < keyRows; r++) ...[
                    SizedBox(
                      height: rowH,
                      child: Row(
                        children: [
                          for (var col = 0; col < 5; col++) ...[
                            if (col > 0) const SizedBox(width: gap),
                            Expanded(child: _keyButton(_keys[r * 5 + col])),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: gap),
                  ],
                  SizedBox(
                    height: equalsBase + extra,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Pressable(
                        key: const ValueKey('sci.equals'),
                        semanticLabel: '=',
                        onTap: _equals,
                        builder: (context, s) => Container(
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: s.hovered ? BluebookTokens.sciEqualsHover : BluebookTokens.sciEquals,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text('=', style: chromeText(14, weight: FontWeight.w700, color: TwColors.white, height: 20 / 14)),
                        ),
                      ),
                    ),
                  ),
                ],
              );
            }),
          ),
        ],
      ),
    );
  }

  Widget _keyButton(_Key k) {
    final isClear = k.act == _Act.clear;
    final isDigit = RegExp(r'[0-9.]').hasMatch(k.label);
    return Pressable(
      key: ValueKey('sci.key.${k.label}'),
      semanticLabel: k.label,
      onTap: () => _press(k),
      builder: (context, s) {
        final Color bg;
        final Color fg;
        if (isClear) {
          bg = s.hovered ? BluebookTokens.sciClearHover : BluebookTokens.sciClearBackground;
          fg = BluebookTokens.sciClearColor;
        } else if (isDigit) {
          bg = s.hovered ? BluebookTokens.sciDigitHover : BluebookTokens.sciDigitBackground;
          fg = TwColors.slate900;
        } else {
          bg = s.hovered ? BluebookTokens.sciOpHover : BluebookTokens.sciOpBackground;
          fg = BluebookTokens.sciOpColor;
        }
        return Container(
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(6),
            // `ring-1 ring-slate-200` is a 1 px box-shadow spread OUTSIDE the key (no layout).
            boxShadow: isDigit && !isClear
                ? const [BoxShadow(color: BluebookTokens.sciDigitRing, spreadRadius: 1)]
                : null,
          ),
          child: Text(k.label, style: chromeText(14, weight: FontWeight.w600, color: fg, height: 20 / 14)),
        );
      },
    );
  }
}
