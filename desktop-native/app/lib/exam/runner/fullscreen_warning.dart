// Port of components/FullscreenWarning.tsx: the blocking overlay a past paper shows when the
// student is out of full screen while a module is on screen. The runner raises it after a
// 400 ms grace and counts down 10 s; at 0 it runs Save & Exit (ExamRunnerPage.tsx:405-470,
// 786-795). The one action re-enters full screen — on the app, re-takes the lockdown.
//
// Website classes, in order: overlay `fixed inset-0 z-[80] bg-slate-900/80 px-6`, centred;
// card `max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl`; icon `h-12 w-12
// rounded-full bg-blue-50` holding Maximize `h-6 w-6 text-blue-700`; title `mt-4 text-xl
// font-bold tracking-tight`; body `mt-2 text-sm font-medium text-slate-500`; countdown `mt-5
// rounded-xl border-red-200 bg-red-50 px-4 py-3` (`text-sm font-semibold text-red-800`, then
// `mt-0.5 text-xs text-red-600`); button `mt-6 w-full rounded-full bg-blue-700 px-6 py-3
// text-base font-bold text-white hover:bg-blue-800`, Maximize `h-5 w-5`, `gap-2`. No backdrop
// blur (the website dropped it: it flashed during the full-screen change).
//
// Native rules: nothing under it can be clicked or typed into; it takes the keyboard when it
// rises and swallows every key (Tab moves to the button, Enter/Space press it); the arrow
// cursor; no hover lift.
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../tokens/bluebook_tokens.dart';
import 'icons/lucide_glyphs.dart';
import 'icons/lucide_icon.dart';
import 'runner_style.dart';

/// FullscreenWarning.tsx, verbatim.
abstract final class FullscreenWarningCopy {
  static const title = 'Return to full screen';
  static const body = 'This test must be taken in full screen. You exited full screen — your timer is still running.';
  static const saved = 'Your answers are saved — you can resume where you left off.';
  static const button = 'Return to full screen';

  /// "You’ll be removed from the test in 7 seconds." (1 → "second"; never below 0).
  static String removedIn(int secondsLeft) {
    final s = secondsLeft < 0 ? 0 : secondsLeft;
    return 'You’ll be removed from the test in $s ${s == 1 ? 'second' : 'seconds'}.';
  }
}

/// The website's grace before the warning shows, and its countdown.
const Duration fullscreenWarningGrace = Duration(milliseconds: 400);
const int fullscreenWarningSeconds = 10;

class FullscreenWarning extends StatefulWidget {
  const FullscreenWarning({super.key, required this.onReturn, this.secondsLeft});

  final VoidCallback onReturn;

  /// Seconds left before the student is removed from the test (null hides the countdown).
  final int? secondsLeft;

  @override
  State<FullscreenWarning> createState() => _FullscreenWarningState();
}

class _FullscreenWarningState extends State<FullscreenWarning> {
  final FocusScopeNode _scope = FocusScopeNode(debugLabel: 'fullscreenWarning');

  @override
  void initState() {
    super.initState();
    // The runner already holds the keyboard, so `autofocus` would not move it: take it, so Tab
    // can only reach this card's button and never a runner button underneath.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _scope.requestFocus();
    });
  }

  @override
  void dispose() {
    _scope.dispose();
    super.dispose();
  }

  static KeyEventResult _swallow(FocusNode node, KeyEvent event) {
    // Tab / Shift+Tab still reach the button (focus traversal); nothing else gets through.
    if (event.logicalKey == LogicalKeyboardKey.tab) return KeyEventResult.ignored;
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    final left = widget.secondsLeft;
    final onReturn = widget.onReturn;
    final card = Container(
      key: const ValueKey('fullscreenWarning.card'),
      width: double.infinity,
      constraints: const BoxConstraints(maxWidth: 448),
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: TwColors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: TwShadows.xxl,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 48,
              height: 48,
              decoration: const BoxDecoration(color: TwColors.blue50, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: const LucideIcon(LucideGlyphs.maximize, size: 24, color: TwColors.blue700),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            FullscreenWarningCopy.title,
            textAlign: TextAlign.center,
            style: chromeText(20, weight: FontWeight.w700, height: 28 / 20, trackingEm: BluebookTokens.trackingTight),
          ),
          const SizedBox(height: 8),
          Text(
            FullscreenWarningCopy.body,
            textAlign: TextAlign.center,
            style: chromeText(14, weight: FontWeight.w500, color: TwColors.slate500, height: 20 / 14),
          ),
          if (left != null) ...[
            const SizedBox(height: 20),
            Semantics(
              liveRegion: true,
              child: Container(
                key: const ValueKey('fullscreenWarning.countdown'),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: TwColors.red50,
                  border: Border.all(color: TwColors.red200),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      FullscreenWarningCopy.removedIn(left),
                      textAlign: TextAlign.center,
                      style: chromeText(
                        14,
                        weight: FontWeight.w600,
                        color: TwColors.red800,
                        height: 20 / 14,
                        features: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      FullscreenWarningCopy.saved,
                      textAlign: TextAlign.center,
                      style: chromeText(12, color: TwColors.red600, height: 16 / 12),
                    ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 24),
          Pressable(
            key: const ValueKey('fullscreenWarning.return'),
            semanticLabel: FullscreenWarningCopy.button,
            onTap: onReturn,
            builder: (context, s) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              decoration: BoxDecoration(
                color: s.hovered ? TwColors.blue800 : TwColors.blue700,
                borderRadius: BorderRadius.circular(BluebookTokens.pillRadius),
                boxShadow: s.focused ? const [BoxShadow(color: TwColors.blue500, spreadRadius: 2)] : null,
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const LucideIcon(LucideGlyphs.maximize, size: 20, color: TwColors.white),
                  const SizedBox(width: 8),
                  Text(
                    FullscreenWarningCopy.button,
                    style: chromeText(16, weight: FontWeight.w700, color: TwColors.white, height: 24 / 16),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );

    return Focus(
      onKeyEvent: _swallow,
      child: FocusScope(
        node: _scope,
        autofocus: true,
        child: BlockSemantics(
          child: Semantics(
            key: const ValueKey('fullscreenWarning'),
            scopesRoute: true,
            explicitChildNodes: true,
            label: 'Full screen required',
            child: PointerSink(
              color: TwColors.slate900.withValues(alpha: 0.8),
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: card,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
