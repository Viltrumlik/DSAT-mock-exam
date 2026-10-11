// The runner's two kinds of transient message:
//  * the timer warnings (ExamRunnerPage.tsx:599-629, 1276-1284) — "5 minutes remaining in
//    this module." etc., a dark pill at the top centre for 8 s;
//  * notices (frontend/src/components/ToastProvider.tsx:47-61) — report outcomes, "Pause
//    needs a connection", reconnecting — a card at the top-right for 3.2 s, at most three.
import 'dart:async';

import 'package:flutter/widgets.dart';

import '../tokens/bluebook_tokens.dart';
import 'runner_style.dart';

enum ToastTone { neutral, success, error }

@immutable
class RunnerToast {
  const RunnerToast(this.id, this.message, this.tone);
  final int id;
  final String message;
  final ToastTone tone;
}

/// The website's timer-warning thresholds (ExamRunnerPage.tsx:614-616).
String? timerToastFor(int secondsLeft) {
  if (secondsLeft <= 0) return 'Time’s up — submitting this module…';
  if (secondsLeft <= 60) return '1 minute remaining in this module.';
  if (secondsLeft <= 300) return '5 minutes remaining in this module.';
  return null;
}

/// The threshold a toast belongs to (each fires once per module).
int timerToastThreshold(int secondsLeft) => secondsLeft <= 0 ? 0 : (secondsLeft <= 60 ? 60 : 300);

class RunnerToasts extends ChangeNotifier {
  RunnerToasts({
    this.noticeDuration = BluebookTokens.noticeDuration,
    this.timerDuration = BluebookTokens.timerToastDuration,
  });

  final Duration noticeDuration;
  final Duration timerDuration;

  final List<RunnerToast> _notices = [];
  final List<Timer> _timers = [];
  String? _timerMessage;
  Timer? _timerTimer;
  int _next = 0;
  bool _disposed = false;

  List<RunnerToast> get notices => List.unmodifiable(_notices);
  String? get timerMessage => _timerMessage;

  /// ToastProvider.tsx:23-30 — newest first, at most three, each for 3.2 s.
  void push(String message, {ToastTone tone = ToastTone.neutral}) {
    if (_disposed) return;
    final t = RunnerToast(_next++, message, tone);
    _notices.insert(0, t);
    if (_notices.length > 3) _notices.removeRange(3, _notices.length);
    _timers.add(
      Timer(noticeDuration, () {
        if (_disposed) return;
        _notices.removeWhere((x) => x.id == t.id);
        notifyListeners();
      }),
    );
    notifyListeners();
  }

  void showTimer(String message) {
    if (_disposed) return;
    _timerMessage = message;
    _timerTimer?.cancel();
    _timerTimer = Timer(timerDuration, () {
      if (_disposed) return;
      _timerMessage = null;
      notifyListeners();
    });
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final t in _timers) {
      t.cancel();
    }
    _timerTimer?.cancel();
    super.dispose();
  }
}

/// Draws [RunnerToasts]: the timer pill and the notice stack. Pointer-transparent except the
/// cards themselves.
class RunnerToastLayer extends StatelessWidget {
  const RunnerToastLayer({super.key, required this.toasts, this.showTimer = true});
  final RunnerToasts toasts;

  /// The timer pill belongs to the answering screens (the website shows it only there).
  final bool showTimer;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: toasts,
    builder: (context, _) {
      final timer = showTimer ? toasts.timerMessage : null;
      final notices = toasts.notices;
      final width = MediaQuery.sizeOf(context).width;
      return Stack(
        children: [
          if (timer != null)
            Positioned(
              top: BluebookTokens.timerToastTop,
              left: 0,
              right: 0,
              child: IgnorePointer(
                child: Center(
                  child: Semantics(
                    liveRegion: true,
                    child: Container(
                      key: const ValueKey('toast.timer'),
                      padding: BluebookTokens.timerToastPadding,
                      decoration: BoxDecoration(
                        color: BluebookTokens.timerToastBackground,
                        borderRadius: BorderRadius.circular(BluebookTokens.timerToastRadius),
                        boxShadow: TwShadows.xl,
                      ),
                      child: Text(
                        timer,
                        style: chromeText(
                          BluebookTokens.timerToastSize,
                          weight: FontWeight.w700,
                          color: TwColors.white,
                          height: 20 / 14,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          if (notices.isNotEmpty)
            Positioned(
              top: BluebookTokens.noticeInset,
              right: BluebookTokens.noticeInset,
              width: width * BluebookTokens.noticeMaxViewportFraction < BluebookTokens.noticeWidth
                  ? width * BluebookTokens.noticeMaxViewportFraction
                  : BluebookTokens.noticeWidth,
              // Never in the way: the cards hold nothing to click, and they sit over the
              // header's tool cluster.
              child: IgnorePointer(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < notices.length; i++) ...[
                      if (i > 0) const SizedBox(height: BluebookTokens.noticeGap),
                      _NoticeCard(notices[i]),
                    ],
                  ],
                ),
              ),
            ),
        ],
      );
    },
  );
}

class _NoticeCard extends StatelessWidget {
  const _NoticeCard(this.toast);
  final RunnerToast toast;

  @override
  Widget build(BuildContext context) {
    // ToastProvider.tsx:51-56 — success `border-primary/20 bg-primary/5`, error
    // `border-red-500/20 bg-red-500/5`, neutral `border-border bg-card`.
    final (Color border, Color bg) = switch (toast.tone) {
      ToastTone.success => (
        BluebookTokens.brandPrimary.withValues(alpha: 0.2),
        const Color(0xFFF4F7FC),
      ), // #2a68c0 at 5% on white
      ToastTone.error => (TwColors.red500.withValues(alpha: 0.2), const Color(0xFFFFF4F5)), // red-500 at 5% on white
      ToastTone.neutral => (BluebookTokens.dialogBorder, TwColors.white),
    };
    return Semantics(
      liveRegion: true,
      child: Container(
        key: ValueKey('toast.${toast.id}'),
        padding: BluebookTokens.noticePadding,
        decoration: BoxDecoration(
          color: bg,
          border: Border.all(color: border),
          borderRadius: BorderRadius.circular(BluebookTokens.noticeRadius),
          boxShadow: TwShadows.lg,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              toast.tone == ToastTone.error ? 'Error' : 'Notice',
              style: uiText(BluebookTokens.noticeTitleSize, weight: FontWeight.w800, height: 20 / 14),
            ),
            const SizedBox(height: BluebookTokens.noticeMessageTop),
            Text(
              toast.message,
              key: const ValueKey('toast.message'),
              style: uiText(14, color: BluebookTokens.textSecondary, height: 20 / 14),
            ),
          ],
        ),
      ),
    );
  }
}
