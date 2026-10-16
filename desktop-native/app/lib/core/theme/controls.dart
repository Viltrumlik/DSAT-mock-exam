// The app's own controls, drawn to the website's UI kit (frontend/src/components/ui: Button,
// IconButton, Input, Card, Alert, Modal) and the dashboard pages' inline pieces
// (features/pastpapers/PaperLibrary.tsx: Segmented, the badges, the empty and error blocks).
//
// Every clickable thing outside the exam runner is a [Pressable]:
//  * arrow cursor (never the hand), no ink ripple — hover changes a fill or a border;
//  * Enter / Space activate it when focused; a focus ring (the website's `.ds-ring`) shows in
//    keyboard mode only;
//  * a semantics node with `button: true`, so tests (and screen readers) find it.
// The "every button does something" sweep (test/features/home/every_button_sweep_test.dart)
// walks every [Pressable] on every screen.
//
// Text in these controls names no font family: it takes the face of the page (Geist, or Plus
// Jakarta Sans inside a [BoardFace]), as the website's controls inherit theirs.
import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import 'app_theme.dart';
import 'tokens.dart';

/// What a [Pressable]'s builder sees.
@immutable
class PressableState {
  const PressableState({
    required this.enabled,
    required this.hovered,
    required this.pressed,
    required this.focused,
    this.selected = false,
  });

  final bool enabled;
  final bool hovered;
  final bool pressed;

  /// Focused AND the app is in keyboard-highlight mode (so a mouse click shows no ring).
  final bool focused;
  final bool selected;
}

/// The single base for every control: focus, hover, press, keyboard activation, semantics.
class Pressable extends StatefulWidget {
  const Pressable({
    super.key,
    required this.onPressed,
    required this.builder,
    this.semanticLabel,
    this.selected = false,
    this.focusNode,
    this.autofocus = false,
    this.tooltip,
    this.excludeChildSemantics = true,
  });

  /// Null disables the control.
  final VoidCallback? onPressed;
  final Widget Function(BuildContext context, PressableState state) builder;
  final String? semanticLabel;

  /// With a [semanticLabel], hide the children from accessibility (a plain button). A card
  /// that holds its own buttons passes false, so they stay reachable.
  final bool excludeChildSemantics;
  final bool selected;
  final FocusNode? focusNode;
  final bool autofocus;
  final String? tooltip;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _hovered = false;
  bool _pressed = false;
  bool _focused = false;

  bool get _enabled => widget.onPressed != null;

  void _activate() {
    if (!_enabled) return;
    widget.onPressed!.call();
  }

  @override
  Widget build(BuildContext context) {
    final state = PressableState(
      enabled: _enabled,
      hovered: _enabled && _hovered,
      pressed: _enabled && _pressed,
      focused: _enabled && _focused,
      selected: widget.selected,
    );
    Widget child = FocusableActionDetector(
      enabled: _enabled,
      focusNode: widget.focusNode,
      autofocus: widget.autofocus,
      mouseCursor: SystemMouseCursors.basic,
      actions: <Type, Action<Intent>>{
        ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) {
          _activate();
          return null;
        }),
        ButtonActivateIntent: CallbackAction<ButtonActivateIntent>(onInvoke: (_) {
          _activate();
          return null;
        }),
      },
      onShowHoverHighlight: (v) => setState(() => _hovered = v),
      onShowFocusHighlight: (v) => setState(() => _focused = v),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: _enabled ? (_) => setState(() => _pressed = true) : null,
        onTapUp: _enabled ? (_) => setState(() => _pressed = false) : null,
        onTapCancel: _enabled ? () => setState(() => _pressed = false) : null,
        onTap: _enabled ? _activate : null,
        child: widget.builder(context, state),
      ),
    );
    child = Semantics(
      container: !widget.excludeChildSemantics,
      button: true,
      enabled: _enabled,
      selected: widget.selected,
      label: widget.semanticLabel,
      excludeSemantics: widget.semanticLabel != null && widget.excludeChildSemantics,
      onTap: _enabled ? _activate : null,
      child: child,
    );
    if (widget.tooltip != null) {
      child = Tooltip(message: widget.tooltip!, child: child);
    }
    return child;
  }
}

/// The keyboard focus ring — the website's `.ds-ring:focus-visible`: a 2 px gap, then a 2 px
/// ring in --ring, following the control's corners.
class FocusRing extends StatelessWidget {
  const FocusRing({super.key, required this.visible, required this.radius, required this.child});

