// MasterSAT brand tokens for every screen outside the exam runner.
//
// Source of truth: the website's CSS custom properties in
// frontend/src/app/globals.css (origin/main f2fd97b9):
//  * the house tokens under `:root` (lines 80-172): --bg, --surface*, --text-*, --border-*,
//    --primary*, --success*, --warning*, --danger*, --info*, --ring, --ds-radius-*;
//  * the student dashboard scope `.dzboard` (lines 1011-1038, 1185-1186): --dz-* — the palette
//    the website's Past papers and Midterms pages are drawn in.
// The app has no dark theme (architecture §6: the title bar is forced light), so only the
// light values are carried. Each constant names the CSS property it mirrors; change them only
// together with the CSS.
//
// The exam runner has its own generated tokens (lib/exam/tokens/, runner-ui) — do not use
// these inside the runner frame.
import 'package:flutter/widgets.dart';

abstract final class AppColors {
  // ---- house tokens (:root) ----------------------------------------------------------------
  /// --bg
  static const background = Color(0xFFEEF2FA);

  /// --surface
  static const surface = Color(0xFFF8FAFC);

  /// --surface-2
  static const surface2 = Color(0xFFF1F5F9);

  /// --surface-3
  static const surface3 = Color(0xFFE2E8F0);

  /// --card
  static const card = Color(0xFFFFFFFF);

  /// --text-primary
  static const textPrimary = Color(0xFF0F172A);

  /// --text-secondary
  static const textSecondary = Color(0xFF475569);

  /// --text-label
  static const textLabel = Color(0xFF64748B);

  /// --border-subtle: rgba(15, 23, 42, 0.08)
  static const borderSubtle = Color(0x140F172A);

  /// --border-strong: rgba(15, 23, 42, 0.16)
  static const borderStrong = Color(0x290F172A);

  /// --overlay-scrim: rgba(15, 23, 42, 0.45)
  static const scrim = Color(0x730F172A);

  /// --primary
  static const primary = Color(0xFF2A68C0);

  /// --primary-hover
  static const primaryHover = Color(0xFF21539E);

  /// --primary-soft: rgba(42, 104, 192, 0.10)
  static const primarySoft = Color(0x1A2A68C0);

  /// --primary-foreground
  static const onPrimary = Color(0xFFFFFFFF);

  /// --ring: rgba(42, 104, 192, 0.40)
  static const focusRing = Color(0x662A68C0);

  /// --success / --success-soft / --success-foreground
  static const success = Color(0xFF059669);
  static const successSoft = Color(0xFFECFDF5);
  static const successForeground = Color(0xFF047857);

  /// --warning / --warning-soft / --warning-foreground
  static const warning = Color(0xFFD97706);
  static const warningSoft = Color(0xFFFFFBEB);
  static const warningForeground = Color(0xFFB45309);

  /// --danger / --danger-soft / --danger-foreground
  static const danger = Color(0xFFDC2626);
  static const dangerSoft = Color(0xFFFEF2F2);
  static const dangerForeground = Color(0xFFB91C1C);

  /// --info / --info-soft / --info-foreground
  static const info = Color(0xFF0284C7);
  static const infoSoft = Color(0xFFF0F9FF);
  static const infoForeground = Color(0xFF0369A1);

  // ---- student dashboard scope (.dzboard) -------------------------------------------------
  /// --dz-indigo (= --primary)
  static const indigo = Color(0xFF2A68C0);

  /// --dz-indigo-deep
  static const indigoDeep = Color(0xFF21539E);

  /// --dz-indigo-soft
  static const indigoSoft = Color(0xFFE7EFFB);

  /// --dz-ink
  static const ink = Color(0xFF0F1729);

  /// --dz-mute
  static const mute = Color(0xFF64748B);

  /// --dz-faint
  static const faint = Color(0xFF94A3B8);

  /// --dz-panel
  static const panel = Color(0xFFFFFFFF);

