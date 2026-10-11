// Short confirmations ("Diagnostics copied", "Saved to …"). One at a time, bottom centre,
// gone after a few seconds. No animation.
import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

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

/// Paints the current toast over [child].
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
            final (icon, color) = switch (t.tone) {
              ToastTone.info => (LucideIcons.info, AppColors.indigo),
              ToastTone.success => (LucideIcons.circleCheck, AppColors.success),
              ToastTone.error => (LucideIcons.circleAlert, AppColors.danger),
            };
            return Positioned(
              left: 0,
              right: 0,
              bottom: 28,
              child: Center(
                child: Semantics(
                  liveRegion: true,
                  child: Container(
                    constraints: const BoxConstraints(maxWidth: 560),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                    decoration: BoxDecoration(
                      color: AppColors.ink,
                      borderRadius: BorderRadius.circular(12),
                      boxShadow: dialogShadow,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(icon, size: 16, color: color == AppColors.indigo ? const Color(0xFF9DBCEB) : color),
                        const SizedBox(width: 10),
                        Flexible(
                          child: Text(
                            t.message,
                            style: AppText.body.copyWith(color: const Color(0xFFFFFFFF), fontWeight: FontWeight.w600),
                          ),
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
