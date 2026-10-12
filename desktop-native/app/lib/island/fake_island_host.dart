// FakeIslandHost — an IslandHost for tests and fixture-mode development. It records every
// posted message, answers like a well-behaved island page (scripted mode), lets tests inject
// page events, and renders either a labelled placeholder or a supplied PNG (e.g. a Chromium
// screenshot of the same fixture question, so runner goldens are composites, not blanks).
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'island_host.dart';
import 'protocol.dart';

class FakeIslandHost extends IslandHost {
  FakeIslandHost(
    this.kind, {
    this.scripted = true,
    this.preview,
    this.canDrawOverIsland = true,
    this.build_ = 'fake-island',
  });

  @override
  final IslandKind kind;

  /// Reply like the real page: `ready` on open, `module.loaded`, `question.shown`,
  /// `selection.current` (empty), `desmos.ready`, `desmos.state`.
  final bool scripted;

  /// Optional PNG shown instead of the placeholder and returned by [capturePreview].
  Uint8List? preview;

  @override
  final bool canDrawOverIsland;

  /// The `ready.build` string the fake reports.
  final String build_;

  /// Every message posted to the page, in order.
  final List<IslandMessage> posted = [];

  /// Outgoing messages that were refused (wrong direction/island).
  final List<IslandMessage> refused = [];

  final StreamController<IslandEvent> _events = StreamController.broadcast(sync: true);
  final ValueNotifier<IslandHostState> _state = ValueNotifier(IslandHostState.idle);
  final ValueNotifier<String> _label = ValueNotifier('');

  Rect? bounds;
  bool focused = false;
  bool visible = true;
  int opens = 0;
  Object? desmosStateValue;

  /// Scripted Desmos page: whether desmos.init loads Desmos (answers desmos.ready). False models
  /// a load that never finishes (offline, blocked script).
  bool desmosLoads = true;

  @override
  ValueListenable<IslandHostState> get stateListenable => _state;

  @override
  Stream<IslandEvent> get events => _events.stream;

  /// Posted messages of one type.
  List<T> postedOf<T extends IslandMessage>() => posted.whereType<T>().toList();

  @override
  Future<void> open() async {
    if (_state.value == IslandHostState.disposed) throw StateError('FakeIslandHost is disposed');
    opens++;
    _state.value = IslandHostState.loading;
    await Future<void>.value();
    _state.value = IslandHostState.ready;
    // Like the real pages: both say `ready` as soon as they listen; the Desmos page says
    // desmos.ready only after desmos.init has loaded Desmos (see _reply).
    if (scripted) emit(ReadyMessage(build: build_, protocol: islandProtocolVersion));
  }

  @override
  void post(IslandMessage message) {
    if (!islandAcceptsOutgoing(kind, message) || _state.value == IslandHostState.disposed) {
      refused.add(message);
      assert(islandAcceptsOutgoing(kind, message), '${message.t} cannot be posted to the ${kind.name} island');
      return;
    }
    // Every message must survive the real wire format.
    final wire = jsonDecode(message.encode());
    assert(validateIslandMessage(wire, direction: MessageDirection.toWeb, island: kind) == null);
    posted.add(message);
    if (scripted) _reply(message);
  }

  void _reply(IslandMessage m) {
    switch (m) {
      case ModuleLoadMessage(:final moduleId, :final questions):
        _label.value = 'module $moduleId · ${questions.length} questions';
        emit(ModuleLoadedMessage(moduleId: moduleId, ms: 1, failed: const []));
      case QuestionShowMessage(:final qid, :final index, :final total):
        _label.value = 'Question ${index + 1} of $total (#$qid)';
        emit(QuestionShownMessage(qid: qid, ms: 1));
      case SelectionGetMessage(:final req):
        emit(SelectionCurrentMessage(req: req, qid: _currentQid(), container: null, text: null));
      case DesmosInitMessage(:final state):
        desmosStateValue = state;
        if (desmosLoads) emit(const DesmosReadyMessage(apiVersion: '1.11'));
      case DesmosGetStateMessage(:final req):
        emit(DesmosStateMessage(req: req, state: desmosStateValue ?? const <String, Object?>{}));
      default:
        break;
    }
  }

  int _currentQid() {
    for (final m in posted.reversed) {
      if (m is QuestionShowMessage) return m.qid;
    }
    return 0;
  }

  /// Inject a page → native message (must be a valid to_native message for this island).
  void emit(IslandMessage message) {
    final event = decodeIncoming(kind, message.encode());
    _events.add(event);
  }

  /// Inject raw page output (validated exactly like the real host; invalid → dropped event).
  void emitRaw(Object? json) => _events.add(decodeIncoming(kind, json is String ? json : jsonEncode(json)));

  /// Simulate WebView2 ProcessFailed: crashed, then (scripted) recreated and ready again.
  Future<void> simulateCrash([String reason = 'renderer exited']) async {
    _state.value = IslandHostState.crashed;
    _events.add(IslandCrashedEvent(reason));
    if (scripted) await open();
  }

  @override
  void setBounds(Rect logical) => bounds = logical;

  @override
  Widget build(BuildContext context) {
    final png = preview;
    if (png != null) return Image.memory(png, fit: BoxFit.fill, gaplessPlayback: true);
    return ValueListenableBuilder<String>(
      valueListenable: _label,
      builder: (context, label, _) => ColoredBox(
        color: const Color(0xFFF8FAFC),
        child: Center(
          child: Text(
            '${kind == IslandKind.content ? 'Content island' : 'Desmos island'}${label.isEmpty ? '' : ' — $label'}',
            textDirection: TextDirection.ltr,
            style: const TextStyle(color: Color(0xFF64748B), fontSize: 14),
          ),
        ),
      ),
    );
  }

  @override
  Future<void> focus() async => focused = true;

  @override
  Future<void> releaseFocus() async => focused = false;

  @override
  Future<Uint8List?> capturePreview() async => preview;

  @override
  Future<void> setVisible(bool visible) async => this.visible = visible;

  @override
  Future<void> dispose() async {
    if (_state.value == IslandHostState.disposed) return;
    _state.value = IslandHostState.disposed;
    await _events.close();
    _label.dispose();
  }
}
