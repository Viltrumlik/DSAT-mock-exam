// `mastersat://` links arriving from the browser (architecture §6 "Single instance and deep
// links"). The Windows runner (windows-host, runner/flutter_window.h) owns the native half:
//
//   MethodChannel('mastersat/launch')
//     native → Dart  'open'         {'url': String}  a link handed to the running instance (a
//                                                    second launch's WM_COPYDATA), once Dart
//                                                    has called takePending
//                    'activate'     null             a second launch without a link
//     Dart → native  'takePending'  → List<String>   links that arrived before Dart listened —
//                                                    including the one this process was started
//                                                    with; marks Dart as listening
//                    'focusWindow'  → bool           restore + bring the window to the front
//
// Only `mastersat://auth?code=…` is acted on (everything else is ignored).
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// The sign-in code inside a `mastersat://auth?code=…` link, or null for any other link.
String? signInCodeFrom(String raw) {
  final Uri uri;
  try {
    uri = Uri.parse(raw.trim());
  } on FormatException {
    return null;
  }
  if (uri.scheme.toLowerCase() != 'mastersat') return null;
  if (uri.host.toLowerCase() != 'auth') return null;
  if (uri.path.isNotEmpty && uri.path != '/') return null;
  final code = uri.queryParameters['code']?.trim();
  if (code == null || code.isEmpty || code.length > 512) return null;
  return code;
}

class LaunchLinks {
  LaunchLinks({this._channel = const MethodChannel(channelName)}) {
    _channel.setMethodCallHandler(_handle);
  }

  static const channelName = 'mastersat/launch';

  final MethodChannel _channel;
  final StreamController<String> _links = StreamController<String>.broadcast();
  final StreamController<void> _activations = StreamController<void>.broadcast();

  /// Raw URLs as they arrive.
  Stream<String> get links => _links.stream;

  /// A second launch with no link (the student opened the app again from the Start menu).
  Stream<void> get activations => _activations.stream;

  Future<Object?> _handle(MethodCall call) async {
    switch (call.method) {
      case 'open':
        final args = call.arguments;
        final url = args is Map ? args['url'] : args;
        if (url is String) _links.add(url);
      case 'link': // a bare String argument (older runner builds)
        if (call.arguments is String) _links.add(call.arguments as String);
      case 'activate':
        _activations.add(null);
    }
    return null;
  }

  /// The links that arrived before the app listened (the one it was launched with first).
  /// Calling this tells the runner Dart is listening; later links come through [links].
  Future<List<String>> takePending() async {
    try {
      final list = await _channel.invokeListMethod<Object?>('takePending');
      return [for (final v in list ?? const <Object?>[]) if (v is String) v];
    } on MissingPluginException {
      return const []; // no native half (tests, the macOS dev runner)
    } on PlatformException catch (e) {
      debugPrint('mastersat/launch takePending failed: ${e.message}');
      return const [];
    }
  }

  /// Brings the window to the front (after the browser hands a sign-in back).
  Future<void> focusWindow() async {
    try {
      await _channel.invokeMethod<Object?>('focusWindow');
    } on MissingPluginException {
      // No native half.
    } on PlatformException catch (e) {
      debugPrint('mastersat/launch focusWindow failed: ${e.message}');
    }
  }

  void dispose() {
    _channel.setMethodCallHandler(null);
    unawaited(_links.close());
    unawaited(_activations.close());
  }
}