  final bool visible;
  final double radius;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!visible) return child;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        child,
        Positioned(
          left: -4,
          top: -4,
          right: -4,
          bottom: -4,
          child: IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(radius + 4),
                border: Border.all(color: AppColors.focusRing, width: 2),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

enum AppButtonTone {
  /// Button.tsx `primary`: brand fill, a 1 px coloured shadow.
  primary,

  /// Button.tsx `secondary`: white, hairline border, the card shadow.
  secondary,

  /// Button.tsx `ghost`: no fill until hovered, muted text.
  subtle,

  /// Button.tsx `subtle`: primary-soft fill, primary text.
  soft,

  /// The dashboard's line button (PastpaperReportPage / MidtermList "View result"): no fill, a
  /// --dz-line border, ink text.
  line,

  /// The dashboard's Resume (`--dz-amber`).
  amber,

  /// MidtermList's re-sit (`#c2740c`).
  resit,

  /// Button.tsx `danger`.
  danger,

  /// A destructive way through that should not shout: danger text on a danger/25 border.
  dangerOutline,
}

enum AppButtonSize {
  /// Button.tsx `sm`: 36 high, rounded-lg, 13 px semibold.
  small,

  /// Button.tsx `md`: 44 high, rounded-xl, 14 px semibold.
  medium,

  /// Button.tsx `lg`: 48 high, rounded-xl, 15 px semibold.
  large,

  /// The dashboard's action button (`.dz-actionbtn`: padding 11, radius 11, 13 px extrabold).
  action,

  /// A midterm row's button (MidtermList: px 18, py 11, rounded-xl, 14 px bold).
  row,

  /// The dashboard's "Try again" in an error block (padding 13/22, radius 13, 15 px bold).
  block,

  /// MidtermList's "View result" link (rounded-xl, px 16, py 8, 14 px bold).
  link,

  /// The report page's small row button ("Report": padding 7/11, radius 9, 12 px extrabold).
  mini,
}

@immutable
class _Metrics {
  const _Metrics(this.height, this.padding, this.fontSize, this.icon, this.radius, this.weight, this.gap);
  final double height;
  final double padding;
  final double fontSize;
  final double icon;
  final double radius;
  final FontWeight weight;
  final double gap;
}

_Metrics _metrics(AppButtonSize size) => switch (size) {
      AppButtonSize.small => const _Metrics(36, 12, 13, 16, AppRadii.kitSm, FontWeight.w600, 6),
      AppButtonSize.medium => const _Metrics(44, 16, 14, 18, AppRadii.kitMd, FontWeight.w600, 8),
      AppButtonSize.large => const _Metrics(48, 24, 15, 20, AppRadii.kitMd, FontWeight.w600, 8),
      AppButtonSize.action => const _Metrics(42, 18, 13, 15, AppRadii.button, FontWeight.w800, 7),
      AppButtonSize.row => const _Metrics(43, 18, 14, 16, AppRadii.kitMd, FontWeight.w700, 8),
      AppButtonSize.block => const _Metrics(48, 22, 15, 18, 13, FontWeight.w700, 9),
      AppButtonSize.link => const _Metrics(37, 16, 14, 16, AppRadii.kitMd, FontWeight.w700, 6),
      AppButtonSize.mini => const _Metrics(32, 11, 12, 13, 9, FontWeight.w800, 5),
    };

@immutable
class _ToneColors {
  const _ToneColors(this.background, this.hover, this.pressed, this.foreground,
      {this.border, this.hoverBorder, this.hoverForeground, this.shadow = const []});
  final Color background;
  final Color hover;
  final Color pressed;
  final Color foreground;
  final Color? border;
  final Color? hoverBorder;
  final Color? hoverForeground;
  final List<BoxShadow> shadow;
}

const _clear = Color(0x00FFFFFF);

_ToneColors _toneColors(AppButtonTone tone) => switch (tone) {
      AppButtonTone.primary => const _ToneColors(AppColors.primary, AppColors.primaryHover, Color(0xFF1B4683), AppColors.onPrimary,
          shadow: AppShadows.primaryButton),
      AppButtonTone.secondary => const _ToneColors(AppColors.card, AppColors.surface2, AppColors.surface3, AppColors.textPrimary,
          border: AppColors.border, hoverBorder: AppColors.borderStrong, shadow: AppShadows.sm),
      AppButtonTone.subtle => const _ToneColors(_clear, AppColors.surface2, AppColors.surface3, AppColors.textSecondary,
          hoverForeground: AppColors.textPrimary),
      AppButtonTone.soft => const _ToneColors(AppColors.primarySoft, Color(0x262A68C0), Color(0x382A68C0), AppColors.primary),
      AppButtonTone.line => const _ToneColors(_clear, AppColors.surface, AppColors.surface2, AppColors.ink, border: AppColors.line),
      AppButtonTone.amber => const _ToneColors(AppColors.amber, AppColors.warning, Color(0xFFC26A05), AppColors.onPrimary),
      AppButtonTone.resit => const _ToneColors(AppColors.resit, Color(0xFFC88229), Color(0xFFA9650A), AppColors.onPrimary),
      AppButtonTone.danger => const _ToneColors(AppColors.danger, Color(0xFFD12424), AppColors.dangerForeground, AppColors.onPrimary,
          shadow: AppShadows.dangerButton),
      AppButtonTone.dangerOutline => const _ToneColors(_clear, AppColors.dangerSoft, Color(0xFFFDE4E4), AppColors.dangerForeground,
          border: Color(0x40DC2626)),
    };

/// A text button with an optional leading icon (Button.tsx).
class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.trailingIcon,
    this.tone = AppButtonTone.primary,
    this.size = AppButtonSize.medium,
    this.busy = false,
    this.busyLabel,
    this.expand = false,
    this.focusNode,
    this.autofocus = false,
    this.tooltip,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final IconData? trailingIcon;
  final AppButtonTone tone;
  final AppButtonSize size;

  /// Shows a spinner and [busyLabel] and ignores presses.
  final bool busy;
  final String? busyLabel;

  /// Fill the available width.
  final bool expand;
  final FocusNode? focusNode;
  final bool autofocus;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final colors = _toneColors(tone);
    final m = _metrics(size);
    final shown = busy ? (busyLabel ?? label) : label;
    return Pressable(
      onPressed: busy ? null : onPressed,
      semanticLabel: shown,
      focusNode: focusNode,
      autofocus: autofocus,
      tooltip: tooltip,
      builder: (context, s) {
        final enabled = s.enabled || busy;
        final bg = s.pressed ? colors.pressed : (s.hovered ? colors.hover : colors.background);
        final fg = s.hovered ? (colors.hoverForeground ?? colors.foreground) : colors.foreground;
        final border = s.hovered ? (colors.hoverBorder ?? colors.border) : colors.border;
        final content = Row(
          mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (busy)
              Padding(
                padding: EdgeInsets.only(right: m.gap),
                child: AppSpinner(size: m.icon - 2, color: fg),
              )
            else if (icon != null)
              Padding(
                padding: EdgeInsets.only(right: m.gap),
                child: Icon(icon, size: m.icon, color: fg),
              ),
            Flexible(
              child: Text(
                shown,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppText.button.copyWith(fontSize: m.fontSize, color: fg, fontWeight: m.weight),
              ),
            ),
            if (trailingIcon != null && !busy)
              Padding(
                padding: EdgeInsets.only(left: m.gap - 2),
                child: Icon(trailingIcon, size: m.icon - 2, color: fg),
              ),
          ],
        );
        return Opacity(
          opacity: enabled ? 1 : 0.5,
          child: FocusRing(
            visible: s.focused,
            radius: m.radius,
            child: Container(
              height: m.height,
              padding: EdgeInsets.symmetric(horizontal: m.padding),
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(m.radius),
                border: border == null ? null : Border.all(color: border),
                boxShadow: enabled ? colors.shadow : null,
              ),
              // Hug the label unless asked to fill: a Container with an alignment would
              // stretch to any bounded width (a Wrap, a Column).
              child: Center(widthFactor: expand ? null : 1, child: content),
            ),
          ),
        );
      },
    );
  }
}

