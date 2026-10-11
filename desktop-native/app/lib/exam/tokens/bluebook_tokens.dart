// Every colour, size, spacing, radius and font the native runner frame uses, extracted by hand
// from the website runner (frontend/src/features/testing-simulation at f2fd97b9) and its CSS.
// Each value cites the file:line it comes from. Paths are relative to frontend/src/features/
// testing-simulation/ unless they start with frontend/ or tailwindcss/.
//
// This file will later be replaced by a generated `bluebook_tokens.g.dart` (architecture §3,
// "Generated tokens": getComputedStyle dumped by Playwright). KEEP THE NAMES: the runner only
// refers to tokens through these names.
//
// Colours. The website is on Tailwind v4 (frontend/package.json "tailwindcss": "^4"), whose
// palette is defined in OKLCH (tailwindcss/theme.css, v4.2.1). Each palette colour below is
// that OKLCH value converted to sRGB with channels clipped, i.e. what Chromium paints on an
// sRGB display; the OKLCH source is in the comment. Arbitrary values (`#253985`) are verbatim.
//
// Fonts. The runner chrome's stack (frontend/src/app/globals.css:859-865) resolves to Arial on
// Windows; question text is Georgia and lives inside the content island. Nothing is bundled.
import 'package:flutter/painting.dart';

/// Tailwind v4.2.1 palette entries the runner uses (sRGB of the OKLCH value).
abstract final class TwColors {
  static const white = Color(0xFFFFFFFF); // tailwindcss/theme.css --color-white: #fff
  static const black = Color(0xFF000000); // tailwindcss/theme.css --color-black: #000

  static const slate50 = Color(0xFFF8FAFC); // oklch(98.4% 0.003 247.858)
  static const slate100 = Color(0xFFF1F5F9); // oklch(96.8% 0.007 247.896)
  static const slate200 = Color(0xFFE2E8F0); // oklch(92.9% 0.013 255.508)
  static const slate300 = Color(0xFFCAD5E2); // oklch(86.9% 0.022 252.894)
  static const slate400 = Color(0xFF90A1B9); // oklch(70.4% 0.04 256.788)
  static const slate500 = Color(0xFF62748E); // oklch(55.4% 0.046 257.417)
  static const slate600 = Color(0xFF45556C); // oklch(44.6% 0.043 257.281)
  static const slate700 = Color(0xFF314158); // oklch(37.2% 0.044 257.287)
  static const slate800 = Color(0xFF1D293D); // oklch(27.9% 0.041 260.031)
  static const slate900 = Color(0xFF0F172B); // oklch(20.8% 0.042 265.755)
  static const slate950 = Color(0xFF020618); // oklch(12.9% 0.042 264.695)

  static const red50 = Color(0xFFFEF2F2); // oklch(97.1% 0.013 17.38)
  static const red100 = Color(0xFFFFE2E2); // oklch(93.6% 0.032 17.717)
  static const red200 = Color(0xFFFFC9C9); // oklch(88.5% 0.062 18.334)
  static const red500 = Color(0xFFFB2C36); // oklch(63.7% 0.237 25.331)
  static const red600 = Color(0xFFE7000B); // oklch(57.7% 0.245 27.325)
  static const red700 = Color(0xFFC10007); // oklch(50.5% 0.213 27.518)
  static const red800 = Color(0xFF9F0712); // oklch(44.4% 0.177 26.899)
  static const red950 = Color(0xFF460809); // oklch(25.8% 0.092 26.042)

  static const blue50 = Color(0xFFEFF6FF); // oklch(97% 0.014 254.604)
  static const blue500 = Color(0xFF2B7FFF); // oklch(62.3% 0.214 259.815)
  static const blue600 = Color(0xFF155DFC); // oklch(54.6% 0.245 262.881)
  static const blue700 = Color(0xFF1447E6); // oklch(48.8% 0.243 264.376)
  static const blue800 = Color(0xFF193CB8); // oklch(42.4% 0.199 265.638)

  static const amber50 = Color(0xFFFFFBEB); // oklch(98.7% 0.022 95.277)
  static const amber100 = Color(0xFFFEF3C6); // oklch(96.2% 0.059 95.617)
  static const amber200 = Color(0xFFFEE685); // oklch(92.4% 0.12 95.746)
  static const amber900 = Color(0xFF7B3306); // oklch(41.4% 0.112 45.904)

  static const emerald600 = Color(0xFF009966); // oklch(59.6% 0.145 163.225)
}

