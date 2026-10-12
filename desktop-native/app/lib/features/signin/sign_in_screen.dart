// Sign-in (architecture §2.3, §6 "Sign-in"): the visual twin of the website's /login, with one
// way in — the student's own browser (Google and Telegram refuse embedded web views).
//
//   signed out          "Sign in with your browser"
//   waiting             "Waiting for your browser…" + Open the browser again / Cancel
//   exchanging          "Signing you in…"
//   problem             a notice above the button; when the exchange can be re-sent
//                       (offline, server busy) its "Try again" RE-SENDS the same request —
//                       no new browser trip, nothing reloads.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/brand.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';

class SignInScreen extends StatelessWidget {
  const SignInScreen({super.key});

  /// Below this width the brand panel is hidden (the website's `lg:` breakpoint).
  static const brandPanelMinWidth = 960.0;

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: LayoutBuilder(
        builder: (context, c) {
          final wide = c.maxWidth >= brandPanelMinWidth;
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (wide) Expanded(child: BrandPanel(year: services.clock.now().toLocal().year)),
              Expanded(
                child: ListenableBuilder(
                  listenable: services.auth,
                  builder: (context, _) => _SignInPanel(auth: services.auth, showLogo: !wide),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The blue brand half (website /login `<aside>`). Static: no floating animation.
class BrandPanel extends StatelessWidget {
  const BrandPanel({super.key, required this.year});

  final int year;

  @override
  Widget build(BuildContext context) {
    const white = Color(0xFFFFFFFF);
    final points = <(IconData, String)>[
      (LucideIcons.chartLine, 'Live readiness and score trends'),
      (LucideIcons.sparkles, 'Classroom assessments and monthly midterm exams'),
      (LucideIcons.shieldCheck, 'A real, locked-down exam environment'),
    ];
    return ExcludeSemantics(
      excluding: false,
      // A solid brand blue under the gradient: if a graphics driver ever fails to draw the
      // gradient, the white text stays readable instead of the panel looking empty (seen on
      // the owner's laptop under Impeller, 2026-10-12). The gradient covers it entirely.
      child: ColoredBox(
        color: AppColors.primary,
        child: Container(
          clipBehavior: Clip.hardEdge,
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              // CSS 160deg ≈ from the top-left-ish corner down to the bottom.
              begin: Alignment(-0.34, -1),
              end: Alignment(0.34, 1),
              colors: [AppColors.primary, AppColors.brandGradientEnd],
            ),
          ),
          child: Stack(
            children: [
              // The website's soft shapes, without their drift.
              const Positioned(right: -70, top: -50, child: _Blob(size: 280, radius: 140, color: Color(0x1AFFFFFF))),
              const Positioned(right: 60, bottom: -90, child: _Blob(size: 200, radius: 44, color: Color(0x14FFFFFF))),
              Positioned(
                left: -60,
                bottom: 120,
                child: Container(
                  width: 150,
                  height: 150,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0x1CFFFFFF), width: 18),
                  ),
                ),
              ),
              const Positioned(left: 40, top: 180, child: _Blob(size: 16, radius: 5, color: Color(0x4DFFFFFF))),
              Padding(
                padding: const EdgeInsets.all(48),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const BrandWordmark(size: 40, color: white, logoColor: white),
                    const Spacer(),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 440),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Your digital SAT, mastered.',
                            style: AppText.title.copyWith(fontSize: 44, height: 1.05, color: white),
                          ),
                          const SizedBox(height: 36),
                          for (final p in points)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 16),
                              child: Row(
                                children: [
                                  Container(
                                    width: 32,
                                    height: 32,
                                    decoration: BoxDecoration(
                                      color: const Color(0x26FFFFFF),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Icon(p.$1, size: 16, color: white),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Text(p.$2, style: AppText.body.copyWith(fontSize: 15, color: white)),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                    const Spacer(),
                    Text(
                      '© $year MasterSAT Center',
                      style: AppText.caption.copyWith(color: const Color(0xB3FFFFFF), fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Blob extends StatelessWidget {
  const _Blob({required this.size, required this.radius, required this.color});

  final double size;
  final double radius;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(radius)),
  );
}

class _SignInPanel extends StatelessWidget {
  const _SignInPanel({required this.auth, required this.showLogo});

  final AuthController auth;
  final bool showLogo;

  @override
  Widget build(BuildContext context) {
    final status = auth.status;
    final problem = auth.problem;
    final waiting = status == AuthStatus.waitingForBrowser;
    final exchanging = status == AuthStatus.exchanging;

    final helper = waiting
        ? 'Finish signing in in your browser, then come back — this screen updates on its own.'
        : exchanging
        ? 'Almost there — getting your tests ready.'
        : 'Your browser opens so you can sign in with Google, Telegram or your email — whatever you use '
              'on the website. The app takes it from there.';

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 40),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (showLogo) ...[
                const Center(child: BrandLogo(size: 64)),
                const SizedBox(height: 12),
                Center(child: Text('MasterSAT', style: AppText.title.copyWith(fontSize: 26))),
                const SizedBox(height: 28),
              ] else ...[
                Text('Welcome back', style: AppText.title.copyWith(fontSize: 34)),
                const SizedBox(height: 6),
                Text('Sign in to see your tests.', style: AppText.bodyMuted),
                const SizedBox(height: 28),
              ],
              if (problem != null) ...[
                SignInProblemNotice(problem: problem, onRetry: problem.canRetry ? () => unawaited(auth.retry()) : null),
                const SizedBox(height: 16),
              ],
              AppButton(
                label: 'Sign in with your browser',
                icon: LucideIcons.globe,
                size: AppButtonSize.large,
                expand: true,
                autofocus: true,
                busy: waiting || exchanging,
                busyLabel: exchanging ? 'Signing you in…' : 'Waiting for your browser…',
                onPressed: () => unawaited(auth.signIn()),
              ),
              const SizedBox(height: 12),
              Text(
                helper,
                textAlign: TextAlign.center,
                style: AppText.caption.copyWith(fontWeight: FontWeight.w500, height: 1.5),
              ),
              if (waiting) ...[
                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    AppLinkButton(
                      label: 'Open the browser again',
                      icon: LucideIcons.externalLink,
                      onPressed: () => unawaited(auth.signIn()),
                    ),
                    const SizedBox(width: 8),
                    AppLinkButton(label: 'Cancel', icon: LucideIcons.x, onPressed: auth.cancelSignIn),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The notice above the sign-in button. Retry (when offered) re-sends the same exchange.
class SignInProblemNotice extends StatelessWidget {
  const SignInProblemNotice({super.key, required this.problem, this.onRetry});

  final AuthProblem problem;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final (tone, title) = switch (problem.kind) {
      AuthProblemKind.offline => (NoticeTone.offline, "You're offline"),
      AuthProblemKind.server => (NoticeTone.warning, "Couldn't sign you in"),
      AuthProblemKind.linkExpired => (NoticeTone.warning, 'That sign-in link has expired'),
      AuthProblemKind.notStartedHere => (NoticeTone.info, 'Start the sign-in from this app'),
      AuthProblemKind.browserFailed => (NoticeTone.danger, "Couldn't open your browser"),
      AuthProblemKind.refused => (NoticeTone.danger, "This account can't sign in here"),
      AuthProblemKind.sessionEnded => (NoticeTone.info, 'Please sign in again'),
      AuthProblemKind.updateRequired => (NoticeTone.warning, 'Update required'),
    };
    return NoticeBanner(
      tone: tone,
      title: title,
      message: problem.message,
      actionLabel: onRetry == null ? null : 'Try again',
      onAction: onRetry,
    );
  }
}
