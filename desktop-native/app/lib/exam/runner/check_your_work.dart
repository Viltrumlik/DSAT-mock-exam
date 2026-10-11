// Port of components/CheckYourWorkPage.tsx: the Bluebook-style review page shown before a
// module is handed in — the intro copy, a card with the status legend and an 11-column
// question grid to jump from, and a footer with Back and Next/Submit. On a midterm the
// student cannot hand in early: the button is replaced by the website's locked note.
import 'package:flutter/widgets.dart';

import '../tokens/bluebook_tokens.dart';
import 'exam_footer.dart';
import 'icons/lucide_glyphs.dart';
import 'icons/lucide_icon.dart';
import 'question_navigator.dart';
import 'runner_style.dart';
import 'sat_color_rule.dart';

/// CheckYourWorkPage.tsx:112-113, verbatim.
const checkYourWorkLockedNote =
    "Keep reviewing your answers — you can't submit early. The midterm submits automatically when time runs out.";

class CheckYourWorkPage extends StatelessWidget {
  const CheckYourWorkPage({
    super.key,
    required this.moduleTitle,
    required this.count,
    required this.stateOf,
    required this.onJump,
    required this.onBack,
    required this.onSubmit,
    required this.isLastModule,
    required this.studentName,
    this.submitting = false,
    this.submitLocked = false,
  });

  final String moduleTitle;
  final int count;
  final QuestionCellState Function(int index) stateOf;
  final ValueChanged<int> onJump;
  final VoidCallback onBack;
  final VoidCallback onSubmit;
  final bool isLastModule;
  final String studentName;
  final bool submitting;

  /// Midterms: no Next/Submit — the module hands in at the server's deadline.
  final bool submitLocked;

  @override
  Widget build(BuildContext context) {
    final intro = chromeText(BluebookTokens.reviewIntroSize, color: BluebookTokens.reviewIntroColor);
    return ColoredBox(
      color: BluebookTokens.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SatColorRule(),
          Expanded(
            child: ColoredBox(
              color: BluebookTokens.reviewBackground,
              child: SingleChildScrollView(
                padding: BluebookTokens.reviewPadding,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Text(
                      'Check Your Work',
                      key: const ValueKey('review.title'),
                      textAlign: TextAlign.center,
                      style: chromeText(
                        BluebookTokens.reviewTitleSize,
                        color: TwColors.slate900,
                        trackingEm: BluebookTokens.trackingTight,
                      ),
                    ),
                    const SizedBox(height: 16),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: BluebookTokens.reviewIntroMaxWidth),
                      child: Text(
                        'On test day, you won’t be able to move on to the next module until time expires.',
                        textAlign: TextAlign.center,
                        style: intro,
                      ),
                    ),
                    const SizedBox(height: 6),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: BluebookTokens.reviewIntroMaxWidth),
                      child: Text.rich(
                        TextSpan(
                          style: intro,
                          children: [
                            const TextSpan(text: 'For these practice questions, you can click '),
                            TextSpan(
                              text: 'Next',
                              style: intro.copyWith(fontWeight: FontWeight.w700),
                            ),
                            const TextSpan(text: ' when you’re ready to move on.'),
                          ],
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(height: 32),
                    Container(
                      key: const ValueKey('review.card'),
                      constraints: const BoxConstraints(maxWidth: BluebookTokens.reviewCardMaxWidth),
                      padding: const EdgeInsets.all(BluebookTokens.reviewCardPadding),
                      decoration: BoxDecoration(
                        color: TwColors.white,
                        border: Border.all(color: BluebookTokens.reviewCardBorder),
                        borderRadius: BorderRadius.circular(BluebookTokens.reviewCardRadius),
                        boxShadow: TwShadows.sm,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Container(
                            margin: const EdgeInsets.only(bottom: BluebookTokens.reviewCardHeaderBottom),
                            padding: const EdgeInsets.only(bottom: BluebookTokens.reviewCardHeaderPadding),
                            decoration: const BoxDecoration(
                              border: Border(bottom: BorderSide(color: BluebookTokens.reviewCardBorder)),
                            ),
                            child: Wrap(
                              alignment: WrapAlignment.spaceBetween,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              spacing: 12,
                              runSpacing: 12,
                              children: [
                                Text(
                                  '$moduleTitle Questions',
                                  key: const ValueKey('review.cardTitle'),
                                  style: chromeText(18, weight: FontWeight.w700, height: 28 / 18),
                                ),
                                Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const UnansweredSwatch(radius: BluebookTokens.reviewLegendBoxRadius),
                                    const SizedBox(width: 8),
                                    Text(
                                      'Unanswered',
                                      style: chromeText(14, color: TwColors.slate600, height: 20 / 14),
                                    ),
                                    const SizedBox(width: 24),
                                    const LucideIcon(
                                      LucideGlyphs.flag,
                                      size: 16,
                                      color: BluebookTokens.flagColor,
                                      fill: BluebookTokens.flagColor,
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      'For Review',
                                      style: chromeText(14, color: TwColors.slate600, height: 20 / 14),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          QuestionGrid(
                            columns: BluebookTokens.reviewColumns,
                            count: count,
                            stateOf: stateOf,
                            onTap: onJump,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SatColorRule(),
          ColoredBox(
            color: BluebookTokens.surface,
            child: Padding(
              padding: BluebookTokens.footerPadding,
              child: Row(
                children: [
                  Expanded(child: StudentName(studentName)),
                  IndigoButton(
                    key: const ValueKey('review.back'),
                    label: 'Back',
                    padding: BluebookTokens.reviewButtonPaddingFooter,
                    onTap: onBack,
                  ),
                  const SizedBox(width: 12),
                  if (submitLocked)
                    Container(
                      key: const ValueKey('review.locked'),
                      constraints: const BoxConstraints(maxWidth: BluebookTokens.lockedNoteMaxWidth),
                      padding: BluebookTokens.lockedNotePadding,
                      decoration: BoxDecoration(
                        color: BluebookTokens.lockedNoteBackground,
                        border: Border.all(color: BluebookTokens.lockedNoteBorder),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        checkYourWorkLockedNote,
                        style: chromeText(
                          14,
                          weight: FontWeight.w600,
                          color: BluebookTokens.lockedNoteColor,
                          height: 20 / 14,
                        ),
                      ),
                    )
                  else
                    IndigoButton(
                      key: const ValueKey('review.submit'),
                      label: submitting ? 'Submitting…' : (isLastModule ? 'Submit' : 'Next'),
                      padding: BluebookTokens.reviewButtonPaddingFooter,
                      enabled: !submitting,
                      disabledOpacity: 0.6,
                      onTap: onSubmit,
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
