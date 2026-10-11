// Port of components/ExamFooter.tsx: the bottom bar — the student's name on the left, the
// near-black "Question N of M" pill that opens the navigator in the middle, and the indigo
// Back and Next (Submit on the last question) buttons on the right.
import 'package:flutter/widgets.dart';

import '../tokens/bluebook_tokens.dart';
import 'icons/lucide_glyphs.dart';
import 'icons/lucide_icon.dart';
import 'runner_style.dart';

/// ExamFooter.tsx:58-83 — `rounded-full bg-[#253985] px-9 py-2.5 text-[15px] font-bold
/// text-white hover:bg-[#1d2d6b]`, with a per-button disabled opacity. Also used by Check Your
/// Work (`px-8`).
class IndigoButton extends StatelessWidget {
  const IndigoButton({
    super.key,
    required this.label,
    required this.onTap,
    this.enabled = true,
    this.disabledOpacity = BluebookTokens.nextDisabledOpacity,
    this.padding = BluebookTokens.footerButtonPadding,
  });

  final String label;
  final VoidCallback onTap;
  final bool enabled;
  final double disabledOpacity;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Pressable(
    semanticLabel: label,
    enabled: enabled,
    onTap: onTap,
    builder: (context, s) => Opacity(
      opacity: s.enabled ? 1 : disabledOpacity,
      child: Container(
        padding: padding,
        decoration: BoxDecoration(
          color: s.hovered ? BluebookTokens.primaryButtonHover : BluebookTokens.primaryButton,
          borderRadius: BorderRadius.circular(BluebookTokens.pillRadius),
        ),
        child: Text(
          label,
          style: chromeText(BluebookTokens.footerButtonSize, weight: FontWeight.w700, color: TwColors.white),
        ),
      ),
    ),
  );
}

/// The student's name, bold slate-700, one line (ExamFooter.tsx:37, CheckYourWorkPage.tsx:101).
class StudentName extends StatelessWidget {
  const StudentName(this.name, {super.key});
  final String name;

  @override
  Widget build(BuildContext context) => Text(
    name,
    key: const ValueKey('footer.name'),
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
    softWrap: false,
    style: chromeText(BluebookTokens.studentNameSize, weight: FontWeight.w700, color: BluebookTokens.studentNameColor),
  );
}

class ExamFooter extends StatelessWidget {
  const ExamFooter({
    super.key,
    required this.studentName,
    required this.navLabel,
    required this.onToggleNavigator,
    required this.canGoBack,
    required this.onBack,
    required this.isLastQuestion,
    required this.onNext,
    required this.onSubmitModule,
    this.submitting = false,
    this.navLocked = false,
  });

  final String studentName;

  /// "Question N of M".
  final String navLabel;
  final VoidCallback onToggleNavigator;
  final bool canGoBack;
  final VoidCallback onBack;
  final bool isLastQuestion;
  final VoidCallback onNext;

  /// The last question's "Submit" (opens Check Your Work).
  final VoidCallback onSubmitModule;
  final bool submitting;

  /// The 500 ms freeze after Back/Next (ExamRunnerPage.tsx:265-284).
  final bool navLocked;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: BluebookTokens.surface,
    child: Padding(
      padding: BluebookTokens.footerPadding,
      child: Row(
        children: [
          Expanded(
            child: Align(alignment: Alignment.centerLeft, child: StudentName(studentName)),
          ),
          Pressable(
            key: const ValueKey('footer.navigator'),
            semanticLabel: navLabel,
            onTap: onToggleNavigator,
            builder: (context, s) => Container(
              padding: BluebookTokens.navPillPadding,
              decoration: BoxDecoration(
                color: s.hovered ? BluebookTokens.navPillHover : BluebookTokens.navPillBackground,
                borderRadius: BorderRadius.circular(BluebookTokens.pillRadius),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    navLabel,
                    style: chromeText(BluebookTokens.footerButtonSize, weight: FontWeight.w700, color: TwColors.white),
                  ),
                  const SizedBox(width: BluebookTokens.navPillGap),
                  const LucideIcon(LucideGlyphs.chevronUp, size: BluebookTokens.navPillIcon, color: TwColors.white),
                ],
              ),
            ),
          ),
          Expanded(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                IndigoButton(
                  key: const ValueKey('footer.back'),
                  label: 'Back',
                  enabled: canGoBack && !navLocked,
                  disabledOpacity: BluebookTokens.backDisabledOpacity,
                  onTap: onBack,
                ),
                const SizedBox(width: BluebookTokens.footerButtonGap),
                if (isLastQuestion)
                  IndigoButton(
                    key: const ValueKey('footer.submit'),
                    label: submitting ? 'Submitting…' : 'Submit',
                    enabled: !submitting && !navLocked,
                    disabledOpacity: BluebookTokens.submitDisabledOpacity,
                    onTap: onSubmitModule,
                  )
                else
                  IndigoButton(
                    key: const ValueKey('footer.next'),
                    label: 'Next',
                    enabled: !navLocked,
                    disabledOpacity: BluebookTokens.nextDisabledOpacity,
                    onTap: onNext,
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}
