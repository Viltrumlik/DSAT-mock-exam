// The app's own controls. Every clickable thing outside the exam runner is a [Pressable]:
//  * arrow cursor (never the hand), no ink ripple, no hover lift — hover only darkens a fill;
//  * Enter / Space activate it when focused; a focus ring shows in keyboard mode only;
//  * a semantics node with `button: true`, so tests (and screen readers) find it.
// The "every button does something" sweep (test/features/home/every_button_sweep_test.dart)
// walks every [Pressable] on every screen.
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

/// Draws the keyboard focus ring (the website's --ring) around [child].
class FocusRing extends StatelessWidget {
  const FocusRing({super.key, required this.visible, required this.radius, required this.child});

  final bool visible;
  final double radius;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!visible) return child;
    return DecoratedBox(
      position: DecorationPosition.foreground,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius + 2),
        border: Border.all(color: AppColors.focusRing, width: 2, strokeAlign: BorderSide.strokeAlignOutside),
      ),
      child: child,
    );
  }
}

enum AppButtonTone { primary, secondary, subtle, soft, amber, resit, danger, dangerOutline }

enum AppButtonSize { small, medium, large }

class _ToneColors {
  const _ToneColors(this.background, this.hover, this.pressed, this.foreground, [this.border]);
  final Color background;
  final Color hover;
  final Color pressed;
  final Color foreground;
  final Color? border;
}

_ToneColors _toneColors(AppButtonTone tone) => switch (tone) {
      AppButtonTone.primary =>
        const _ToneColors(AppColors.indigo, AppColors.indigoDeep, Color(0xFF1B4683), AppColors.onPrimary),
      AppButtonTone.secondary =>
        const _ToneColors(Color(0x00FFFFFF), AppColors.surface2, AppColors.surface3, AppColors.ink, AppColors.line),
      AppButtonTone.subtle =>
        const _ToneColors(Color(0x00FFFFFF), AppColors.surface2, AppColors.surface3, AppColors.mute),
      AppButtonTone.soft =>
        const _ToneColors(AppColors.indigoSoft, Color(0xFFDAE6F8), Color(0xFFCCDCF4), AppColors.indigo),
      AppButtonTone.amber =>
        const _ToneColors(AppColors.amber, AppColors.warning, Color(0xFFC26A05), AppColors.onPrimary),
      AppButtonTone.resit =>
        const _ToneColors(AppColors.resit, Color(0xFFA9650A), Color(0xFF915708), AppColors.onPrimary),
      AppButtonTone.danger =>
        const _ToneColors(AppColors.danger, AppColors.dangerForeground, Color(0xFF991B1B), AppColors.onPrimary),
      AppButtonTone.dangerOutline => const _ToneColors(
          Color(0x00FFFFFF), AppColors.dangerSoft, Color(0xFFFDE4E4), AppColors.dangerForeground, AppColors.errorBorder),
    };

/// A text button with an optional leading icon.
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
    final (height, padding, fontSize, iconSize) = switch (size) {
      AppButtonSize.small => (30.0, 10.0, 12.0, 14.0),
      AppButtonSize.medium => (36.0, 14.0, 13.0, 15.0),
      AppButtonSize.large => (44.0, 20.0, 15.0, 17.0),
    };
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
        final fg = colors.foreground;
        final content = Row(
          mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (busy)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: AppSpinner(size: iconSize - 2, color: fg),
              )
            else if (icon != null)
              Padding(
                padding: const EdgeInsets.only(right: 7),
                child: Icon(icon, size: iconSize, color: fg),
              ),
            Flexible(
              child: Text(
                shown,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppText.button.copyWith(fontSize: fontSize, color: fg, fontWeight: FontWeight.w800),
              ),
            ),
            if (trailingIcon != null && !busy)
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: Icon(trailingIcon, size: iconSize, color: fg),
              ),
          ],
        );
        return Opacity(
          opacity: enabled ? 1 : 0.5,
          child: FocusRing(
            visible: s.focused,
            radius: AppRadii.button,
            child: Container(
              height: height,
              padding: EdgeInsets.symmetric(horizontal: padding),
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(AppRadii.button),
                border: colors.border == null ? null : Border.all(color: colors.border!),
              ),
              alignment: Alignment.center,
              child: content,
            ),
          ),
        );
      },
    );
  }
}