/// A square icon-only button (IconButton.tsx `ghost`).
class AppIconButton extends StatelessWidget {
  const AppIconButton({
    super.key,
    required this.icon,
    required this.onPressed,
    required this.semanticLabel,
    this.size = 32,
    this.color = AppColors.textSecondary,
    this.tooltip,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final String semanticLabel;
  final double size;
  final Color color;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onPressed: onPressed,
      semanticLabel: semanticLabel,
      tooltip: tooltip ?? semanticLabel,
      builder: (context, s) => Opacity(
        opacity: s.enabled ? 1 : 0.4,
        child: FocusRing(
          visible: s.focused,
          radius: AppRadii.kitSm,
          child: Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              color: s.pressed ? AppColors.surface3 : (s.hovered ? AppColors.surface2 : null),
              borderRadius: BorderRadius.circular(AppRadii.kitSm),
            ),
            alignment: Alignment.center,
            child: Icon(icon, size: math.min(20, size * 0.56), color: s.hovered ? AppColors.textPrimary : color),
          ),
        ),
      ),
    );
  }
}

/// A quiet inline text action ("History · 2 attempts", "Clear filters", "← Past papers").
class AppLinkButton extends StatelessWidget {
  const AppLinkButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.color = AppColors.mute,
    this.fontSize = 12,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Color color;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onPressed: onPressed,
      semanticLabel: label,
      builder: (context, s) {
        final fg = s.hovered ? AppColors.ink : color;
        return FocusRing(
          visible: s.focused,
          radius: AppRadii.kitSm,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: s.pressed ? AppColors.surface3 : (s.hovered ? AppColors.surface2 : null),
              borderRadius: BorderRadius.circular(AppRadii.kitSm),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[Icon(icon, size: fontSize + 2, color: fg), const SizedBox(width: 6)],
                Text(label, style: AppText.caption.copyWith(fontSize: fontSize, fontWeight: FontWeight.w800, color: fg)),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// One option of a [SegmentedFilter].
@immutable
class FilterOption<T> {
  const FilterOption(this.value, this.label, {this.count});
  final T value;
  final String label;

  /// Shown after the label ("New 3"); null hides it.
  final int? count;
}

/// The website's segmented filter (PaperLibrary.tsx `Segmented`): a caps label, then a white
/// tray (radius 11, padding 4, gap 5) of pills (7/14, radius 8, 13 px bold); the active pill is
/// indigo with white text and a soft indigo shadow. Counts are an app addition.
class SegmentedFilter<T> extends StatelessWidget {
  const SegmentedFilter({
    super.key,
    required this.label,
    required this.options,
    required this.selected,
    required this.onChanged,
    this.tray = AppColors.panel,
  });

  final String label;
  final List<FilterOption<T>> options;
  final T selected;
  final ValueChanged<T> onChanged;

  /// The tray's fill (white on the page; a grey tray inside a white card).
  final Color tray;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (label.isNotEmpty) ...[
          Text(label, style: AppText.filterLabel),
          const SizedBox(width: 10),
        ],
        Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(color: tray, borderRadius: BorderRadius.circular(AppRadii.button)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final o in options) ...[
                if (o != options.first) const SizedBox(width: 5),
                _Segment<T>(option: o, active: o.value == selected, onTap: () => onChanged(o.value)),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _Segment<T> extends StatelessWidget {
  const _Segment({required this.option, required this.active, required this.onTap});

  final FilterOption<T> option;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final countText = option.count == null ? '' : ' ${option.count}';
    return Pressable(
      onPressed: onTap,
      selected: active,
      semanticLabel: '${option.label}$countText',
      builder: (context, s) {
        final fg = active ? AppColors.onPrimary : (s.hovered ? AppColors.ink : AppColors.mute);
        final bg = active ? AppColors.indigo : (s.pressed ? AppColors.surface3 : (s.hovered ? AppColors.surface2 : null));
        return FocusRing(
          visible: s.focused,
          radius: AppRadii.kitSm,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(AppRadii.kitSm),
              boxShadow: active ? AppShadows.segmentActive : null,
            ),
            child: Text.rich(
              TextSpan(children: [
                TextSpan(text: option.label),
                if (option.count != null)
                  TextSpan(
                    text: countText,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: active ? const Color(0xCCFFFFFF) : AppColors.faint,
                    ),
                  ),
              ]),
              style: AppText.button.copyWith(color: fg, fontWeight: FontWeight.w700, height: 1.5),
            ),
          ),
        );
      },
    );
  }
}

/// A rounded label ("In progress", "US"): PaperLibrary.tsx badges (11/800, padding 4/10,
/// radius 8) by default; the subject chip and MidtermList's badges pass their own metrics.
class StatusBadge extends StatelessWidget {
  const StatusBadge({
    super.key,
    required this.label,
    required this.foreground,
    required this.background,
    this.dot,
    this.icon,
    this.fontSize = 11,
    this.weight = FontWeight.w800,
    this.padding = const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    this.radius = 8,
  });