/// Tailwind's box shadows (tailwindcss/theme.css) as Flutter shadows.
abstract final class TwShadows {
  /// `shadow-sm`: 0 1px 3px 0 rgb(0 0 0/.1), 0 1px 2px -1px rgb(0 0 0/.1).
  static const sm = [
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 1), blurRadius: 3),
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 1), blurRadius: 2, spreadRadius: -1),
  ];

  /// `shadow-lg`: 0 10px 15px -3px rgb(0 0 0/.1), 0 4px 6px -4px rgb(0 0 0/.1).
  static const lg = [
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 10), blurRadius: 15, spreadRadius: -3),
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 4), blurRadius: 6, spreadRadius: -4),
  ];

  /// `shadow-xl`: 0 20px 25px -5px rgb(0 0 0/.1), 0 8px 10px -6px rgb(0 0 0/.1).
  static const xl = [
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 20), blurRadius: 25, spreadRadius: -5),
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 8), blurRadius: 10, spreadRadius: -6),
  ];

  /// `shadow-2xl`: 0 25px 50px -12px rgb(0 0 0/.25).
  static const xxl = [BoxShadow(color: Color(0x40000000), offset: Offset(0, 25), blurRadius: 50, spreadRadius: -12)];
}

/// The runner's tokens. Semantic names; values cite their website source.
abstract final class BluebookTokens {
  // ---- fonts --------------------------------------------------------------------------------

  /// frontend/src/app/globals.css:859-865 `.ts-runner { font-family: -apple-system, …,
  /// Helvetica, Arial, … }` — Arial on Windows (report_webisms B8).
  static const chromeFont = 'Arial';
  static const chromeFontFallback = ['Helvetica', 'Segoe UI', 'Roboto'];

  /// DirectionsOverlay.tsx:30 / ReferenceSheet.tsx:23 `font-[Georgia]`.
  static const readingFont = 'Georgia';

  /// Overlays portalled outside `.ts-runner` (the Report dialog, toasts) wear `ds-app`
  /// (frontend/src/components/ui/OverlayFace.tsx:37, frontend/src/app/globals.css:875), the
  /// website's Geist web font. Nothing is bundled here, so they use the system UI face the
  /// rest of the native app uses (architecture §2.3 "Fonts").
  static const uiFont = 'Segoe UI';
  static const uiFontFallback = ['Helvetica Neue', 'Arial'];

  /// ScientificCalculator.tsx:42-43 `font-mono` = tailwindcss/theme.css:6-8
  /// (ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, …) — Consolas on Windows.
  static const monoFont = 'Consolas';
  static const monoFontFallback = ['Menlo', 'Monaco', 'Courier New'];

  /// tailwindcss/theme.css `--tracking-tight: -0.025em` (as a fraction of the font size).
  static const trackingTight = -0.025;

  /// tailwindcss/theme.css `--tracking-wide: 0.025em`.
  static const trackingWide = 0.025;

  /// tailwindcss/theme.css `--tracking-widest: 0.1em`.
  static const trackingWidest = 0.1;

  // ---- frame --------------------------------------------------------------------------------

  /// pages/ExamRunnerPage.tsx:1071 `.ts-runner … bg-white`.
  static const surface = TwColors.white;

  // ---- header (components/ExamHeader.tsx) ---------------------------------------------------

  /// ExamHeader.tsx:67 `px-6 py-3`.
  static const headerPadding = EdgeInsets.symmetric(horizontal: 24, vertical: 12);

  /// ExamHeader.tsx:70 `text-base font-bold tracking-tight text-slate-900` (line-height 1.5).
  static const headerTitleSize = 16.0;
  static const headerTitleLineHeight = 1.5;
  static const headerTitleColor = TwColors.slate900;

  /// ExamHeader.tsx:76 `mt-0.5 gap-1 text-[15px] text-slate-800 hover:text-slate-950`.
  static const directionsTop = 2.0;
  static const directionsGap = 4.0;
  static const directionsSize = 15.0;
  static const directionsColor = TwColors.slate800;
  static const directionsHoverColor = TwColors.slate950;

  /// ExamHeader.tsx:78 `ChevronDown h-4 w-4`.
  static const directionsChevron = 16.0;

  /// ExamHeader.tsx:38 `gap-0.5 text-xs font-semibold text-slate-900 hover:text-slate-600`,
  /// active `text-[#2b47c9]`.
  static const toolGap = 2.0;
  static const toolLabelSize = 12.0;
  static const toolLabelLineHeight = 16 / 12; // tailwindcss --text-xs--line-height
  static const toolColor = TwColors.slate900;
  static const toolHoverColor = TwColors.slate600;
  static const toolActiveColor = Color(0xFF2B47C9);

  /// ExamHeader.tsx:95 `gap-6`.
  static const toolClusterGap = 24.0;

  /// ExamHeader.tsx:98 Calculator / MoreMenu.tsx:69 MoreVertical `h-5 w-5`.
  static const toolIcon = 20.0;

  /// ExamHeader.tsx:112 PenLine `h-[18px] w-[18px]`.
  static const highlightIcon = 18.0;