/// A square icon-only button (title-bar style).
class AppIconButton extends StatelessWidget {
  const AppIconButton({
    super.key,
    required this.icon,
    required this.onPressed,
    required this.semanticLabel,
    this.size = 32,
    this.color = AppColors.mute,
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
          radius: 8,
          child: Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              color: s.pressed ? AppColors.surface3 : (s.hovered ? AppColors.surface2 : null),
              borderRadius: BorderRadius.circular(8),
            ),
            alignment: Alignment.center,
            child: Icon(icon, size: size * 0.5, color: s.hovered ? AppColors.ink : color),
          ),
        ),
      ),
    );
  }
}

/// A quiet inline text action ("History · 2 attempts", "Clear filters").
class AppLinkButton extends StatelessWidget {
  const AppLinkButton({super.key, required this.label, required this.onPressed, this.icon, this.color = AppColors.mute});

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onPressed: onPressed,
      semanticLabel: label,
      builder: (context, s) => FocusRing(
        visible: s.focused,
        radius: 8,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: s.pressed ? AppColors.surface3 : (s.hovered ? AppColors.surface2 : null),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 13, color: s.hovered ? AppColors.ink : color), const SizedBox(width: 6)],
              Text(label, style: AppText.caption.copyWith(fontWeight: FontWeight.w800, color: s.hovered ? AppColors.ink : color)),
            ],
          ),
        ),
      ),
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

/// The website's segmented filter (pastpapers/page.tsx `Segmented`): a caps label and a pill
/// row; the active pill is indigo with white text. Counts are an app addition.
class SegmentedFilter<T> extends StatelessWidget {
  const SegmentedFilter({
    super.key,
    required this.label,
    required this.options,
    required this.selected,
    required this.onChanged,
  });

  final String label;
  final List<FilterOption<T>> options;
  final T selected;
  final ValueChanged<T> onChanged;

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
          decoration: BoxDecoration(
            color: AppColors.panel,
            borderRadius: BorderRadius.circular(AppRadii.button),
            border: Border.all(color: AppColors.line),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final o in options) ...[
                if (o != options.first) const SizedBox(width: 4),
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
          radius: 8,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
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
              style: AppText.button.copyWith(color: fg, fontWeight: FontWeight.w700),
            ),
          ),
        );
      },
    );
  }
}

/// A rounded label ("In progress", "US").
class StatusBadge extends StatelessWidget {
  const StatusBadge({
    super.key,
    required this.label,
    required this.foreground,
    required this.background,
    this.dot,
    this.icon,
  });

  final String label;
  final Color foreground;
  final Color background;
  final Color? dot;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(8)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot != null) ...[
            Container(width: 7, height: 7, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
            const SizedBox(width: 6),
          ],
          if (icon != null) ...[Icon(icon, size: 12, color: foreground), const SizedBox(width: 5)],
          Text(label, style: AppText.badge.copyWith(color: foreground)),
        ],
      ),
    );
  }
}

enum NoticeTone { info, success, warning, danger, offline }

/// A full-width notice ("You're offline…", "A new version…").
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
      NoticeTone.info => (AppColors.indigoSoft, const Color(0xFFCFDDF3), AppColors.indigoDeep, LucideIcons.info),
      NoticeTone.success => (AppColors.successSoft, const Color(0xFFBBEBD6), AppColors.successForeground, LucideIcons.circleCheck),
      NoticeTone.warning => (AppColors.warningSoft, const Color(0xFFF6DFB0), AppColors.warningForeground, LucideIcons.triangleAlert),
      NoticeTone.danger => (AppColors.errorBackground, AppColors.errorBorder, AppColors.dangerForeground, LucideIcons.circleAlert),
      NoticeTone.offline => (AppColors.surface2, AppColors.surface3, AppColors.textSecondary, LucideIcons.wifiOff),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppRadii.md),
        border: Border.all(color: border),
      ),
      child: Row(
        children: [
          Icon(icon ?? defaultIcon, size: 17, color: fg),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title, style: AppText.body.copyWith(fontWeight: FontWeight.w700, color: fg)),
                if (message != null && message!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(message!, style: AppText.small.copyWith(color: fg.withValues(alpha: 0.85))),
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
              tone: tone == NoticeTone.danger ? AppButtonTone.secondary : AppButtonTone.primary,
              size: AppButtonSize.small,
            ),
          ],
          if (onClose != null) ...[
            const SizedBox(width: 6),
            AppIconButton(icon: LucideIcons.x, onPressed: onClose, semanticLabel: 'Dismiss', size: 28, color: fg),
          ],
        ],
      ),
    );
  }
}

/// A white panel with the dashboard hairline border.
class AppCard extends StatelessWidget {
  const AppCard({super.key, required this.child, this.padding = const EdgeInsets.all(AppSpace.xl), this.radius = AppRadii.lg});

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: AppColors.panel,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: AppColors.line),
      ),
      child: child,
    );
  }
}