  final String label;
  final Color foreground;
  final Color background;
  final Color? dot;
  final IconData? icon;
  final double fontSize;
  final FontWeight weight;
  final EdgeInsets padding;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(radius)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot != null) ...[
            Container(width: 7, height: 7, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
            const SizedBox(width: 6),
          ],
          if (icon != null) ...[Icon(icon, size: 13, color: foreground), const SizedBox(width: 6)],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              softWrap: false,
              style: AppText.badge.copyWith(color: foreground, fontSize: fontSize, fontWeight: weight, height: 1.5),
            ),
          ),
        ],
      ),
    );
  }
}

enum NoticeTone { info, success, warning, danger, offline }

/// A full-width notice ("You're offline…", "A new version…") — the website's Alert.tsx: radius
/// 12, padding 16, a tone/25 border on the tone's soft fill, an 18 px icon, the title 14/600
/// and the message 13 px at 90 %. The action button is the app's addition.
class NoticeBanner extends StatelessWidget {
  const NoticeBanner({
    super.key,
    required this.tone,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.actionBusy = false,
    this.onClose,
    this.icon,
  });

  final NoticeTone tone;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool actionBusy;
  final VoidCallback? onClose;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final (bg, border, fg, defaultIcon) = switch (tone) {
      NoticeTone.info => (AppColors.infoSoft, const Color(0x400284C7), AppColors.infoForeground, LucideIcons.info),
      NoticeTone.success => (AppColors.successSoft, const Color(0x40059669), AppColors.successForeground, LucideIcons.circleCheck),
      NoticeTone.warning => (AppColors.warningSoft, const Color(0x40D97706), AppColors.warningForeground, LucideIcons.triangleAlert),
      NoticeTone.danger => (AppColors.dangerSoft, const Color(0x40DC2626), AppColors.dangerForeground, LucideIcons.circleAlert),
      NoticeTone.offline => (AppColors.surface2, AppColors.border, AppColors.textPrimary, LucideIcons.wifiOff),
    };
    return Semantics(
      container: true,
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(AppRadii.kitMd),
          border: Border.all(color: border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Icon(icon ?? defaultIcon, size: 18, color: fg),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(title, style: AppText.body.copyWith(fontWeight: FontWeight.w600, color: fg, height: 1.45)),
                  if (message != null && message!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        message!,
                        style: AppText.small.copyWith(
                          fontWeight: FontWeight.w400,
                          height: 1.625,
                          color: fg.withValues(alpha: 0.9),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            if (actionLabel != null) ...[
              const SizedBox(width: 12),
              AppButton(
                label: actionLabel!,
                onPressed: onAction,
                busy: actionBusy,
                tone: tone == NoticeTone.info ? AppButtonTone.primary : AppButtonTone.secondary,
                size: AppButtonSize.small,
              ),
            ],
            if (onClose != null) ...[
              const SizedBox(width: 6),
              AppIconButton(icon: LucideIcons.x, onPressed: onClose, semanticLabel: 'Dismiss', size: 26, color: fg),
            ],
          ],
        ),
      ),
    );
  }
}