  /// ExamHeader.tsx:103 Reference glyph `text-base font-bold italic leading-none` ("x²").
  static const referenceGlyphSize = 16.0;

  // ---- timer (components/Timer.tsx) ---------------------------------------------------------

  /// Timer.tsx:24 `gap-1`.
  static const timerGap = 4.0;

  /// Timer.tsx:32 `text-[26px] font-bold leading-none tabular-nums tracking-[0.02em]`.
  static const timerSize = 26.0;
  static const timerTracking = 0.02;
  static const timerColor = TwColors.slate900;

  /// Timer.tsx:29,32 warning colour `text-red-600`; hidden clock `text-slate-500`, `h-7 w-7`.
  static const timerWarningColor = TwColors.red600;
  static const timerHiddenClockColor = TwColors.slate500;
  static const timerHiddenClock = 28.0;

  /// utils/time.ts:30 FIVE_MINUTE_WARNING_SECONDS = 300.
  static const timerWarningAt = Duration(seconds: 300);

  /// Timer.tsx:40 `rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold uppercase
  /// tracking-wide text-red-700` — "Less than 5 minutes".
  static const timerBadgeBackground = TwColors.red50;
  static const timerBadgeColor = TwColors.red700;
  static const timerBadgePadding = EdgeInsets.symmetric(horizontal: 10, vertical: 2);
  static const timerBadgeSize = 11.0;

  /// Timer.tsx:45 `gap-2` between the pills.
  static const timerPillGap = 8.0;

  /// Timer.tsx:18-19 PILL `gap-1 rounded-full border border-slate-300 px-3 py-0.5 text-xs
  /// font-semibold text-slate-600 hover:border-slate-400`; Timer.tsx:47 icons `h-3.5 w-3.5`.
  static const pillBorder = TwColors.slate300;
  static const pillHoverBorder = TwColors.slate400;
  static const pillColor = TwColors.slate600;
  static const pillPadding = EdgeInsets.symmetric(horizontal: 12, vertical: 2);
  static const pillGap = 4.0;
  static const pillLabelSize = 12.0;
  static const pillIcon = 14.0;

  // ---- More menu (tools/MoreMenu.tsx) -------------------------------------------------------

  /// MoreMenu.tsx:73 `mt-2 w-60 rounded-xl border border-slate-200 bg-white py-1 shadow-xl`.
  static const menuOffset = 8.0;
  static const menuWidth = 240.0;
  static const menuRadius = 12.0;
  static const menuBorder = TwColors.slate200;
  static const menuPaddingV = 4.0;
  static const menuShadow = TwShadows.xl;

  /// MoreMenu.tsx:53 `gap-3 px-4 py-2 text-sm font-semibold hover:bg-slate-50`, colour
  /// `text-slate-700`, active `text-blue-700`; icons `h-4 w-4`.
  static const menuItemPadding = EdgeInsets.symmetric(horizontal: 16, vertical: 8);
  static const menuItemGap = 12.0;
  static const menuItemSize = 14.0;
  static const menuItemLineHeight = 20 / 14; // tailwindcss --text-sm--line-height
  static const menuItemColor = TwColors.slate700;
  static const menuItemActiveColor = TwColors.blue700;
  static const menuItemHover = TwColors.slate50;
  static const menuItemIcon = 16.0;

  /// MoreMenu.tsx:85 `my-1 border-t border-slate-100`.
  static const menuDivider = TwColors.slate100;

  // ---- colour rule (components/SatColorRule.tsx) --------------------------------------------

  /// SatColorRule.tsx:12 `h-[3px]`.
  static const ruleHeight = 3.0;

  /// SatColorRule.tsx:15 repeating-linear-gradient: 48 px dashes, 6 px gaps.
  static const ruleDash = 48.0;
  static const ruleGap = 6.0;

  /// SatColorRule.tsx:15 `#b91c1c #ca8a04 #15803d #0f172a`.
  static const ruleColors = [Color(0xFFB91C1C), Color(0xFFCA8A04), Color(0xFF15803D), Color(0xFF0F172A)];

  // ---- footer (components/ExamFooter.tsx) ---------------------------------------------------

  /// ExamFooter.tsx:33 `px-6 py-3`.
  static const footerPadding = EdgeInsets.symmetric(horizontal: 24, vertical: 12);

  /// ExamFooter.tsx:37 `text-[15px] font-bold text-slate-700`.
  static const studentNameSize = 15.0;
  static const studentNameColor = TwColors.slate700;

  /// ExamFooter.tsx:49 `gap-2 rounded-full bg-[#151515] px-6 py-2.5 text-[15px] font-bold
  /// text-white hover:bg-[#2a2a2a]`; ExamFooter.tsx:52 ChevronUp `h-4 w-4`.
  static const navPillBackground = Color(0xFF151515);
  static const navPillHover = Color(0xFF2A2A2A);
  static const navPillPadding = EdgeInsets.symmetric(horizontal: 24, vertical: 10);
  static const navPillGap = 8.0;
  static const navPillIcon = 16.0;
  static const footerButtonSize = 15.0;

