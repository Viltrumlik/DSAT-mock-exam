// Port of tools/calculator/DesmosCalculator.tsx: the calculator's floating panel — dark title
// bar with Graphing/Scientific tabs, an enlarge toggle and close — around the Desmos island
// (a second IslandHost of kind desmos). While Desmos loads, a white veil with a spinner; if it
// cannot load (offline, script error, timeout) the native scientific calculator takes over.
//
// Scientific-only papers (junior/foundation Math midterms) hide the tabs. With
// [nativeScientificOnly] (the default for this app) they get the native scientific calculator
// straight away and never create the Desmos island; set it false to use Desmos's Scientific
// calculator instead, as the website does.
import 'package:flutter/widgets.dart';

import '../../runner/icons/lucide_glyphs.dart';
import '../../runner/runner_style.dart';
import '../../runner/runner_tools.dart';
import '../../tokens/bluebook_tokens.dart';
import '../floating_panel.dart';
import 'desmos_controller.dart';
import 'scientific_calculator.dart';

class DesmosPanel extends StatefulWidget {
  const DesmosPanel({
    super.key,
    required this.controller,
    required this.tools,
    required this.scientificOnly,
    this.nativeScientificOnly = true,
    this.animate = true,
  });

  final DesmosController controller;
  final RunnerTools tools;
  final bool scientificOnly;
  final bool nativeScientificOnly;

  /// Goldens freeze the spinner.
  final bool animate;

  @override
  State<DesmosPanel> createState() => _DesmosPanelState();
}

class _DesmosPanelState extends State<DesmosPanel> {
  bool get _native => widget.scientificOnly && widget.nativeScientificOnly;

  CalculatorTab get _tab => widget.scientificOnly ? CalculatorTab.scientific : widget.tools.calculatorTab;

  @override
  void initState() {
    super.initState();
    if (!_native) {
      // Before listening: its synchronous status change must not mark us dirty mid-build.
      widget.controller.ensureOpen(_tab);
      widget.controller.setVisible(true);
    }
    widget.controller.addListener(_changed);
    widget.tools.addListener(_toolsChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    widget.tools.removeListener(_toolsChanged);
    if (!_native) widget.controller.setVisible(false);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  void _toolsChanged() {
    if (!_native) widget.controller.setMode(_tab);
    if (mounted) setState(() {});
  }

  Widget _tabButton(CalculatorTab tab, String label) {
    final active = _tab == tab;
    return Pressable(
      key: ValueKey('calc.tab.${tab.name}'),
      semanticLabel: label,
      selected: active,
      onTap: () => widget.tools.setCalculatorTab(tab),
      builder: (context, s) => Container(
        padding: BluebookTokens.calcTabPadding,
        decoration: BoxDecoration(
          color: active ? TwColors.white : null,
          borderRadius: BorderRadius.circular(BluebookTokens.calcTabRadius),
        ),
        child: Text(
          label,
          style: chromeText(
            12,
            weight: FontWeight.w700,
            color: active ? TwColors.slate900 : (s.hovered ? TwColors.white : TwColors.slate300),
            height: 16 / 12,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final tools = widget.tools;
    final enlarged = tools.calculatorEnlarged;
    final size = enlarged ? BluebookTokens.calculatorEnlargedSize : BluebookTokens.calculatorRect.size;
    final status = widget.controller.status;
    final Widget body;
    if (_native || status == DesmosStatus.failed) {
      body = const ScientificCalculator(key: ValueKey('calc.scientific'));
    } else {
      final host = widget.controller.host;
      body = Stack(
        fit: StackFit.expand,
        children: [
          if (host != null) KeyedSubtree(key: const ValueKey('calc.island'), child: host.build(context)),
          if (status != DesmosStatus.ready)
            ColoredBox(
              key: const ValueKey('calc.loading'),
              color: const Color(0xB3FFFFFF), // bg-white/70
              child: Center(child: BorderSpinner(size: 32, animate: widget.animate)),
            ),
        ],
      );
    }
    return FloatingPanel(
      panelKey: const ValueKey('panel.calculator'),
      title: widget.scientificOnly ? 'Scientific Calculator' : 'Calculator',
      onClose: tools.toggleCalculator,
      dark: true,
      initial: Offset(BluebookTokens.calculatorRect.left, BluebookTokens.calculatorRect.top) & size,
      minSize: BluebookTokens.calculatorMin,
      onBodyRect: (r) => widget.controller.host?.setBounds(r),
      headerLeft: widget.scientificOnly
          ? null
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _tabButton(CalculatorTab.graphing, 'Graphing'),
                const SizedBox(width: 4),
                _tabButton(CalculatorTab.scientific, 'Scientific'),
              ],
            ),
      headerExtra: PanelIconButton(
        key: const ValueKey('calc.enlarge'),
        glyph: enlarged ? LucideGlyphs.minimize2 : LucideGlyphs.maximize2,
        label: enlarged ? 'Shrink calculator' : 'Enlarge calculator',
        dark: true,
        onTap: tools.toggleCalculatorEnlarge,
      ),
      child: body,
    );
  }
}