/// A white panel. By default the kit's Card (Card.tsx: radius 16, hairline border, the resting
/// shadow); [AppCard.board] is the dashboard's flat panel (--dz-border, no shadow).
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpace.xl),
    this.radius = AppRadii.kitLg,
  })  : border = AppColors.border,
        shadow = AppShadows.sm;

  const AppCard.board({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpace.xl),
    this.radius = AppRadii.kitLg,
  })  : border = AppColors.line,
        shadow = const [];

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final Color border;
  final List<BoxShadow> shadow;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: AppColors.panel,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: border),
        boxShadow: shadow,
      ),
      child: child,
    );
  }
}

/// "OCTOBER 2025 ─────" — the past-papers group header (13/800, .06em, a hairline after it).
class GroupHeader extends StatelessWidget {
  const GroupHeader({super.key, required this.label, this.count, this.dot});

  final String label;
  final int? count;
  final Color? dot;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.md),
      child: Row(
        children: [
          if (dot != null) ...[
            Container(width: 9, height: 9, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
            const SizedBox(width: 8),
          ],
          Text(label.toUpperCase(), style: AppText.groupLabel),
          if (count != null) ...[
            const SizedBox(width: 8),
            Text('$count', style: AppText.caption.copyWith(color: AppColors.faint)),
          ],
          const SizedBox(width: 10),
          const Expanded(child: SizedBox(height: 1, child: ColoredBox(color: AppColors.line))),
        ],
      ),
    );
  }
}

/// A section title with an optional hint line.
class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.hint, this.trailing});

  final String title;
  final String? hint;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.lg),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppText.heading),
                if (hint != null)
                  Padding(padding: const EdgeInsets.only(top: 3), child: Text(hint!, style: AppText.bodyMuted)),
              ],
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// The eyebrow and title at the top of a page ("SIMULATION" / "Past papers": 12/800 at .18em in
/// --dz-faint, then 38/800 at -.03em, line-height 1.05, 8 px apart).
class PageHeading extends StatelessWidget {
  const PageHeading({
    super.key,
    required this.eyebrow,
    required this.title,
    this.eyebrowTracking = 0.18,
    this.eyebrowColor = AppColors.faint,
    this.gap = 8,
    this.titleSize = 38,
    this.titleTracking = -0.03,
    this.titleHeight = 1.05,
  });

  final String eyebrow;
  final String title;

  /// Letter spacing of the eyebrow, in em.
  final double eyebrowTracking;
  final Color eyebrowColor;
  final double gap;
  final double titleSize;