  /// --dz-border
  static const line = Color(0xFFE7EBF3);

  /// --dz-amber / --dz-amber-soft (rgba(245, 158, 11, 0.13))
  static const amber = Color(0xFFF59E0B);
  static const amberSoft = Color(0x21F59E0B);

  /// --dz-success / --dz-success-soft (rgba(21, 128, 61, 0.12))
  static const dzSuccess = Color(0xFF15803D);
  static const dzSuccessSoft = Color(0x1F15803D);

  /// --dz-danger / --dz-danger-soft (rgba(185, 28, 28, 0.12))
  static const dzDanger = Color(0xFFB91C1C);
  static const dzDangerSoft = Color(0x1FB91C1C);

  /// --dz-neutral-soft: rgba(100, 116, 139, 0.12)
  static const neutralSoft = Color(0x1F64748B);

  /// --dz-skel
  static const skeleton = Color(0xFFE9EEF5);

  /// --dz-error / --dz-error-soft / --dz-error-border / --dz-error-bg
  static const error = Color(0xFFD6473A);
  static const errorSoft = Color(0xFFFBE3DF);
  static const errorBorder = Color(0xFFF3D2CD);
  static const errorBackground = Color(0xFFFDF4F3);

  // ---- literal accents the website's past-paper and midterm pages use inline --------------
  /// Mathematics / International accent (`#0d9488`, pastpapers/page.tsx Booklet).
  static const teal = Color(0xFF0D9488);

  /// rgba(13,148,136,.12)
  static const tealSoft = Color(0x1F0D9488);

  /// "Completed" green (`#16a34a`, pastpapers/page.tsx statusMeta.completed).
  static const completed = Color(0xFF16A34A);

  /// rgba(22,163,74,.12)
  static const completedSoft = Color(0x1F16A34A);

  /// Re-sit amber (`#c2740c` button, `#fef3e2`/`#b45309` badge, MidtermList.tsx).
  static const resit = Color(0xFFC2740C);
  static const resitSoft = Color(0xFFFEF3E2);
  static const resitForeground = Color(0xFFB45309);

  /// Midterm "Completed" badge (`#dcf2e3` / `#0b7a4f`, MidtermList.tsx).
  static const pastBadge = Color(0xFFDCF2E3);
  static const pastBadgeForeground = Color(0xFF0B7A4F);

  /// Midterm "Missed" badge (`#fdeaea` / `#b91c1c`).
  static const missedBadge = Color(0xFFFDEAEA);

  /// Sign-in brand panel gradient (`linear-gradient(160deg,#2a68c0,#1f4d9a)`).
  static const brandGradientEnd = Color(0xFF1F4D9A);

  // ---- the shell (components/shell/AppShell.tsx) -----------------------------------------
  /// The top bar: `bg-card/80` over --bg (white at 80 % on #eef2fa).
  static const topBar = Color(0xFFFCFCFE);

  /// --border (= --border-subtle), the kit's hairline.
  static const border = borderSubtle;

  // ---- Tailwind v4 slate (MidtermList.tsx classes; sRGB of the OKLCH values) -------------
  /// slate-100, oklch(96.8% 0.007 247.896)
  static const slate100 = Color(0xFFF1F5F9);

  /// slate-200, oklch(92.9% 0.013 255.508)
  static const slate200 = Color(0xFFE2E8F0);

  /// slate-400, oklch(70.4% 0.04 256.788)
  static const slate400 = Color(0xFF90A1B9);

  /// slate-500, oklch(55.4% 0.046 257.417)
  static const slate500 = Color(0xFF62748E);
}

/// --ds-radius-* (0.625 / 0.875 / 1.125 / 1.5 rem at 16 px), Tailwind's rounded-lg / -xl /
/// -2xl (8 / 12 / 16) the kit uses, and the radii the dashboard pages use inline (11, 14, 18).
abstract final class AppRadii {
  static const sm = 10.0;
  static const button = 11.0;
  static const md = 14.0;
  static const lg = 18.0;
  static const xl = 24.0;

