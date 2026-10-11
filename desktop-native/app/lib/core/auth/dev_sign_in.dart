// Development shortcut for `flutter run -d macos` against tool/fixture_server: the macOS dev
// runner has no `mastersat://` handler, so instead of a browser trip the app asks the LOCAL
// fixture server for a code (the same `POST /api/desktop/auth/code/` the website's
// /desktop/link page calls) and then exchanges it through the normal path.
//
// Only ever wired when the API origin is loopback AND the build is not a release build
// (see main.dart). It never talks to production.
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../http/api_config.dart';
import '../http/http_transport.dart';
import 'auth_controller.dart';

DevCodeMinter? devCodeMinterFor(ApiConfig config, Transport transport, {bool releaseMode = kReleaseMode}) {
  if (releaseMode || !config.isLoopback) return null;
  return (challenge) async {
    final resp = await transport.send(TransportRequest(
      method: 'POST',
      url: config.resolve('/api/desktop/auth/code/'),
      headers: {'Content-Type': 'application/json', 'X-MasterSAT-Client': config.clientHeader},
      body: utf8.encode(jsonEncode({'challenge': challenge})),
      timeout: config.readTimeout,
    ));
    if (resp.status != 200) throw StateError('fixture server refused the code request (${resp.status})');
    final j = jsonDecode(utf8.decode(resp.body)) as Map;
    return j['code']! as String;
  };
}