  /// ExamFooter.tsx:62,71,80 `rounded-full bg-[#253985] px-9 py-2.5 … hover:bg-[#1d2d6b]`.
  static const primaryButton = Color(0xFF253985);
  static const primaryButtonHover = Color(0xFF1D2D6B);
  static const footerButtonPadding = EdgeInsets.symmetric(horizontal: 36, vertical: 10);

  /// ExamFooter.tsx:57 `gap-3`.
  static const footerButtonGap = 12.0;

  /// ExamFooter.tsx:62 Back `disabled:opacity-40`; :71 Submit `disabled:opacity-50`;
  /// :80 Next `disabled:opacity-60`.
  static const backDisabledOpacity = 0.4;
  static const submitDisabledOpacity = 0.5;
  static const nextDisabledOpacity = 0.6;

  /// pages/ExamRunnerPage.tsx:265-284 navigation freeze after Back/Next.
  static const navLock = Duration(milliseconds: 500);

  // ---- navigator (components/QuestionNavigator.tsx) -----------------------------------------

  /// QuestionNavigator.tsx:36 `bg-black/20 pb-[68px]`.
  static const navigatorScrim = Color(0x33000000);
  static const navigatorBottom = 68.0;

  /// QuestionNavigator.tsx:37 `mx-4 max-w-xl rounded-[3px] bg-white p-6 shadow-2xl`.
  static const navigatorMaxWidth = 576.0;
  static const navigatorRadius = 3.0;
  static const navigatorPadding = 24.0;
  static const navigatorShadow = TwShadows.xxl;

  /// QuestionNavigator.tsx:39 pointer `border-x-8 border-t-8 border-t-white` (16×8).
  static const navigatorPointerWidth = 16.0;
  static const navigatorPointerHeight = 8.0;

  /// QuestionNavigator.tsx:41 `mb-4 px-8 text-lg font-bold tracking-tight text-slate-900`.
  static const navigatorTitleSize = 18.0;
  static const navigatorTitleLineHeight = 28 / 18; // --text-lg--line-height
  static const navigatorTitleBottom = 16.0;

  /// QuestionNavigator.tsx:42-43 close `text-slate-400 hover:text-slate-700`, X `h-5 w-5`.
  static const closeIconColor = TwColors.slate400;
  static const closeIconHover = TwColors.slate700;
  static const closeIcon = 20.0;

  /// QuestionNavigator.tsx:46 `mb-5 gap-6 border-b border-slate-100 pb-3 text-sm
  /// font-semibold text-slate-600`; :47,49 icons `h-4 w-4`.
  static const legendBottom = 20.0;
  static const legendGap = 24.0;
  static const legendDivider = TwColors.slate100;
  static const legendPaddingBottom = 12.0;
  static const legendColor = TwColors.slate600;
  static const legendIcon = 16.0;
  static const legendItemGap = 6.0; // gap-1.5

  /// QuestionNavigator.tsx:48 `h-3.5 w-3.5 rounded-sm border border-dashed border-slate-400`.
  static const legendBox = 14.0;
  static const legendBoxRadius = 4.0; // tailwindcss --radius-sm: 0.25rem

  /// QuestionNavigator.tsx:47,58 MapPin `fill-slate-800 text-slate-800`.
  static const currentPin = TwColors.slate800;

  /// QuestionNavigator.tsx:49,73 Flag `fill-red-500 text-red-500`.
  static const flagColor = TwColors.red500;

  /// QuestionNavigator.tsx:51 `grid-cols-10 gap-x-3 gap-y-3 pt-3`.
  static const navigatorColumns = 10;
  static const gridGap = 12.0;
  static const navigatorGridTop = 12.0;

  /// QuestionNavigator.tsx:66-70 cell `h-10 w-10 rounded-[10px] text-sm font-bold`;
  /// answered `border-[#253985] bg-[#253985] text-white`; unanswered `border-dashed
  /// border-slate-400 text-[#2b47c9] hover:border-slate-600`; current `underline-offset-2`.
  static const cellSize = 40.0;
  static const cellRadius = 10.0;
  static const cellAnswered = Color(0xFF253985);
  static const cellUnansweredBorder = TwColors.slate400;
  static const cellUnansweredHover = TwColors.slate600;
  static const cellUnansweredText = Color(0xFF2B47C9);

  /// QuestionNavigator.tsx:58 current pin `-top-3 h-4 w-4`; :73 flag `-right-1.5 -top-1.5
  /// h-3.5 w-3.5`.
  static const cellPinTop = -12.0;
  static const cellFlagOffset = -6.0;
  static const cellFlag = 14.0;

