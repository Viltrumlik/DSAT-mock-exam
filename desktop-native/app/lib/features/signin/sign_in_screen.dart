// Sign-in (architecture §2.3, §6 "Sign-in"): the visual twin of the website's /login, with the
// app's own login form — the same login (email, username or phone) and password the website
// takes.
//
//   signed out   Login + Password (show/hide) + "Sign in"; Enter submits
//   signing in   "Signing in…" on the button
//   problem      a notice under the button. A refusal clears the password (the login stays);
//                when the sign-in never reached the server or the server failed, the password
//                stays and "Try again" sends the same login again.
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

class _SignInPanel extends StatefulWidget {
  const _SignInPanel({required this.auth, required this.showLogo});

  final AuthController auth;
  final bool showLogo;

  @override
  State<_SignInPanel> createState() => _SignInPanelState();
}

class _SignInPanelState extends State<_SignInPanel> {
  final _login = TextEditingController();
  final _password = TextEditingController();
  final _passwordFocus = FocusNode(debugLabel: 'password');
  bool _obscured = true;

  @override
  void initState() {
    super.initState();
    _login.addListener(_changed);
    _password.addListener(_changed);
  }

  @override
  void dispose() {
    _login.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  void _changed() => setState(() {});

  bool get _busy => widget.auth.status == AuthStatus.signingIn;

  bool get _canSubmit => !_busy && _login.text.trim().isNotEmpty && _password.text.isNotEmpty;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    await widget.auth.signIn(_login.text, _password.text);
    if (!mounted) return; // signed in: Home replaced this screen
    final problem = widget.auth.problem;
    if (widget.auth.status == AuthStatus.signedOut && problem != null && !problem.canRetry) {
      _password.clear();
      _passwordFocus.requestFocus();
    }
  }

  /// Enter in the login field: on to the password, or sign in when both are filled.
  void _loginSubmitted(String _) {
    if (_canSubmit) {
      unawaited(_submit());
    } else {
      _passwordFocus.requestFocus();
    }
  }

  @override
  Widget build(BuildContext context) {
    final problem = widget.auth.problem;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 40),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.showLogo) ...[
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
              const _FieldLabel('Login'),
              AppTextField(
                controller: _login,
                hint: 'Email, username or phone',
                prefixIcon: LucideIcons.user,
                semanticLabel: 'Login',
                autofocus: true,
                autocorrect: false,
                textInputAction: TextInputAction.next,
                onSubmitted: _loginSubmitted,
              ),
              const SizedBox(height: 16),
              const _FieldLabel('Password'),
              AppTextField(
                controller: _password,
                focusNode: _passwordFocus,
                hint: 'Password',
                prefixIcon: LucideIcons.lock,
                semanticLabel: 'Password',
                obscureText: _obscured,
                autocorrect: false,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => unawaited(_submit()),
                trailing: AppIconButton(
                  icon: _obscured ? LucideIcons.eye : LucideIcons.eyeOff,
                  semanticLabel: _obscured ? 'Show password' : 'Hide password',
                  size: 30,
                  onPressed: () => setState(() => _obscured = !_obscured),
                ),
              ),
              const SizedBox(height: 22),
              AppButton(
                label: 'Sign in',
                size: AppButtonSize.large,
                expand: true,
                busy: _busy,
                busyLabel: 'Signing in…',
                onPressed: _canSubmit ? () => unawaited(_submit()) : null,
              ),
              if (problem != null) ...[
                const SizedBox(height: 16),
                SignInProblemNotice(problem: problem, onRetry: problem.canRetry && _canSubmit ? () => unawaited(_submit()) : null),
              ],
              const SizedBox(height: 14),
              Text(
                'Forgot your password? Ask your teacher.',
                textAlign: TextAlign.center,
                style: AppText.caption.copyWith(fontWeight: FontWeight.w500, height: 1.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: ExcludeSemantics(
      child: Text(text, style: AppText.small.copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w700)),
    ),
  );
}

/// The notice under the sign-in button. Retry (when offered) sends the same login again.
class SignInProblemNotice extends StatelessWidget {
  const SignInProblemNotice({super.key, required this.problem, this.onRetry});

  final AuthProblem problem;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final (tone, title) = switch (problem.kind) {
      AuthProblemKind.invalidCredentials => (NoticeTone.danger, "Couldn't sign you in"),
      AuthProblemKind.passwordNotSet => (NoticeTone.info, 'Set your password first'),
      AuthProblemKind.refused => (NoticeTone.danger, "This account can't sign in here"),
      AuthProblemKind.tooManyAttempts => (NoticeTone.warning, 'Too many tries'),
      AuthProblemKind.offline => (NoticeTone.offline, "You're offline"),
      AuthProblemKind.server => (NoticeTone.warning, "Couldn't sign you in"),
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
