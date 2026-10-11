// Typography and the Flutter theme for every screen outside the exam runner.
//
// Fonts (architecture §2.3): Segoe UI — the Windows system font — for a native feel. No font is
// bundled. Where Segoe UI is missing (macOS development) the fallback list applies; goldens load
// Arial under the "Segoe UI" family name (see test/core/harness/fonts.dart for why).
//
// Web habits removed here, centrally:
//  * no Material ink: `splashFactory: NoSplash.splashFactory`, transparent highlight/hover;
//  * no page transition animations (routes are instant; see app.dart);
//  * no hand cursor: the app's own controls (controls.dart) use the basic arrow;
//  * nothing selectable: plain [Text] is not selectable, and no SelectionArea is used.
import 'package:flutter/material.dart';

import 'tokens.dart';

abstract final class AppFonts {
  static const family = 'Segoe UI';

  /// Selawik is Microsoft's open, metric-compatible Segoe UI substitute; Arial and the platform
  /// default follow.
  static const fallback = <String>['Segoe UI Variable Text', 'Selawik', 'Arial'];
}

/// The text styles the app's screens use. Sizes are desktop density (14 px body).
abstract final class AppText {
  static const _base = TextStyle(
    fontFamily: AppFonts.family,
    fontFamilyFallback: AppFonts.fallback,
    color: AppColors.textPrimary,
    height: 1.35,
    letterSpacing: 0,
    decoration: TextDecoration.none,
  );

  /// The small capitalised label above a page title ("YOUR TESTS", "SIMULATION").
  static final eyebrow = _base.copyWith(
    fontSize: 12,
    fontWeight: FontWeight.w800,
    letterSpacing: 2.1,
    color: AppColors.faint,
  );

  /// Page title.
  static final title = _base.copyWith(fontSize: 30, fontWeight: FontWeight.w800, height: 1.1, color: AppColors.ink);

  /// Section heading ("Midterms").
  static final heading = _base.copyWith(fontSize: 19, fontWeight: FontWeight.w800, color: AppColors.ink);

  /// Card title.
  static final cardTitle = _base.copyWith(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink);

  static final body = _base.copyWith(fontSize: 14, fontWeight: FontWeight.w500, color: AppColors.textPrimary);
  static final bodyMuted = _base.copyWith(fontSize: 14, fontWeight: FontWeight.w500, color: AppColors.mute);
  static final small = _base.copyWith(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.mute);
  static final caption = _base.copyWith(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.mute);

  /// Uppercase group label ("OCTOBER 2025", "AVAILABLE NOW").
  static final groupLabel = _base.copyWith(
    fontSize: 12,
    fontWeight: FontWeight.w800,
    letterSpacing: 0.9,
    color: AppColors.mute,
  );

  /// Filter label ("REGION").
  static final filterLabel = _base.copyWith(
    fontSize: 11,
    fontWeight: FontWeight.w800,
    letterSpacing: 1.1,
    color: AppColors.faint,
  );

  static final button = _base.copyWith(fontSize: 13, fontWeight: FontWeight.w700, height: 1.2);
  static final badge = _base.copyWith(fontSize: 11, fontWeight: FontWeight.w800, height: 1.2);

  /// Big score numbers.
  static final score = _base.copyWith(fontSize: 34, fontWeight: FontWeight.w800, height: 1, color: AppColors.ink);
  static final scoreLarge = _base.copyWith(fontSize: 56, fontWeight: FontWeight.w800, height: 1, color: AppColors.ink);
  static final scoreSuffix = _base.copyWith(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.faint);

  static TextStyle get base => _base;
}

/// The Material theme, stripped of web/mobile habits. Material is only used for its text
/// input; every button, chip and card is the app's own widget.
ThemeData buildAppTheme() {
  const scheme = ColorScheme.light(
    primary: AppColors.primary,
    onPrimary: AppColors.onPrimary,
    secondary: AppColors.teal,
    surface: AppColors.card,
    onSurface: AppColors.textPrimary,
    error: AppColors.danger,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.background,
    canvasColor: AppColors.background,
    fontFamily: AppFonts.family,
    fontFamilyFallback: AppFonts.fallback,
    splashFactory: NoSplash.splashFactory,
    splashColor: Colors.transparent,
    highlightColor: Colors.transparent,
    hoverColor: Colors.transparent,
    focusColor: Colors.transparent,
    visualDensity: VisualDensity.compact,
    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.windows: _InstantTransitions(),
        TargetPlatform.macOS: _InstantTransitions(),
        TargetPlatform.linux: _InstantTransitions(),
        TargetPlatform.android: _InstantTransitions(),
        TargetPlatform.iOS: _InstantTransitions(),
        TargetPlatform.fuchsia: _InstantTransitions(),
      },
    ),
    textSelectionTheme: const TextSelectionThemeData(
      cursorColor: AppColors.primary,
      selectionColor: AppColors.primarySoft,
    ),
    scrollbarTheme: ScrollbarThemeData(
      thickness: WidgetStateProperty.all(6),
      radius: const Radius.circular(3),
      thumbColor: WidgetStateProperty.all(AppColors.borderStrong),
    ),
    tooltipTheme: const TooltipThemeData(waitDuration: Duration(milliseconds: 600)),
  );
}

class _InstantTransitions extends PageTransitionsBuilder {
  const _InstantTransitions();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) =>
      child;
}