  /// QuestionNavigator.tsx:79 `mt-5 border-t border-slate-100 pt-4`; :86 `rounded-full
  /// border-2 border-[#2b47c9] px-6 py-2 text-sm font-bold text-[#2b47c9] hover:bg-blue-50`.
  static const reviewButtonColor = Color(0xFF2B47C9);
  static const reviewButtonHover = TwColors.blue50;
  static const reviewButtonPadding = EdgeInsets.symmetric(horizontal: 24, vertical: 8);

  // ---- Check Your Work (components/CheckYourWorkPage.tsx) -----------------------------------

  /// CheckYourWorkPage.tsx:52 `bg-[#f6f7f8] px-6 py-10`.
  static const reviewBackground = Color(0xFFF6F7F8);
  static const reviewPadding = EdgeInsets.symmetric(horizontal: 24, vertical: 40);

  /// CheckYourWorkPage.tsx:53 `text-[34px] font-normal tracking-tight text-slate-900`.
  static const reviewTitleSize = 34.0;

  /// CheckYourWorkPage.tsx:54,57 `mt-4 / mt-1.5 max-w-2xl text-[17px] text-slate-600`.
  static const reviewIntroSize = 17.0;
  static const reviewIntroColor = TwColors.slate600;
  static const reviewIntroMaxWidth = 672.0;

  /// CheckYourWorkPage.tsx:62 `mt-8 max-w-4xl rounded-2xl border border-slate-200 bg-white
  /// p-8 shadow-sm`.
  static const reviewCardMaxWidth = 896.0;
  static const reviewCardRadius = 16.0;
  static const reviewCardBorder = TwColors.slate200;
  static const reviewCardPadding = 32.0;

  /// CheckYourWorkPage.tsx:63 `mb-6 border-b border-slate-200 pb-3.5`.
  static const reviewCardHeaderBottom = 24.0;
  static const reviewCardHeaderPadding = 14.0;

  /// CheckYourWorkPage.tsx:67 legend box `rounded-[3px]`.
  static const reviewLegendBoxRadius = 3.0;

  /// CheckYourWorkPage.tsx:75 `grid-cols-11 gap-3`.
  static const reviewColumns = 11;

  /// CheckYourWorkPage.tsx:106,120 `px-8 py-2.5`.
  static const reviewButtonPaddingFooter = EdgeInsets.symmetric(horizontal: 32, vertical: 10);

  /// CheckYourWorkPage.tsx:111 midterm note `max-w-md rounded-xl border border-amber-200
  /// bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900`.
  static const lockedNoteMaxWidth = 448.0;
  static const lockedNoteBorder = TwColors.amber200;
  static const lockedNoteBackground = TwColors.amber50;
  static const lockedNoteColor = TwColors.amber900;
  static const lockedNotePadding = EdgeInsets.symmetric(horizontal: 16, vertical: 10);

  // ---- Welcome (components/WelcomeScreen.tsx) -----------------------------------------------

  /// WelcomeScreen.tsx:43 `max-w-lg rounded-3xl border border-slate-200 bg-white p-10 shadow-sm`.
  static const welcomeMaxWidth = 512.0;
  static const welcomeRadius = 24.0;
  static const welcomePadding = 40.0;

  /// WelcomeScreen.tsx:44 `text-xs font-bold uppercase tracking-[0.2em] text-blue-700`.
  static const welcomeEyebrowColor = TwColors.blue700;
  static const welcomeEyebrowTracking = 0.2;

  /// WelcomeScreen.tsx:45 `mt-3 text-2xl font-bold tracking-tight` (line-height 2/1.5).
  static const welcomeTitleSize = 24.0;
  static const welcomeTitleLineHeight = 32 / 24;

  /// WelcomeScreen.tsx:46 `mt-2 text-sm font-medium text-slate-500`.
  static const welcomeSubColor = TwColors.slate500;

  /// WelcomeScreen.tsx:51 tile `rounded-2xl border border-slate-200 bg-slate-50 p-4`;
  /// :52 icon `h-5 w-5 text-slate-500`; :53 value `mt-2 text-lg font-bold`; :56 label
  /// `text-[11px] font-semibold uppercase tracking-wide text-slate-400`.
  static const welcomeTileRadius = 16.0;
  static const welcomeTileBackground = TwColors.slate50;
  static const welcomeTileLabelColor = TwColors.slate400;

  /// WelcomeScreen.tsx:68 bullet `text-blue-600`.
  static const welcomeBullet = TwColors.blue600;

  /// WelcomeScreen.tsx:80 `mt-8 w-full gap-2 rounded-full bg-blue-700 px-8 py-3 text-base
  /// font-bold text-white hover:bg-blue-800 disabled:opacity-60`.
  static const welcomeStart = TwColors.blue700;
  static const welcomeStartHover = TwColors.blue800;

