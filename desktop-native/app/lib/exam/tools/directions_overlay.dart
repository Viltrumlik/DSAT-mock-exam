// Port of components/DirectionsOverlay.tsx: the Bluebook-style Directions popover. A white card
// hanging from just below the header (6 px under its bottom edge), covering the passage half
// (`calc(widthPct% + 44px)`), stopping 150 px above the window bottom so the question stays
// visible, with an upward pointer and a gold Close button. Section-specific copy.
//
// Return it as a direct child of the runner's Stack (it is a Positioned).
import 'dart:math' as math;

import 'package:flutter/widgets.dart';

import '../runner/runner_style.dart';
import '../tokens/bluebook_tokens.dart';

/// DirectionsOverlay.tsx:40-45, verbatim. The calculator sentence follows the paper's rule
/// (`calculatorAllowed`), not "is Math": a Foundation Math midterm has no calculator
/// (2026-10-11 — worked by hand), and directions that contradict the toolbar send a student
/// looking for a tool that is not there in the middle of a timed paper.
const directionsMathLead = 'The questions in this section address a number of important math skills.';
const directionsCalculatorAllowed = 'Use of a calculator is permitted for all questions.';
const directionsCalculatorNotAvailable =
    'A calculator is not available on this paper — work these questions by hand.';

/// The Math directions' first paragraph for a paper with or without a calculator.
String directionsMathP1({required bool calculatorAllowed}) =>
    '$directionsMathLead ${calculatorAllowed ? directionsCalculatorAllowed : directionsCalculatorNotAvailable}';

/// DirectionsOverlay.tsx:54-59, verbatim.
const directionsRwP1 =
    'The questions in this section address a number of important reading and writing skills. Each question includes one or more passages, which may include a table or graph. Read each passage and question carefully, and then choose the best answer to the question based on the passage(s).';
const directionsRwP2 =
    'All questions in this section are multiple-choice with four answer choices. Each question has a single best answer.';

class DirectionsOverlay extends StatelessWidget {
  const DirectionsOverlay({
    super.key,
    required this.anchorBottom,
    required this.widthFraction,
    required this.isMath,
    required this.calculatorAllowed,
    required this.onClose,
  });

  /// The header block's bottom edge (window y).
  final double anchorBottom;

  /// The passage pane's share of the width (0.5 for single-pane Math).
  final double widthFraction;
  final bool isMath;

  /// Whether this paper offers a calculator (`ExamSession.calculatorAllowed`).
  final bool calculatorAllowed;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final viewport = MediaQuery.sizeOf(context);
    final text = readingText(BluebookTokens.directionsTextSize, height: BluebookTokens.directionsTextLineHeight);
    final bold = text.copyWith(fontWeight: FontWeight.w700);
    final top = anchorBottom + BluebookTokens.directionsGapBelowHeader;
    return Positioned(
      left: 0,
      top: top,
      width: math.min(viewport.width, viewport.width * widthFraction + BluebookTokens.directionsExtraWidth),
      height: math.max(0, viewport.height - BluebookTokens.directionsBottom - top),
      child: Semantics(
        container: true,
        label: 'Directions',
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned.fill(
              child: Container(
                key: const ValueKey('directions.card'),
                padding: const EdgeInsets.all(BluebookTokens.directionsPadding),
                decoration: const BoxDecoration(
                  color: TwColors.white,
                  borderRadius: BorderRadius.vertical(bottom: Radius.circular(BluebookTokens.directionsRadius)),
                  boxShadow: TwShadows.xxl,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (isMath) ...[
                      Text(directionsMathP1(calculatorAllowed: calculatorAllowed), style: text),
                      const SizedBox(height: 16),
                      Text.rich(
                        TextSpan(
                          style: text,
                          children: [
                            const TextSpan(text: 'For '),
                            TextSpan(text: 'multiple-choice questions', style: bold),
                            const TextSpan(
                              text:
                                  ', solve each problem and choose the correct answer from the choices provided. For ',
                            ),
                            TextSpan(text: 'student-produced response questions', style: bold),
                            const TextSpan(text: ', solve each problem and enter your answer as described below.'),
                          ],
                        ),
                      ),
                    ] else ...[
                      Text(directionsRwP1, style: text),
                      const SizedBox(height: 16),
                      Text(directionsRwP2, style: text),
                    ],
                    const Spacer(),
                    Align(
                      alignment: Alignment.centerRight,
                      child: Pressable(
                        key: const ValueKey('directions.close'),
                        semanticLabel: 'Close',
                        onTap: onClose,
                        builder: (context, s) => Container(
                          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 10),
                          decoration: BoxDecoration(
                            color: s.hovered ? BluebookTokens.directionsCloseHover : BluebookTokens.directionsClose,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            'Close',
                            style: chromeText(14, weight: FontWeight.w700, color: TwColors.slate900, height: 20 / 14),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            // DirectionsOverlay.tsx:29 — a 16 px white square rotated 45°, 8 px above the card.
            Positioned(
              left: BluebookTokens.directionsPointerLeft,
              top: -BluebookTokens.directionsPointerSize / 2,
              width: BluebookTokens.directionsPointerSize,
              height: BluebookTokens.directionsPointerSize,
              child: Transform.rotate(
                angle: math.pi / 4,
                child: Container(
                  decoration: BoxDecoration(color: TwColors.white, borderRadius: BorderRadius.circular(2)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
