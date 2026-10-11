// The access-code gate after the rules (website MidtermCodeScreen.tsx): the 6-digit code the
// teacher reads out. Asked BEFORE the pre-check, so nobody waits for a late teacher on a locked
// machine. Digits only, six at most; Enter submits; the field is not selectable chrome (no
// selection handles, no context menu).
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/api/v1_api.dart';
import 'midterm_copy.dart';
import 'midterm_ui.dart';

class MidtermCodeScreen extends StatefulWidget {
  const MidtermCodeScreen({super.key, required this.onSubmitCode, required this.onBack});

  /// Verify the code and continue. Throws on an incorrect code (or no connection).
  final Future<void> Function(String code) onSubmitCode;
  final VoidCallback onBack;

  @override
  State<MidtermCodeScreen> createState() => _MidtermCodeScreenState();
}

class _MidtermCodeScreenState extends State<MidtermCodeScreen> {
  final _controller = TextEditingController();
  final _focus = FocusNode(debugLabel: 'access code');
  String? _error;
  bool _busy = false;
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onChanged);
    _focus.addListener(() => setState(() => _focused = _focus.hasFocus));
  }

  void _onChanged() => setState(() => _error = null);

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  String get _code => _controller.text;

  Future<void> _submit() async {
    if (_code.length != 6 || _busy) return;
    setState(() {
      _error = null;
      _busy = true;
    });
    try {
      await widget.onSubmitCode(_code);
    } on Object catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException && e.isTransient ? MidtermCopy.codeNetwork : MidtermCopy.codeWrong;
        _busy = false;
      });
      _focus.requestFocus();
      return;
    }
    // Success moves the flow on; if this screen is still up, give the button back.
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final style = MidtermText.size(30, weight: FontWeight.w700, color: MidtermColors.slate900).copyWith(
      letterSpacing: 30 * 0.5,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    return MidtermFrame(
      maxWidth: 448,
      children: [
        const IconBadge(LucideIcons.keyRound),
        const MidtermTitle(MidtermCopy.codeTitle),
        const MidtermLead(MidtermCopy.codeLead),
        const SizedBox(height: 28),
        GestureDetector(
          onTap: () => _focus.requestFocus(),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
            decoration: BoxDecoration(
              color: MidtermColors.slate50,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: _focused ? MidtermColors.blue500 : MidtermColors.slate200, width: 2),
            ),
            child: Stack(
              alignment: Alignment.center,
              children: [
                if (_code.isEmpty)
                  IgnorePointer(
                    child: Text('••••••',
                        textAlign: TextAlign.center, style: style.copyWith(color: MidtermColors.slate400)),
                  ),
                Semantics(
                  label: 'Access code',
                  textField: true,
                  child: EditableText(
                    controller: _controller,
                    focusNode: _focus,
                    autofocus: true,
                    style: style,
                    textAlign: TextAlign.center,
                    cursorColor: MidtermColors.slate900,
                    backgroundCursorColor: MidtermColors.slate400,
                    keyboardType: TextInputType.number,
                    enableInteractiveSelection: false,
                    showSelectionHandles: false,
                    autocorrect: false,
                    enableSuggestions: false,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(6),
                    ],
                    onSubmitted: (_) => _submit(),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(
              _error!,
              textAlign: TextAlign.center,
              style: MidtermText.size(14, weight: FontWeight.w600, color: MidtermColors.red600),
            ),
          ),
        const SizedBox(height: 28),
        MidtermButton(
          label: _busy ? MidtermCopy.codeStarting : MidtermCopy.codeVerify,
          onPressed: _code.length == 6 && !_busy ? _submit : null,
        ),
        const SizedBox(height: 16),
        Center(
          child: MidtermLinkButton(
            label: MidtermCopy.backToRules,
            icon: LucideIcons.arrowLeft,
            onPressed: _busy ? null : widget.onBack,
          ),
        ),
      ],
    );
  }
}