  // ---- transition / status (ModuleTransitionOverlay.tsx, StatusScreens.tsx) ----------------

  /// ModuleTransitionOverlay.tsx:12 `h-10 w-10 border-4 border-slate-200 border-t-blue-600`.
  static const spinnerSize = 40.0;
  static const spinnerStroke = 4.0;
  static const spinnerTrack = TwColors.slate200;
  static const spinnerArc = TwColors.blue600;

  /// StatusScreens.tsx:47 scoring spinner `border-t-emerald-600`.
  static const spinnerArcScoring = TwColors.emerald600;

  /// ModuleTransitionOverlay.tsx:13 `mt-6 text-xl font-bold tracking-tight text-slate-900`.
  static const statusTitleSize = 20.0;
  static const statusTitleLineHeight = 28 / 20;

  /// ModuleTransitionOverlay.tsx:14 `mt-2 font-medium text-slate-500`.
  static const statusBodyColor = TwColors.slate500;

  // ---- Directions (components/DirectionsOverlay.tsx) ----------------------------------------

  /// pages/ExamRunnerPage.tsx:259 default anchor 84 px; DirectionsOverlay.tsx:26 `top:
  /// anchorBottom + 6`, `width: calc(widthPct% + 44px)`, `bottom: 150`.
  static const directionsGapBelowHeader = 6.0;
  static const directionsExtraWidth = 44.0;
  static const directionsBottom = 150.0;

  /// DirectionsOverlay.tsx:25 `rounded-b-2xl bg-white p-8 shadow-2xl`.
  static const directionsRadius = 16.0;
  static const directionsPadding = 32.0;

  /// DirectionsOverlay.tsx:29 pointer `-top-2 left-10 h-4 w-4 rotate-45 rounded-[2px]`.
  static const directionsPointerLeft = 40.0;
  static const directionsPointerSize = 16.0;

  /// DirectionsOverlay.tsx:30 `font-[Georgia] text-[17px] leading-relaxed text-slate-900`.
  static const directionsTextSize = 17.0;
  static const directionsTextLineHeight = 1.625;

  /// DirectionsOverlay.tsx:57 `rounded-full bg-[#f9da4a] px-8 py-2.5 text-sm font-bold
  /// text-slate-900 hover:bg-[#f4cf22]`.
  static const directionsClose = Color(0xFFF9DA4A);
  static const directionsCloseHover = Color(0xFFF4CF22);

  // ---- shortcuts help (tools/KeyboardShortcutsHelp.tsx) -------------------------------------

  /// KeyboardShortcutsHelp.tsx:8 `bg-black/30`; :9 `max-w-sm rounded-2xl bg-white p-6 shadow-xl`.
  static const helpScrim = Color(0x4D000000);
  static const helpMaxWidth = 384.0;

  /// KeyboardShortcutsHelp.tsx:20 kbd `rounded-md border border-slate-300 bg-slate-50 px-2
  /// py-0.5 font-mono text-xs font-bold text-slate-700`.
  static const kbdBorder = TwColors.slate300;
  static const kbdBackground = TwColors.slate50;
  static const kbdColor = TwColors.slate700;

  // ---- floating panels (tools/FloatingPanel.tsx) --------------------------------------------

  /// FloatingPanel.tsx:86 `rounded-xl border border-slate-300 bg-white shadow-2xl`.
  static const panelRadius = 12.0;
  static const panelBorder = TwColors.slate300;

  /// FloatingPanel.tsx:93-95 title bar `px-3 py-2 border-b`; light `border-slate-200
  /// bg-slate-50`, dark `border-slate-700 bg-slate-900`.
  static const panelHeaderPadding = EdgeInsets.symmetric(horizontal: 12, vertical: 8);
  static const panelHeaderLight = TwColors.slate50;
  static const panelHeaderLightBorder = TwColors.slate200;
  static const panelHeaderDark = TwColors.slate900;
  static const panelHeaderDarkBorder = TwColors.slate700;

  /// FloatingPanel.tsx:97 title `text-sm font-bold text-slate-700` (dark: white).
  static const panelTitleColor = TwColors.slate700;

  /// FloatingPanel.tsx:103,106 close `rounded p-0.5`, X `h-4 w-4`; light `text-slate-400
  /// hover:bg-slate-200 hover:text-slate-700`; dark `text-slate-300 hover:bg-white/10`.
  static const panelCloseIcon = 16.0;
  static const panelDarkIcon = TwColors.slate300;
  static const panelDarkHover = Color(0x1AFFFFFF);

  /// FloatingPanel.tsx:114-115 resize grip 16×16, `linear-gradient(135deg, transparent 50%,
  /// #94a3b8 50%)`.
  static const panelGrip = 16.0;
  static const panelGripColor = Color(0xFF94A3B8);