  /// Letter spacing of the title, in em.
  final double titleTracking;
  final double titleHeight;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(eyebrow, style: AppText.eyebrow.copyWith(letterSpacing: 12 * eyebrowTracking, color: eyebrowColor)),
          SizedBox(height: gap),
          Text(
            title,
            style: AppText.title.copyWith(fontSize: titleSize, letterSpacing: titleSize * titleTracking, height: titleHeight),
          ),
        ],
      ),
    );
  }
}

/// A small indeterminate spinner (loading states only — never decoration).
class AppSpinner extends StatelessWidget {
  const AppSpinner({super.key, this.size = 18, this.color = AppColors.indigo});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CircularProgressIndicator(strokeWidth: 2, color: color),
    );
  }
}

/// The empty / error block of a list (PaperLibrary.tsx PapersEmpty / PapersError): radius 22,
/// padding 64/40, an 88 px tile (radius 26) with a 40 px icon, a 22 px title and 15 px text.
/// Empty is a dashed 1.5 px --dz-border on white; error is solid on the error tint.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
    this.actionIcon,
    this.error = false,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final IconData? actionIcon;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final body = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 64),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              color: error ? AppColors.errorSoft : AppColors.indigoSoft,
              borderRadius: BorderRadius.circular(26),
            ),
            child: Icon(icon, size: 40, color: error ? AppColors.error : AppColors.indigo),
          ),
          const SizedBox(height: 22),
          Text(
            title,
            textAlign: TextAlign.center,
            style: AppText.heading.copyWith(fontSize: 22, letterSpacing: 22 * -0.01),
          ),
          const SizedBox(height: 8),
          ConstrainedBox(
            constraints: BoxConstraints(maxWidth: error ? 440 : 420),
            child: Text(
              message,
              textAlign: TextAlign.center,
              style: AppText.bodyMuted.copyWith(fontSize: 15, height: 1.5),
            ),
          ),
          if (actionLabel != null) ...[
            const SizedBox(height: 26),
            AppButton(label: actionLabel!, onPressed: onAction, icon: actionIcon, size: AppButtonSize.block),
          ],
        ],
      ),
    );
    const radius = 22.0;
    if (error) {
      return Container(
        width: double.infinity,
        decoration: BoxDecoration(
          color: AppColors.errorBackground,
          borderRadius: BorderRadius.circular(radius),
          border: Border.all(color: AppColors.errorBorder, width: 1.5),
        ),
        child: body,
      );
    }
    return CustomPaint(
      foregroundPainter: const DashedRRectPainter(color: AppColors.line, radius: radius, strokeWidth: 1.5),
      child: Container(
        width: double.infinity,
        decoration: BoxDecoration(color: AppColors.panel, borderRadius: BorderRadius.circular(radius)),
        child: body,
      ),
    );
  }
}

/// A dashed rounded-rectangle outline (CSS `border: dashed`: dashes about three strokes long).
class DashedRRectPainter extends CustomPainter {
  const DashedRRectPainter({required this.color, required this.radius, this.strokeWidth = 1, this.dash = 6, this.gap = 4});

  final Color color;
  final double radius;
  final double strokeWidth;
  final double dash;
  final double gap;

  @override
  void paint(Canvas canvas, Size size) {
    final inset = strokeWidth / 2;
    final rrect = RRect.fromRectAndRadius(
      Rect.fromLTWH(inset, inset, size.width - strokeWidth, size.height - strokeWidth),
      Radius.circular(math.max(0, radius - inset)),
    );
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    for (final metric in (Path()..addRRect(rrect)).computeMetrics()) {
      var d = 0.0;
      while (d < metric.length) {
        canvas.drawPath(metric.extractPath(d, math.min(d + dash, metric.length)), paint);
        d += dash + gap;
      }
    }
  }

  @override
  bool shouldRepaint(DashedRRectPainter old) =>
      old.color != color || old.radius != radius || old.strokeWidth != strokeWidth || old.dash != dash || old.gap != gap;
}

/// How an [AppTextField] looks.
enum AppFieldLook {
  /// The kit's Input.tsx: 44 high, radius 12, on --bg, hairline border, the card shadow; focus
  /// turns the border primary with a 3 px primary-soft ring.
  kit,

  /// The past-papers search (pastpapers/page.tsx): white, --dz-border, radius 14, 15 px text,
  /// padding 14/16/14/48, an 18 px icon.
  search,
}

/// Text field with the app's look (the only selectable thing outside the island).
class AppTextField extends StatefulWidget {
  const AppTextField({
    super.key,
    required this.controller,
    this.focusNode,
    this.hint,
    this.prefixIcon,
    this.onChanged,
    this.onClear,
    this.onEscape,
    this.semanticLabel,
    this.look = AppFieldLook.kit,
  });

  final TextEditingController controller;
  final FocusNode? focusNode;
  final String? hint;
  final IconData? prefixIcon;
  final ValueChanged<String>? onChanged;