/// "OCTOBER 2025 ─────" — the website's group header.
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

/// The empty / error block of a list (website PapersEmpty / PapersError).
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
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 44),
      decoration: BoxDecoration(
        color: error ? AppColors.errorBackground : AppColors.panel,
        borderRadius: BorderRadius.circular(AppRadii.xl),
        border: Border.all(color: error ? AppColors.errorBorder : AppColors.line, width: 1.5),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: error ? AppColors.errorSoft : AppColors.indigoSoft,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Icon(icon, size: 32, color: error ? AppColors.error : AppColors.indigo),
          ),
          const SizedBox(height: 18),
          Text(title, textAlign: TextAlign.center, style: AppText.heading.copyWith(fontSize: 20)),
          const SizedBox(height: 6),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: Text(message, textAlign: TextAlign.center, style: AppText.bodyMuted.copyWith(height: 1.5)),
          ),
          if (actionLabel != null) ...[
            const SizedBox(height: 20),
            AppButton(label: actionLabel!, onPressed: onAction, icon: actionIcon, size: AppButtonSize.large),
          ],
        ],
      ),
    );
  }
}

/// Text field with the app's look (the only selectable thing outside the island).
class AppTextField extends StatelessWidget {
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

  @override
  Widget build(BuildContext context) {
    final field = ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, _) {
        return TextField(
          controller: controller,
          focusNode: focusNode,
          onChanged: onChanged,
          // No right-click menu anywhere (architecture §2.3); keyboard copy/paste still work.
          contextMenuBuilder: null,
          style: AppText.body.copyWith(fontSize: 14),
          cursorWidth: 1.5,
          mouseCursor: SystemMouseCursors.text,
          decoration: InputDecoration(
            isDense: true,
            filled: true,
            fillColor: AppColors.panel,
            hintText: hint,
            hintStyle: AppText.bodyMuted.copyWith(color: AppColors.faint),
            prefixIcon: prefixIcon == null ? null : Icon(prefixIcon, size: 17, color: AppColors.faint),
            prefixIconConstraints: const BoxConstraints(minWidth: 42, minHeight: 40),
            suffixIcon: (onClear != null && value.text.isNotEmpty)
                ? Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: AppIconButton(
                      icon: LucideIcons.x,
                      onPressed: onClear,
                      semanticLabel: 'Clear search',
                      size: 28,
                    ),
                  )
                : null,
            suffixIconConstraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.line),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.line),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.indigo, width: 1.5),
            ),
          ),
        );
      },
    );
    final withEscape = onEscape == null
        ? field
        : CallbackShortcuts(
            bindings: {const SingleActivator(LogicalKeyboardKey.escape): onEscape!},
            child: field,
          );
    return Semantics(textField: true, label: semanticLabel, child: withEscape);
  }
}

/// Shows a modal dialog with no transition (instant, like a native dialog).
Future<T?> showAppDialog<T>(BuildContext context, {required WidgetBuilder builder, bool dismissible = true}) {
  return showGeneralDialog<T>(
    context: context,
    barrierDismissible: dismissible,
    barrierLabel: 'Close',
    barrierColor: AppColors.scrim,
    transitionDuration: Duration.zero,
    pageBuilder: (context, _, _) => builder(context),
  );
}

/// A confirm/alert dialog body.
class AppDialog extends StatelessWidget {
  const AppDialog({super.key, required this.title, required this.message, required this.actions, this.icon, this.danger = false});

  final String title;
  final String message;
  final List<Widget> actions;
  final IconData? icon;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: Container(
          margin: const EdgeInsets.all(24),
          padding: const EdgeInsets.fromLTRB(24, 22, 24, 20),
          decoration: BoxDecoration(
            color: AppColors.panel,
            borderRadius: BorderRadius.circular(AppRadii.xl),
            boxShadow: dialogShadow,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (icon != null) ...[
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: danger ? AppColors.dangerSoft : AppColors.indigoSoft,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(icon, size: 18, color: danger ? AppColors.dangerForeground : AppColors.indigo),
                    ),
                    const SizedBox(width: 12),
                  ],
                  Expanded(child: Text(title, style: AppText.heading.copyWith(fontSize: 18))),
                ],
              ),
              const SizedBox(height: 12),
              Text(message, style: AppText.bodyMuted.copyWith(height: 1.5, color: AppColors.textSecondary)),
              const SizedBox(height: 22),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  for (final a in actions) ...[if (a != actions.first) const SizedBox(width: 8), a],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
