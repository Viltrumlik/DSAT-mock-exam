// Port of components/QuestionNavigator.tsx: the question-jump popover (Current / Unanswered /
// For Review) hung above the footer's "Question N of M" pill with a downward pointer, plus
// "Go to Review Page". The question cell is shared with Check Your Work.
import 'package:flutter/widgets.dart';

import '../tokens/bluebook_tokens.dart';
import 'dashed_border.dart';
import 'icons/lucide_glyphs.dart';
import 'icons/lucide_icon.dart';
import 'runner_style.dart';

/// One question's status in a grid.
@immutable
class QuestionCellState {
  const QuestionCellState({required this.answered, required this.flagged, this.current = false});
  final bool answered;
  final bool flagged;
  final bool current;
}

/// QuestionNavigator.tsx:59-74 / CheckYourWorkPage.tsx:80-92 — a 40 px numbered square:
/// answered = filled indigo; unanswered = dashed slate-400 (hover slate-600) with indigo-blue
/// text; the current one underlined; a red flag at the top-right when marked for review.
class QuestionCell extends StatelessWidget {
  const QuestionCell({super.key, required this.number, required this.state, required this.onTap});

  final int number;
  final QuestionCellState state;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = [
      'Question $number',
      state.answered ? 'answered' : 'unanswered',
      if (state.flagged) 'marked for review',
      if (state.current) 'current',
    ].join(', ');
    return Pressable(
      semanticLabel: status,
      selected: state.current,
      onTap: onTap,
      builder: (context, s) {
        final label = Text(
          '$number',
          style: chromeText(
            BluebookTokens.cellTextSize,
            weight: FontWeight.w700,
            color: state.answered ? TwColors.white : BluebookTokens.cellUnansweredText,
            height: 20 / 14,
            decoration: state.current ? TextDecoration.underline : null,
            decorationColor: state.answered ? TwColors.white : BluebookTokens.cellUnansweredText,
          ),
        );
        final box = state.answered
            ? Container(
                width: BluebookTokens.cellSize,
                height: BluebookTokens.cellSize,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: BluebookTokens.cellAnswered,
                  border: Border.all(color: BluebookTokens.cellAnswered),
                  borderRadius: BorderRadius.circular(BluebookTokens.cellRadius),
                ),
                child: label,
              )
            : SizedBox(
                width: BluebookTokens.cellSize,
                height: BluebookTokens.cellSize,
                child: CssBorderBox(
                  color: s.hovered ? BluebookTokens.cellUnansweredHover : BluebookTokens.cellUnansweredBorder,
                  radius: BluebookTokens.cellRadius,
                  child: Center(child: label),
                ),
              );
        return Stack(
          clipBehavior: Clip.none,
          children: [
            box,
            if (state.flagged)
              const Positioned(
                right: BluebookTokens.cellFlagOffset,
                top: BluebookTokens.cellFlagOffset,
                child: LucideIcon(
                  LucideGlyphs.flag,
                  size: BluebookTokens.cellFlag,
                  color: BluebookTokens.flagColor,
                  fill: BluebookTokens.flagColor,
                ),
              ),
          ],
        );
      },
    );
  }
}

/// A fixed-column grid whose cells are centred in equal columns (`grid grid-cols-N gap-3`
/// with `justify-items-center` / a centring wrapper).
class QuestionGrid extends StatelessWidget {
  const QuestionGrid({
    super.key,
    required this.columns,
    required this.count,
    required this.stateOf,
    required this.onTap,
    this.showCurrentPin = false,
  });

  final int columns;
  final int count;
  final QuestionCellState Function(int index) stateOf;
  final ValueChanged<int> onTap;