  /// FloatingPanel.tsx:68-69 the panel's left edge stays ≤ width-120, top ≤ height-60.
  static const panelKeepVisibleX = 120.0;
  static const panelKeepVisibleY = 60.0;

  // ---- Notes (tools/notes/NotesPanel.tsx) ----------------------------------------------------

  /// NotesPanel.tsx:20 `initial={{ x: 260, y: 130, w: 360, h: 420 }} minW={260} minH={220}`.
  static const notesRect = Rect.fromLTWH(260, 130, 360, 420);
  static const notesMin = Size(260, 220);

  /// NotesPanel.tsx:29 `rounded-lg border border-slate-200 p-3 text-sm leading-relaxed
  /// text-slate-800 focus:border-blue-500`.
  static const notesBorder = TwColors.slate200;
  static const notesFocusBorder = TwColors.blue500;
  static const notesColor = TwColors.slate800;

  // ---- Reference sheet (tools/ReferenceSheet.tsx) -------------------------------------------

  /// ReferenceSheet.tsx:38 `initial={{ x: 160, y: 90, w: 720, h: 560 }} minW={460} minH={380}`.
  static const referenceRect = Rect.fromLTWH(160, 90, 720, 560);
  static const referenceMin = Size(460, 380);

  /// ReferenceSheet.tsx:20 figure `h-[78px] w-[110px]`; :23 formula `text-[13px]
  /// leading-tight text-slate-900`.
  static const referenceFigure = Size(110, 78);
  static const referenceFormulaSize = 13.0;

  // ---- calculator (tools/calculator/DesmosCalculator.tsx, pages/ExamRunnerPage.tsx) ---------

  /// DesmosCalculator.tsx:78-80 `{ x: 16, y: 80, w: enlarged ? 720 : 460, h: enlarged ? 700
  /// : 560 }`, minW 360, minH 420.
  static const calculatorRect = Rect.fromLTWH(16, 80, 460, 560);
  static const calculatorEnlargedSize = Size(720, 700);
  static const calculatorMin = Size(360, 420);

  /// pages/ExamRunnerPage.tsx:1185-1191 `calcReserve` 500 (760 enlarged).
  static const calcReserve = 500.0;
  static const calcReserveEnlarged = 760.0;

  /// DesmosCalculator.tsx:65-67 tabs `rounded-md px-3 py-1 text-xs font-bold`; active
  /// `bg-white text-slate-900`; inactive `text-slate-300 hover:text-white`.
  static const calcTabPadding = EdgeInsets.symmetric(horizontal: 12, vertical: 4);
  static const calcTabRadius = 6.0;

  // ---- scientific calculator (tools/calculator/ScientificCalculator.tsx) --------------------

  /// ScientificCalculator.tsx:52 clear `bg-red-50 text-red-600 hover:bg-red-100`; digits
  /// `bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50`; operators
  /// `bg-slate-100 text-slate-700 hover:bg-slate-200`.
  static const sciClearBackground = TwColors.red50;
  static const sciClearHover = TwColors.red100;
  static const sciClearColor = TwColors.red600;
  static const sciDigitBackground = TwColors.white;
  static const sciDigitRing = TwColors.slate200;
  static const sciDigitHover = TwColors.slate50;
  static const sciOpBackground = TwColors.slate100;
  static const sciOpHover = TwColors.slate200;
  static const sciOpColor = TwColors.slate700;

  /// ScientificCalculator.tsx:58 equals `bg-blue-600 py-2 text-sm font-bold hover:bg-blue-700`.
  static const sciEquals = TwColors.blue600;
  static const sciEqualsHover = TwColors.blue700;

  // ---- highlight toolbar (tools/highlight/AnnotationToolbar.tsx) ----------------------------

  /// AnnotationToolbar.tsx:17-21 swatches.
  static const swatchYellow = Color(0xFFFFD21A);
  static const swatchBlue = Color(0xFFBCDCF7);
  static const swatchPink = Color(0xFFF7BCD6);

  /// AnnotationToolbar.tsx:64 `gap-2 rounded-xl border border-slate-200 bg-white px-2.5
  /// py-1.5 shadow-xl`.
  static const toolbarPadding = EdgeInsets.symmetric(horizontal: 10, vertical: 6);
  static const toolbarGap = 8.0;

  /// AnnotationToolbar.tsx:75-76 swatch `h-[30px] w-[30px] rounded-full`, active `ring-2
  /// ring-slate-900 ring-offset-1`, else `ring-1 ring-slate-200`.
  static const swatchSize = 30.0;

  /// AnnotationToolbar.tsx:29 `h-8 w-8 rounded-md text-slate-600 hover:bg-slate-100`;
  /// :91 active `bg-blue-50 text-blue-700`; :98 delete `hover:bg-red-50 hover:text-red-600`.
  static const toolbarButton = 32.0;
  static const toolbarIconColor = TwColors.slate600;
  static const toolbarIcon = 18.0;

