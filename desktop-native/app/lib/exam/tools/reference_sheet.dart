// Port of tools/ReferenceSheet.tsx: the SAT Math reference sheet in a floating panel — plane
// figures, special right triangles, solids, and the three constant notes. The website draws
// the figures as inline SVG; here each figure's shapes are an asset
// (assets/runner/reference/*.svg, same 120×90 viewBox and stroke) and the italic labels are
// painted natively on the same coordinates (flutter_svg cannot draw italic SVG text).
import 'package:flutter/rendering.dart' show OverflowBoxFit;
import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../runner/runner_style.dart';
import '../tokens/bluebook_tokens.dart';
import 'floating_panel.dart';

/// One label inside a figure (ReferenceSheet.tsx `<text x y fontSize fontStyle>`).
@immutable
class FigureLabel {
  const FigureLabel(this.text, this.x, this.y, this.size, {this.italic = true});
  final String text;
  final double x;
  final double y;
  final double size;
  final bool italic;
}

/// A formula fragment: plain text, a superscript, or a stacked fraction.
sealed class FormulaPart {
  const FormulaPart();
}

final class FText extends FormulaPart {
  const FText(this.text);
  final String text;
}

final class FSup extends FormulaPart {
  const FSup(this.text);
  final String text;
}

final class FFrac extends FormulaPart {
  const FFrac(this.n, this.d);
  final String n;
  final String d;
}

@immutable
class ReferenceFigure {
  const ReferenceFigure(this.asset, this.labels, this.formula);

  /// File name under assets/runner/reference/.
  final String asset;
  final List<FigureLabel> labels;

  /// One list per formula line.
  final List<List<FormulaPart>> formula;
}

/// Row 1 (ReferenceSheet.tsx:45-91).
const referencePlaneFigures = <ReferenceFigure>[
  ReferenceFigure('circle', [FigureLabel('r', 60, 38, 11)], [
    [FText('A = πr'), FSup('2')],
    [FText('C = 2πr')],
  ]),
  ReferenceFigure('rectangle', [FigureLabel('ℓ', 56, 20, 11), FigureLabel('w', 104, 50, 11)], [
    [FText('A = ℓw')],
  ]),
  ReferenceFigure('triangle', [FigureLabel('h', 55, 50, 11), FigureLabel('b', 42, 84, 11)], [
    [FText('A = '), FFrac('1', '2'), FText(' bh')],
  ]),
  ReferenceFigure('right_triangle', [FigureLabel('b', 6, 52, 11), FigureLabel('c', 60, 44, 11), FigureLabel('a', 52, 84, 11)], [
    [FText('c'), FSup('2'), FText(' = a'), FSup('2'), FText(' + b'), FSup('2')],
  ]),
  ReferenceFigure('triangle_30_60_90', [
    FigureLabel('x√3', 40, 84, 10),
    FigureLabel('x', 100, 54, 10),
    FigureLabel('2x', 48, 44, 10),
    FigureLabel('30°', 26, 66, 8, italic: false),
    FigureLabel('60°', 80, 42, 8, italic: false),
  ], [
    [FText('30°-60°-90°')],
  ]),
  ReferenceFigure('triangle_45_45_90', [
    FigureLabel('s', 46, 84, 10),
    FigureLabel('s', 90, 54, 10),
    FigureLabel('s√2', 44, 44, 10),
    FigureLabel('45°', 30, 66, 8, italic: false),
  ], [
    [FText('45°-45°-90°')],
  ]),
];

/// Row 2 (ReferenceSheet.tsx:96-141).
const referenceSolids = <ReferenceFigure>[
  ReferenceFigure('rectangular_solid', [FigureLabel('ℓ', 36, 86, 10), FigureLabel('h', 14, 60, 10), FigureLabel('w', 70, 20, 10)], [
    [FText('V = ℓwh')],
  ]),
  ReferenceFigure('cylinder', [FigureLabel('r', 58, 20, 10), FigureLabel('h', 78, 48, 10)], [
    [FText('V = πr'), FSup('2'), FText('h')],
  ]),
  ReferenceFigure('sphere', [FigureLabel('r', 58, 38, 10)], [
    [FText('V = '), FFrac('4', '3'), FText('πr'), FSup('3')],
  ]),
  ReferenceFigure('cone', [FigureLabel('h', 38, 46, 10), FigureLabel('r', 60, 62, 10)], [
    [FText('V = '), FFrac('1', '3'), FText('πr'), FSup('2'), FText('h')],
  ]),
  ReferenceFigure('pyramid', [FigureLabel('h', 40, 44, 10), FigureLabel('ℓ', 34, 72, 10), FigureLabel('w', 74, 66, 10)], [
    [FText('V = '), FFrac('1', '3'), FText('ℓwh')],
  ]),
];

/// ReferenceSheet.tsx:145-147.
const referenceNotes = [
  'The number of degrees of arc in a circle is 360.',
  'The number of radians of arc in a circle is 2π.',
  'The sum of the measures in degrees of the angles of a triangle is 180.',
];

class ReferenceSheet extends StatelessWidget {
  const ReferenceSheet({super.key, required this.onClose});

  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) => FloatingPanel(
        panelKey: const ValueKey('panel.reference'),
        title: 'Reference Sheet',
        onClose: onClose,
        initial: BluebookTokens.referenceRect,
        minSize: BluebookTokens.referenceMin,
        child: const SingleChildScrollView(
          child: Padding(padding: EdgeInsets.all(20), child: ReferenceSheetContent()),
        ),
      );
}

