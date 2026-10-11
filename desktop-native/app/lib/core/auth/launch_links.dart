// `mastersat://` links arriving from the browser (architecture §6 "Single instance and deep
// links"). The Windows runner (windows-host) owns the native half:
//
//   MethodChannel('mastersat/launch')
//     native → Dart  'link'            argument: String — a URL handed to a running instance
//                                       (WM_COPYDATA from a second launch)
//     Dart → native  'getInitialLink'  returns String? — the URL this process was started with
//
// Only `mastersat://auth?code=…` is accepted (everything else is ignored).
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

  /// Raw URLs as they arrive.
  Stream<String> get links => _links.stream;

  Future<Object?> _handle(MethodCall call) async {
    if (call.method == 'link' && call.arguments is String) {
      _links.add(call.arguments as String);
    }
    return null;
  }

  /// The URL the app was launched with, if any (a sign-in link that cold-started it).
  Future<String?> initialLink() async {
    try {
      return await _channel.invokeMethod<String>('getInitialLink');
    } on MissingPluginException {
      return null; // no native half (tests, the macOS dev runner)
    } on PlatformException catch (e) {
      debugPrint('mastersat/launch getInitialLink failed: ${e.message}');
      return null;
    }
  }

  void dispose() {
    _channel.setMethodCallHandler(null);
    _links.close();
  }
}
