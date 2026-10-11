// The Bluebook-style multi-colour dashed rule (components/SatColorRule.tsx): 3 px tall, a
// 216 px repeating pattern of four 48 px dashes (#b91c1c #ca8a04 #15803d #0f172a), each
// followed by a 6 px transparent gap, starting at x = 0 of the rule (the CSS gradient's origin).
import 'package:flutter/widgets.dart';

import '../tokens/bluebook_tokens.dart';

class SatColorRule extends StatelessWidget {
  const SatColorRule({super.key});

  @override
  Widget build(BuildContext context) => const ExcludeSemantics(
        child: SizedBox(
          height: BluebookTokens.ruleHeight,
          width: double.infinity,
          child: CustomPaint(painter: SatColorRulePainter()),
        ),
      );
}

class SatColorRulePainter extends CustomPainter {
  const SatColorRulePainter();

  /// One full period of the gradient (4 × (48 + 6) = 216 px).
  static const double period =
      BluebookTokens.ruleColors.length * (BluebookTokens.ruleDash + BluebookTokens.ruleGap);

  /// The colour at horizontal offset [x] (null inside a gap). Exposed for tests.
  static Color? colorAt(double x) {
    final p = x % period;
    final slot = (p ~/ (BluebookTokens.ruleDash + BluebookTokens.ruleGap)).clamp(0, BluebookTokens.ruleColors.length - 1);
    final within = p - slot * (BluebookTokens.ruleDash + BluebookTokens.ruleGap);
    return within < BluebookTokens.ruleDash ? BluebookTokens.ruleColors[slot] : null;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..isAntiAlias = false;
    const step = BluebookTokens.ruleDash + BluebookTokens.ruleGap;
    var i = 0;
    for (var x = 0.0; x < size.width; x += step, i++) {
      paint.color = BluebookTokens.ruleColors[i % BluebookTokens.ruleColors.length];
      final right = (x + BluebookTokens.ruleDash).clamp(0.0, size.width);
      canvas.drawRect(Rect.fromLTRB(x, 0, right, size.height), paint);
    }
  }

  @override
  bool shouldRepaint(SatColorRulePainter oldDelegate) => false;
}