  /// Shows a clear button while there is text.
  final VoidCallback? onClear;
  final VoidCallback? onEscape;
  final String? semanticLabel;
  final AppFieldLook look;

  @override
  State<AppTextField> createState() => _AppTextFieldState();
}

class _AppTextFieldState extends State<AppTextField> {
  FocusNode? _own;
  FocusNode get _focus => widget.focusNode ?? (_own ??= FocusNode(debugLabel: 'AppTextField'));
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _focus.addListener(_onFocus);
    _focused = _focus.hasFocus;
  }

  @override
  void didUpdateWidget(AppTextField old) {
    super.didUpdateWidget(old);
    if (old.focusNode != widget.focusNode) {
      (old.focusNode ?? _own)?.removeListener(_onFocus);
      _focus.addListener(_onFocus);
      _focused = _focus.hasFocus;
    }
  }

  @override
  void dispose() {
    _focus.removeListener(_onFocus);
    _own?.dispose();
    super.dispose();
  }

  void _onFocus() {
    if (mounted && _focus.hasFocus != _focused) setState(() => _focused = _focus.hasFocus);
  }

  @override
  Widget build(BuildContext context) {
    final search = widget.look == AppFieldLook.search;
    final face = currentFace(context);
    final fontSize = search ? 15.0 : 14.0;
    final radius = search ? AppRadii.md : AppRadii.kitMd;
    final rest = search ? AppColors.line : AppColors.border;
    final iconColor = search ? AppColors.faint : AppColors.textLabel;
    final placeholder = search ? AppColors.faint : AppColors.textLabel;
    final field = ValueListenableBuilder<TextEditingValue>(
      valueListenable: widget.controller,
      builder: (context, value, _) {
        return TextField(
          controller: widget.controller,
          focusNode: _focus,
          onChanged: widget.onChanged,
          // No right-click menu anywhere (architecture §2.3); keyboard copy/paste still work.
          contextMenuBuilder: null,
          style: AppText.body.copyWith(fontFamily: face, fontSize: fontSize, fontWeight: FontWeight.w500, color: AppColors.ink),
          cursorWidth: 1.5,
          mouseCursor: SystemMouseCursors.text,
          decoration: InputDecoration(
            isDense: true,
            filled: true,
            fillColor: search ? AppColors.panel : AppColors.background,
            hintText: widget.hint,
            hintStyle: AppText.body.copyWith(fontFamily: face, fontSize: fontSize, fontWeight: FontWeight.w400, color: placeholder),
            prefixIcon: widget.prefixIcon == null
                ? null
                : Padding(
                    padding: EdgeInsets.only(left: search ? 18 : 12, right: search ? 12 : 10),
                    child: Icon(widget.prefixIcon, size: 18, color: iconColor),
                  ),
            prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
            suffixIcon: (widget.onClear != null && value.text.isNotEmpty)
                ? Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: AppIconButton(
                      icon: LucideIcons.x,
                      onPressed: widget.onClear,
                      semanticLabel: 'Clear search',
                      size: 28,
                      color: iconColor,
                    ),
                  )
                : null,
            suffixIconConstraints: const BoxConstraints(minWidth: 36, minHeight: 28),
            contentPadding: search
                ? EdgeInsets.fromLTRB(widget.prefixIcon == null ? 16 : 0, 14, 16, 14)
                : EdgeInsets.fromLTRB(widget.prefixIcon == null ? 14 : 0, 12, 14, 12),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(radius), borderSide: BorderSide(color: rest)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(radius), borderSide: BorderSide(color: rest)),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(radius),
              borderSide: const BorderSide(color: AppColors.primary),
            ),
          ),
        );
      },
    );
    final framed = DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        boxShadow: _focused
            ? const [BoxShadow(color: AppColors.primarySoft, spreadRadius: 3)]
            : (search ? null : AppShadows.sm),
      ),
      child: field,
    );
    final withEscape = widget.onEscape == null
        ? framed
        : CallbackShortcuts(
            bindings: {const SingleActivator(LogicalKeyboardKey.escape): widget.onEscape!},
            child: framed,
          );
    return Semantics(textField: true, label: widget.semanticLabel, child: withEscape);
  }
}

/// A labelled control (Field.tsx): the label (14/600) over the control, then the error
/// (13/500, danger) or else the hint (13, muted), 6 apart.
class AppField extends StatelessWidget {
  const AppField({super.key, required this.child, this.label, this.hint, this.error});

  final String? label;
  final String? hint;

