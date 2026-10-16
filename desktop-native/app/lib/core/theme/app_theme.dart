// Typography and the Flutter theme for every screen outside the exam runner.
//
// Fonts: the website's own two faces, bundled (pubspec.yaml `fonts:`, assets/fonts/, built from
// frontend/src/app/fonts by desktop-native/tool/fonts/build_fonts.py):
//  * Geist — the website's shell and UI kit (`.ds-app`): the sidebar, the top bar, buttons,
//    inputs, dialogs, toasts, Settings and sign-in. It is the theme's font and the default text
//    style of every route (MasterSatApp wraps the navigator in it);
//  * Plus Jakarta Sans — the student dashboard pages (`.dzboard`): Past papers, Midterms and the
//    result pages, which wrap their content in [BoardFace].
// [AppText] styles name no family, so a style takes the face of the page it is drawn on (as
// CSS `font-family: inherit` does on the website). Glyphs the faces lack fall back to Segoe UI.
// Goldens load the bundled faces for real (test/core/harness/fonts.dart).
//
// Web habits removed here, centrally:
//  * no Material ink: `splashFactory: NoSplash.splashFactory`, transparent highlight/hover;
//  * no page transition animations (routes are instant; see app.dart);
//  * no hand cursor: the app's own controls (controls.dart) use the basic arrow;
//  * nothing selectable: plain [Text] is not selectable, and no SelectionArea is used.
import 'package:flutter/material.dart';

import 'tokens.dart';

abstract final class AppFonts {
  /// The website's UI face (`--font-geist-sans`, `.ds-app`).
  static const ui = 'Geist';

  /// The student dashboard's face (`--font-plus-jakarta`, `.dzboard`).
  static const board = 'Plus Jakarta Sans';

  /// For glyphs neither face draws (arrows, maths signs, Cyrillic): the Windows system font.
  static const fallback = <String>['Segoe UI', 'Segoe UI Variable Text', 'Arial'];
}

/// The text styles the app's screens use. No family and no fallback list: each takes both from
/// the text around it (see above). A fallback list alone would count as "a family was given" —
/// inside a [TextSpan] the engine would then stop inheriting the page's face.
abstract final class AppText {
  static const _base = TextStyle(
    color: AppColors.textPrimary,
    height: 1.5,
    leadingDistribution: TextLeadingDistribution.even,
    letterSpacing: 0,
    decoration: TextDecoration.none,
  );

  /// The small capitalised label above a page title ("SIMULATION": 12/800, .18em, faint).
  static final eyebrow = _base.copyWith(
    fontSize: 12,
    fontWeight: FontWeight.w800,
    letterSpacing: 12 * 0.18,
    height: 1.2,
    color: AppColors.faint,
  );

  /// Page title (pastpapers/page.tsx h1: 38/800, -.03em, line-height 1.05).
  static final title = _base.copyWith(
    fontSize: 38,
    fontWeight: FontWeight.w800,
    letterSpacing: 38 * -0.03,
    height: 1.05,
    color: AppColors.ink,
  );

  /// Section heading on a dashboard page (19/800 ink, -.01em).
  static final heading = _base.copyWith(
    fontSize: 19,
    fontWeight: FontWeight.w800,
    letterSpacing: 19 * -0.01,
    height: 1.3,
    color: AppColors.ink,
  );

  /// A dialog's title (Modal.tsx `ds-h3`: 18/600, -.01em, line-height 1.3).
  static final dialogTitle = _base.copyWith(
    fontSize: 18,
    fontWeight: FontWeight.w600,
    letterSpacing: 18 * -0.01,
    height: 1.3,
    color: AppColors.textPrimary,
  );

  /// Card title (16/800 ink).
  static final cardTitle = _base.copyWith(fontSize: 16, fontWeight: FontWeight.w800, height: 1.35, color: AppColors.ink);

  static final body = _base.copyWith(fontSize: 14, fontWeight: FontWeight.w500, color: AppColors.textPrimary);
  static final bodyMuted = _base.copyWith(fontSize: 14, fontWeight: FontWeight.w500, color: AppColors.mute);
  static final small = _base.copyWith(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.mute);
  static final caption = _base.copyWith(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.mute);

  /// Uppercase group label ("OCTOBER 2025": 13/800, .06em, mute).
  static final groupLabel = _base.copyWith(
    fontSize: 13,
    fontWeight: FontWeight.w800,
    letterSpacing: 13 * 0.06,
    height: 1.3,
    color: AppColors.mute,
  );

  /// Filter label ("REGION": 11/800, .1em, faint).
  static final filterLabel = _base.copyWith(
    fontSize: 11,
    fontWeight: FontWeight.w800,
    letterSpacing: 11 * 0.1,
    height: 1.3,
    color: AppColors.faint,
  );

  static final button = _base.copyWith(fontSize: 13, fontWeight: FontWeight.w700, height: 1.2);
  static final badge = _base.copyWith(fontSize: 11, fontWeight: FontWeight.w800, height: 1.2);

  /// Big score numbers (34/800, -.03em, line-height 1).
  static final score = _base.copyWith(
    fontSize: 34,
    fontWeight: FontWeight.w800,
    letterSpacing: 34 * -0.03,
    height: 1,
    color: AppColors.ink,
  );
  static final scoreLarge = _base.copyWith(
    fontSize: 56,
    fontWeight: FontWeight.w800,
    letterSpacing: 56 * -0.03,
    height: 1,
    color: AppColors.ink,
  );
  static final scoreSuffix = _base.copyWith(fontSize: 14, fontWeight: FontWeight.w700, height: 1.2, color: AppColors.faint);

  static TextStyle get base => _base;
}

/// Draws [child] in the student dashboard's face (Plus Jakarta Sans), as the website's
/// `.dzboard` scope does: every [AppText] style and control inside takes it.
class BoardFace extends StatelessWidget {
  const BoardFace({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) =>
      DefaultTextStyle.merge(style: const TextStyle(fontFamily: AppFonts.board), child: child);
}

/// The face of the text around [context] (Geist, or Plus Jakarta Sans inside a [BoardFace]).
/// For widgets whose text does not inherit the default style (a TextField).
String currentFace(BuildContext context) => DefaultTextStyle.of(context).style.fontFamily ?? AppFonts.ui;

/// The default text style of every route: Geist, ink, no decoration (MasterSatApp puts it above
/// the navigator, so dialogs, menus and toasts — which have no Material behind them — get it).
const TextStyle appDefaultTextStyle = TextStyle(
  fontFamily: AppFonts.ui,
  fontFamilyFallback: AppFonts.fallback,
  fontSize: 14,
  fontWeight: FontWeight.w500,
  color: AppColors.textPrimary,
  height: 1.5,
  leadingDistribution: TextLeadingDistribution.even,
  decoration: TextDecoration.none,
);

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
    fontFamily: AppFonts.ui,
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
    tooltipTheme: TooltipThemeData(
      waitDuration: const Duration(milliseconds: 600),
      decoration: BoxDecoration(color: AppColors.ink, borderRadius: BorderRadius.circular(8)),
      textStyle: appDefaultTextStyle.copyWith(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.onPrimary),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    ),
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