/// The sheet's content (no panel), for tests and goldens.
class ReferenceSheetContent extends StatelessWidget {
  const ReferenceSheetContent({super.key});

  Widget _row(List<ReferenceFigure> figures) => LayoutBuilder(builder: (context, c) {
        // `grid sm:grid-cols-6 / sm:grid-cols-5 gap-x-4` (the window is always wider than
        // `sm`): equal minmax(0, 1fr) columns; a figure wider than its column overflows it
        // evenly on both sides, like the website.
        const gap = 16.0;
        final n = figures.length;
        final col = (c.maxWidth - gap * (n - 1)) / n;
        return Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            for (var i = 0; i < n; i++) ...[
              if (i > 0) const SizedBox(width: gap),
              SizedBox(width: col, child: OverflowBox(maxWidth: double.infinity, fit: OverflowBoxFit.deferToChild, child: _Figure(figures[i]))),
            ],
          ],
        );
      });

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ReferenceSheet.tsx:40-42
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(color: TwColors.slate900, borderRadius: BorderRadius.circular(4)),
            child: Text('REFERENCE',
                style: chromeText(10,
                    weight: FontWeight.w700, color: TwColors.white, trackingEm: BluebookTokens.trackingWidest, height: 1.5)),
          ),
          _row(referencePlaneFigures),
          // ReferenceSheet.tsx:93
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Center(
              child: Text('Special Right Triangles',
                  style: chromeText(11, weight: FontWeight.w600, color: TwColors.slate500, height: 1.5)),
            ),
          ),
          _row(referenceSolids),
          // ReferenceSheet.tsx:144-148
          Container(
            margin: const EdgeInsets.only(top: 16),
            padding: const EdgeInsets.only(top: 12),
            width: double.infinity,
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: TwColors.slate200))),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < referenceNotes.length; i++) ...[
                  if (i > 0) const SizedBox(height: 4),
                  Text(referenceNotes[i], style: chromeText(12, color: TwColors.slate600, height: 1.5)),
                ],
              ],
            ),
          ),
        ],
      );
}

class _Figure extends StatelessWidget {
  const _Figure(this.figure);
  final ReferenceFigure figure;

  @override
  Widget build(BuildContext context) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: BluebookTokens.referenceFigure.width,
            height: BluebookTokens.referenceFigure.height,
            child: Stack(
              fit: StackFit.expand,
              children: [
                SvgPicture.asset('assets/runner/reference/${figure.asset}.svg', fit: BoxFit.contain),
                CustomPaint(painter: _LabelPainter(figure.labels)),
              ],
            ),
          ),
          const SizedBox(height: 6), // gap-1.5
          for (final line in figure.formula) _Formula(line),
        ],
      );
}

/// Paints labels at their SVG baseline positions, mapped like `preserveAspectRatio="xMidYMid
/// meet"` maps the 120×90 viewBox into the 110×78 figure box.
class _LabelPainter extends CustomPainter {
  _LabelPainter(this.labels);
  final List<FigureLabel> labels;

  @override
  void paint(Canvas canvas, Size size) {
    final s = (size.width / 120) < (size.height / 90) ? size.width / 120 : size.height / 90;
    final dx = (size.width - 120 * s) / 2;
    final dy = (size.height - 90 * s) / 2;
    for (final l in labels) {
      final tp = TextPainter(
        text: TextSpan(
          text: l.text,
          style: chromeText(l.size * s,
              color: const Color(0xFF0F172A), height: 1, style: l.italic ? FontStyle.italic : FontStyle.normal),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      final baseline = tp.computeDistanceToActualBaseline(TextBaseline.alphabetic);
      tp.paint(canvas, Offset(dx + l.x * s, dy + l.y * s - baseline));
      tp.dispose();
    }
  }

  @override
  bool shouldRepaint(_LabelPainter old) => old.labels != labels;
}

class _Formula extends StatelessWidget {
  const _Formula(this.parts);
  final List<FormulaPart> parts;

  static const double _size = BluebookTokens.referenceFormulaSize;

  @override
  Widget build(BuildContext context) {
    final base = readingText(_size, height: 1.25); // leading-tight
    return Text.rich(
      TextSpan(style: base, children: [
        for (final p in parts)
          switch (p) {
            FText(:final text) => TextSpan(text: text),
            // <sup className="text-[0.7em]">: vertical-align super ≈ a third of the em up.
            FSup(:final text) => WidgetSpan(
                alignment: PlaceholderAlignment.baseline,
                baseline: TextBaseline.alphabetic,
                child: Transform.translate(
                  offset: const Offset(0, -_size * 0.33),
                  child: Text(text, style: readingText(_size * 0.7, height: 1)),
                ),
              ),
            // Frac: inline-flex column, 0.75em, numerator underlined (border-b), align-middle.
            FFrac(:final n, :final d) => WidgetSpan(
                alignment: PlaceholderAlignment.middle,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: TwColors.slate900))),
                      child: Text(n, style: readingText(_size * 0.75, height: 1)),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      child: Text(d, style: readingText(_size * 0.75, height: 1)),
                    ),
                  ],
                ),
              ),
          },
      ]),
      textAlign: TextAlign.center,
    );
  }
}