  /// AnnotationToolbar.tsx:30 `mx-0.5 h-6 w-px bg-slate-200`.
  static const toolbarDividerHeight = 24.0;

  /// AnnotationToolbar.tsx:49-54 margins and the 10 px gap from the selection.
  static const toolbarMargin = 8.0;
  static const toolbarSelectionGap = 10.0;

  // ---- report dialog (features/question-reports/ReportProblemModal.tsx + components/ui) -----

  /// frontend/src/components/ui/Modal.tsx:70 scrim `bg-[var(--overlay-scrim)]` =
  /// frontend/src/app/globals.css:90 rgba(15, 23, 42, 0.45).
  static const dialogScrim = Color(0x730F172A);

  /// Modal.tsx:78 `rounded-2xl border border-border bg-card shadow-modal`; size sm = max-w-sm.
  /// globals.css:87 --border-subtle rgba(15,23,42,.08); :94 --card #fff.
  static const dialogMaxWidth = 384.0;
  static const dialogRadius = 16.0;
  static const dialogBorder = Color(0x140F172A);

  /// globals.css:169 --ds-shadow-lg (shadow-modal).
  static const dialogShadow = [
    BoxShadow(color: Color(0x0F0F172A), offset: Offset(0, 6), blurRadius: 12),
    BoxShadow(color: Color(0x421E3A6E), offset: Offset(0, 24), blurRadius: 48, spreadRadius: -16),
  ];

  /// globals.css:167 --ds-shadow-sm (shadow-card on Select/Textarea).
  static const fieldShadow = [
    BoxShadow(color: Color(0x0A0F172A), offset: Offset(0, 1), blurRadius: 2),
    BoxShadow(color: Color(0x1A1E3A6E), offset: Offset(0, 2), blurRadius: 8, spreadRadius: -2),
  ];

  /// globals.css:84 --text-primary #0f172a; :85 --text-secondary #475569; :86 --text-label.
  static const textPrimary = Color(0xFF0F172A);
  static const textSecondary = Color(0xFF475569);
  static const textLabel = Color(0xFF64748B);

  /// globals.css:80 --bg #eef2fa (field background `bg-background`); :81 --surface (footer
  /// `bg-surface-1`); :82 --surface-2 (ghost hover).
  static const fieldBackground = Color(0xFFEEF2FA);
  static const dialogFooterBackground = Color(0xFFF8FAFC);
  static const ghostHover = Color(0xFFF1F5F9);

  /// globals.css:100-102 --primary #2a68c0, --primary-hover #21539e, --primary-soft.
  static const brandPrimary = Color(0xFF2A68C0);
  static const brandPrimaryHover = Color(0xFF21539E);
  static const brandPrimarySoft = Color(0x1A2A68C0);

  /// frontend/src/components/ui/Button.tsx primary shadow `0_1px_2px_rgba(67,56,202,0.35)`.
  static const brandButtonShadow = [BoxShadow(color: Color(0x594338CA), offset: Offset(0, 1), blurRadius: 2)];

  /// frontend/src/app/globals.css:899-904 .ds-h3 (1.125rem, 600, -0.01em, line-height 1.3).
  static const dialogTitleSize = 18.0;
  static const dialogTitleTracking = -0.01;

  /// Button.tsx size md `h-11 rounded-xl px-4 text-sm`; Select.tsx md `h-11 rounded-xl`.
  static const controlHeight = 44.0;
  static const controlRadius = 12.0;

  // ---- toasts --------------------------------------------------------------------------------

  /// pages/ExamRunnerPage.tsx:1279 timer toast `top-20 rounded-xl bg-slate-900 px-5 py-3
  /// text-sm font-bold text-white shadow-xl`; :626 shown 8 s.
  static const timerToastTop = 80.0;
  static const timerToastBackground = TwColors.slate900;
  static const timerToastPadding = EdgeInsets.symmetric(horizontal: 20, vertical: 12);
  static const timerToastDuration = Duration(seconds: 8);

  /// frontend/src/components/ToastProvider.tsx:49-61 `right-5 top-5 w-[min(92vw,420px)]
  /// rounded-2xl border bg-card px-4 py-3 shadow-lg`; title `text-sm font-extrabold`, body
  /// `mt-1 text-sm text-muted-foreground`; :28-30 shown 3.2 s.
  static const noticeInset = 20.0;
  static const noticeWidth = 420.0;
  static const noticePadding = EdgeInsets.symmetric(horizontal: 16, vertical: 12);
  static const noticeDuration = Duration(milliseconds: 3200);

  // ---- battery (components/DesktopBattery.tsx) -----------------------------------------------

  /// frontend/src/lib/desktop/useBattery.ts:7 LOW_BATTERY_PERCENT = 25.
  static const lowBatteryPercent = 25;
}