  /// The navigator draws a map pin above the current question (QuestionNavigator.tsx:58).
  final bool showCurrentPin;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, c) {
      const gap = BluebookTokens.gridGap;
      final col = (c.maxWidth - gap * (columns - 1)) / columns;
      final rows = (count / columns).ceil();
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var r = 0; r < rows; r++) ...[
            if (r > 0) const SizedBox(height: gap),
            Row(
              children: [
                for (var k = 0; k < columns; k++) ...[
                  if (k > 0) const SizedBox(width: gap),
                  SizedBox(width: col, child: r * columns + k < count ? _cell(r * columns + k) : null),
                ],
              ],
            ),
          ],
        ],
      );
    },
  );

  Widget _cell(int i) {
    final st = stateOf(i);
    return Center(
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.topCenter,
        children: [
          QuestionCell(key: ValueKey('cell.$i'), number: i + 1, state: st, onTap: () => onTap(i)),
          if (showCurrentPin && st.current)
            const Positioned(
              top: BluebookTokens.cellPinTop,
              child: IgnorePointer(
                child: LucideIcon(
                  LucideGlyphs.mapPin,
                  key: ValueKey('navigator.pin'),
                  size: BluebookTokens.cellPin,
                  color: BluebookTokens.currentPin,
                  fill: BluebookTokens.currentPin,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The dashed "Unanswered" legend square (QuestionNavigator.tsx:48, CheckYourWorkPage.tsx:67).
class UnansweredSwatch extends StatelessWidget {
  const UnansweredSwatch({super.key, this.radius = BluebookTokens.legendBoxRadius});
  final double radius;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: BluebookTokens.legendBox,
    child: CssBorderBox(color: BluebookTokens.cellUnansweredBorder, radius: radius),
  );
}

class QuestionNavigator extends StatelessWidget {
  const QuestionNavigator({
    super.key,
    required this.title,
    required this.count,
    required this.stateOf,
    required this.onJump,
    required this.onGoToReview,
    required this.onClose,
  });

  /// The module title; the heading reads "<title> Questions".
  final String title;
  final int count;
  final QuestionCellState Function(int index) stateOf;
  final ValueChanged<int> onJump;
  final VoidCallback onGoToReview;
  final VoidCallback onClose;

  Widget _legendItem(Widget icon, String label) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      icon,
      const SizedBox(width: BluebookTokens.legendItemGap),
      Text(
        label,
        style: chromeText(
          BluebookTokens.legendTextSize,
          weight: FontWeight.w600,
          color: BluebookTokens.legendColor,
          height: 20 / 14,
        ),
      ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final card = Container(
      key: const ValueKey('navigator.card'),
      constraints: const BoxConstraints(maxWidth: BluebookTokens.navigatorMaxWidth),
      padding: const EdgeInsets.all(BluebookTokens.navigatorPadding),
      decoration: BoxDecoration(
        color: TwColors.white,
        borderRadius: BorderRadius.circular(BluebookTokens.navigatorRadius),
        boxShadow: BluebookTokens.navigatorShadow,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // QuestionNavigator.tsx:40-45 — centred title, close at the top-right.
          Padding(
            padding: const EdgeInsets.only(bottom: BluebookTokens.navigatorTitleBottom),
            child: Stack(
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: BluebookTokens.navigatorTitlePadding),
                  child: Text(
                    '$title Questions',
                    key: const ValueKey('navigator.title'),
                    textAlign: TextAlign.center,
                    style: chromeText(
                      BluebookTokens.navigatorTitleSize,
                      weight: FontWeight.w700,
                      height: BluebookTokens.navigatorTitleLineHeight,
                      trackingEm: BluebookTokens.trackingTight,
                    ),
                  ),
                ),
                Positioned(
                  right: 0,
                  top: 0,
                  child: Pressable(
                    key: const ValueKey('navigator.close'),
                    semanticLabel: 'Close question navigator',
                    onTap: onClose,
                    builder: (context, s) => LucideIcon(
                      LucideGlyphs.x,
                      size: BluebookTokens.closeIcon,
                      color: s.hovered ? BluebookTokens.closeIconHover : BluebookTokens.closeIconColor,
                    ),
                  ),
                ),
              ],
            ),
          ),
          // QuestionNavigator.tsx:46-50 — the legend.
          Container(
            margin: const EdgeInsets.only(bottom: BluebookTokens.legendBottom),
            padding: const EdgeInsets.only(bottom: BluebookTokens.legendPaddingBottom),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: BluebookTokens.legendDivider)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _legendItem(
                  const LucideIcon(
                    LucideGlyphs.mapPin,
                    size: BluebookTokens.legendIcon,
                    color: BluebookTokens.currentPin,
                    fill: BluebookTokens.currentPin,
                  ),
                  'Current',
                ),
                const SizedBox(width: BluebookTokens.legendGap),
                _legendItem(const UnansweredSwatch(), 'Unanswered'),
                const SizedBox(width: BluebookTokens.legendGap),
                _legendItem(
                  const LucideIcon(
                    LucideGlyphs.flag,
                    size: BluebookTokens.legendIcon,
                    color: BluebookTokens.flagColor,
                    fill: BluebookTokens.flagColor,
                  ),
                  'For Review',
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: BluebookTokens.navigatorGridTop),
            child: QuestionGrid(
              columns: BluebookTokens.navigatorColumns,
              count: count,
              stateOf: stateOf,
              showCurrentPin: true,
              onTap: (i) {
                onJump(i);
                onClose();
              },
            ),
          ),
          // QuestionNavigator.tsx:79-90 — Go to Review Page.
          Container(
            margin: const EdgeInsets.only(top: BluebookTokens.navigatorFooterTop),
            padding: const EdgeInsets.only(top: BluebookTokens.navigatorFooterPadding),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: BluebookTokens.legendDivider)),
            ),
            child: Center(
              child: Pressable(
                key: const ValueKey('navigator.review'),
                semanticLabel: 'Go to Review Page',
                onTap: () {
                  onClose();
                  onGoToReview();
                },
                builder: (context, s) => Container(
                  // The border adds to the padding in Flutter as in CSS (border-box content offset).
                  padding: BluebookTokens.reviewButtonPadding,
                  decoration: BoxDecoration(
                    color: s.hovered ? BluebookTokens.reviewButtonHover : null,
                    border: Border.all(
                      color: BluebookTokens.reviewButtonColor,
                      width: BluebookTokens.reviewButtonBorder,
                    ),
                    borderRadius: BorderRadius.circular(BluebookTokens.pillRadius),
                  ),
                  child: Text(
                    'Go to Review Page',
                    style: chromeText(
                      14,
                      weight: FontWeight.w700,
                      color: BluebookTokens.reviewButtonColor,
                      height: 20 / 14,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );

    // QuestionNavigator.tsx:36 — `fixed inset-0 flex items-end justify-center bg-black/20
    // pb-[68px]`; a click on the scrim closes, a click on the card does not.
    return PointerSink(
      key: const ValueKey('navigator.scrim'),
      color: BluebookTokens.navigatorScrim,
      onTap: onClose,
      child: Padding(
        padding: const EdgeInsets.only(
          bottom: BluebookTokens.navigatorBottom,
          left: BluebookTokens.navigatorMargin,
          right: BluebookTokens.navigatorMargin,
        ),
        child: Align(
          alignment: Alignment.bottomCenter,
          child: GestureDetector(
            onTap: () {},
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                card,
                // QuestionNavigator.tsx:39 — the downward pointer at the bottom centre.
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: -BluebookTokens.navigatorPointerHeight,
                  child: const Center(
                    child: SizedBox(
                      width: BluebookTokens.navigatorPointerWidth,
                      height: BluebookTokens.navigatorPointerHeight,
                      child: CustomPaint(painter: _PointerPainter()),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PointerPainter extends CustomPainter {
  const _PointerPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();
    canvas.drawPath(path, Paint()..color = TwColors.white);
  }

  @override
  bool shouldRepaint(_PointerPainter oldDelegate) => false;
}