  /// Shown instead of [hint] when set.
  final String? error;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final note = error ?? hint;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (label != null) ...[
          Text(label!, style: AppText.body.copyWith(fontWeight: FontWeight.w600, height: 1.43, color: AppColors.textPrimary)),
          const SizedBox(height: 6),
        ],
        child,
        if (note != null) ...[
          const SizedBox(height: 6),
          Text(
            note,
            style: AppText.small.copyWith(
              fontWeight: error != null ? FontWeight.w500 : FontWeight.w400,
              height: 1.45,
              color: error != null ? AppColors.dangerForeground : AppColors.textSecondary,
            ),
          ),
        ],
      ],
    );
  }
}

/// Shows a modal dialog with no transition (instant, like a native dialog) over the website's
/// Modal backdrop: --overlay-scrim with a 2 px blur.
Future<T?> showAppDialog<T>(BuildContext context, {required WidgetBuilder builder, bool dismissible = true}) {
  return showGeneralDialog<T>(
    context: context,
    barrierDismissible: dismissible,
    barrierLabel: 'Close',
    barrierColor: const Color(0x00000000),
    transitionDuration: Duration.zero,
    pageBuilder: (context, _, _) => Stack(
      children: [
        Positioned.fill(
          child: IgnorePointer(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 2, sigmaY: 2),
              child: const ColoredBox(color: AppColors.scrim),
            ),
          ),
        ),
        Positioned.fill(child: builder(context)),
      ],
    ),
  );
}

/// The website's Modal panel (Modal.tsx): radius 16, hairline border, the modal shadow, at most
/// 512 wide; a header (title 18/600 and an optional description) with the close button, the
/// body, and an optional footer on --surface behind a divider.
class AppModal extends StatelessWidget {
  const AppModal({
    super.key,
    required this.title,
    required this.child,
    this.description,
    this.icon,
    this.danger = false,
    this.footer,
    this.onClose,
    this.maxWidth = 512,
    this.maxHeight,
    this.bodyPadding = const EdgeInsets.all(20),
  });

  final String title;
  final String? description;
  final IconData? icon;
  final bool danger;
  final Widget child;

  /// Footer buttons, right-aligned (gap 12).
  final List<Widget>? footer;

  /// The × in the header; null hides it.
  final VoidCallback? onClose;
  final double maxWidth;
  final double? maxHeight;
  final EdgeInsets bodyPadding;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxWidth, maxHeight: maxHeight ?? double.infinity),
          child: Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: AppColors.card,
              borderRadius: BorderRadius.circular(AppRadii.kitLg),
              border: Border.all(color: AppColors.border),
              boxShadow: AppShadows.lg,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.fromLTRB(20, 16, 14, 16),
                  decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.border))),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (icon != null) ...[
                        Container(
                          width: 32,
                          height: 32,
                          margin: const EdgeInsets.only(right: 12),
                          decoration: BoxDecoration(
                            color: danger ? AppColors.dangerSoft : AppColors.primarySoft,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Icon(icon, size: 17, color: danger ? AppColors.dangerForeground : AppColors.primary),
                        ),
                      ],
                      Expanded(
                        child: Padding(
                          padding: EdgeInsets.only(top: icon != null ? 4 : 0),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(title, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.dialogTitle),
                              if (description != null)
                                Padding(
                                  padding: const EdgeInsets.only(top: 2),
                                  child: Text(description!, style: AppText.body.copyWith(fontWeight: FontWeight.w400, color: AppColors.textSecondary)),
                                ),
                            ],
                          ),
                        ),
                      ),
                      if (onClose != null) ...[
                        const SizedBox(width: 12),
                        AppIconButton(icon: LucideIcons.x, semanticLabel: 'Close', size: 32, onPressed: onClose),
                      ],
                    ],
                  ),
                ),
                Flexible(child: Padding(padding: bodyPadding, child: child)),
                if (footer != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                    decoration: const BoxDecoration(
                      color: AppColors.surface,
                      border: Border(top: BorderSide(color: AppColors.border)),
                    ),
                    child: Wrap(
                      alignment: WrapAlignment.end,
                      spacing: 12,
                      runSpacing: 8,
                      children: footer!,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A confirm/alert dialog: an [AppModal] with the message as its body and the actions in the
/// footer. The × closes it with no answer (as Escape and a click outside do).
class AppDialog extends StatelessWidget {
  const AppDialog({super.key, required this.title, required this.message, required this.actions, this.icon, this.danger = false});

  final String title;
  final String message;
  final List<Widget> actions;
  final IconData? icon;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    return AppModal(
      title: title,
      icon: icon,
      danger: danger,
      onClose: () => Navigator.of(context).pop(),
      footer: actions,
      child: Text(message, style: AppText.body.copyWith(fontWeight: FontWeight.w400, height: 1.6, color: AppColors.textSecondary)),
    );
  }
}
