// Short confirmations ("Diagnostics copied", "Saved to …"). One at a time, top right (the
// website's ToastProvider), gone after a few seconds. No animation.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/widgets.dart';

import 'app_theme.dart';
import 'tokens.dart';

enum ToastTone { info, success, error }

@immutable
class Toast {
  const Toast(this.message, {this.tone = ToastTone.info});
  final String message;
  final ToastTone tone;
}

class ToastController extends ChangeNotifier {
  ToastController({this.duration = const Duration(seconds: 4)});

  final Duration duration;
  Toast? _current;
  Timer? _timer;

  Toast? get current => _current;

  void show(String message, {ToastTone tone = ToastTone.info}) {
    _timer?.cancel();
    _current = Toast(message, tone: tone);
    _timer = Timer(duration, dismiss);
    notifyListeners();
  }

  void dismiss() {
    _timer?.cancel();
    _timer = null;
    if (_current == null) return;
    _current = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}

/// Paints the current toast over [child], as the website's ToastProvider does: a white card
/// (radius 16, hairline border, Tailwind `shadow-lg`) in the top-right corner, 420 wide at most,
/// "Notice" or "Error" in 14/800 over the message in muted 14 px. A success is tinted
/// primary/5, an error red-500/5.
class ToastHost extends StatelessWidget {
  const ToastHost({super.key, required this.controller, required this.child});

  final ToastController controller;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned.fill(child: child),
        ListenableBuilder(
          listenable: controller,
          builder: (context, _) {
            final t = controller.current;
            if (t == null) return const SizedBox.shrink();
            final (bg, border) = switch (t.tone) {
              ToastTone.info => (AppColors.card, AppColors.border),
              // bg-primary/5 and border-primary/20 over white.
              ToastTone.success => (const Color(0xFFF4F7FC), const Color(0x332A68C0)),
              // Tailwind v4 red-500 (#fb2c36) at 5 % and 20 %.
              ToastTone.error => (const Color(0xFFFFF5F5), const Color(0x33FB2C36)),
            };
            final width = MediaQuery.sizeOf(context).width;
            return Positioned(
              top: 20,
              right: 20,
              width: math.min(420, width * 0.92),
              child: Semantics(
                liveRegion: true,
                container: true,
                child: DefaultTextStyle(
                  style: appDefaultTextStyle,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    decoration: BoxDecoration(
                      color: bg,
                      borderRadius: BorderRadius.circular(AppRadii.kitLg),
                      border: Border.all(color: border),
                      boxShadow: AppShadows.toast,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          t.tone == ToastTone.error ? 'Error' : 'Notice',
                          style: AppText.body.copyWith(fontWeight: FontWeight.w800, height: 1.43, color: AppColors.textPrimary),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          t.message,
                          style: AppText.body.copyWith(fontWeight: FontWeight.w400, height: 1.43, color: AppColors.textSecondary),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ],
    );
  }
}