  /// Tailwind `rounded-lg` (Button sm).
  static const kitSm = 8.0;

  /// Tailwind `rounded-xl` (Button md/lg, Input, Alert).
  static const kitMd = 12.0;

  /// Tailwind `rounded-2xl` (Card, Modal, toasts, nav items).
  static const kitLg = 16.0;
}

/// Spacing on a 4 px grid, tuned for desktop density.
abstract final class AppSpace {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
}

/// The house shadows (globals.css :root): two layers each, a tight contact shadow and a wide
/// soft one, cast in navy.
abstract final class AppShadows {
  /// --ds-shadow-sm (`shadow-card`): 0 1px 2px rgba(15,23,42,.04), 0 2px 8px -2px rgba(30,58,110,.10).
  static const sm = [
    BoxShadow(color: Color(0x0A0F172A), offset: Offset(0, 1), blurRadius: 2),
    BoxShadow(color: Color(0x1A1E3A6E), offset: Offset(0, 2), blurRadius: 8, spreadRadius: -2),
  ];

  /// --ds-shadow-md (`shadow-pop`): 0 2px 4px rgba(15,23,42,.04), 0 10px 24px -8px rgba(30,58,110,.18).
  static const md = [
    BoxShadow(color: Color(0x0A0F172A), offset: Offset(0, 2), blurRadius: 4),
    BoxShadow(color: Color(0x2E1E3A6E), offset: Offset(0, 10), blurRadius: 24, spreadRadius: -8),
  ];

  /// --ds-shadow-lg (`shadow-modal`): 0 6px 12px rgba(15,23,42,.06), 0 24px 48px -16px rgba(30,58,110,.26).
  static const lg = [
    BoxShadow(color: Color(0x0F0F172A), offset: Offset(0, 6), blurRadius: 12),
    BoxShadow(color: Color(0x421E3A6E), offset: Offset(0, 24), blurRadius: 48, spreadRadius: -16),
  ];

  /// Button.tsx primary: `shadow-[0_1px_2px_rgba(67,56,202,0.35)]`.
  static const primaryButton = [BoxShadow(color: Color(0x594338CA), offset: Offset(0, 1), blurRadius: 2)];

  /// Button.tsx danger: `shadow-[0_1px_2px_rgba(220,38,38,0.3)]`.
  static const dangerButton = [BoxShadow(color: Color(0x4DDC2626), offset: Offset(0, 1), blurRadius: 2)];

  /// The active sidebar item (AppShell.tsx): 0 10px 22px -10px rgba(42,104,192,.9).
  static const navActive = [BoxShadow(color: Color(0xE62A68C0), offset: Offset(0, 10), blurRadius: 22, spreadRadius: -10)];

  /// The active filter pill (PaperLibrary.tsx `Segmented`): 0 2px 8px rgba(42,104,192,.35).
  static const segmentActive = [BoxShadow(color: Color(0x592A68C0), offset: Offset(0, 2), blurRadius: 8)];

  /// `.dz-booklet:hover` (globals.css): 0 18px 38px rgba(15,23,41,.14).
  static const bookletHover = [BoxShadow(color: Color(0x240F1729), offset: Offset(0, 18), blurRadius: 38)];

  /// Tailwind `shadow-lg` (the website's toasts): 0 10px 15px -3px rgb(0 0 0/.1), 0 4px 6px -4px rgb(0 0 0/.1).
  static const toast = [
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 10), blurRadius: 15, spreadRadius: -3),
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 4), blurRadius: 6, spreadRadius: -4),
  ];
}

/// --ds-shadow-sm, for cards (kept for older call sites; prefer [AppShadows.sm]).
const List<BoxShadow> cardShadow = AppShadows.sm;

/// --ds-shadow-lg, for dialogs (prefer [AppShadows.lg]).
const List<BoxShadow> dialogShadow = AppShadows.lg;
