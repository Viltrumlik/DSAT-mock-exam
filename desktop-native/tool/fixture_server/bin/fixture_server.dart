// Runs the local v1 fixture server.
//
//   source desktop-native/tool/env.sh
//   cd desktop-native/tool/fixture_server && flutter pub get
//   dart run bin/fixture_server.dart --port 8765 [--latency-ms 150] [--access-ttl-minutes 180]
//                                    [--minimum-version 0.2.0] [--verbose]
//
// Then: flutter run -d macos --dart-define=MASTERSAT_API_BASE=http://127.0.0.1:8765
//
// Control (any HTTP client):
//   POST /__fixture__/offline?on=1|0        drop every /api request (the app sees no connection)
//   POST /__fixture__/expire-access         next call 401s, the app refreshes
//   POST /__fixture__/revoke                refresh refused too: the session ends
//   POST /__fixture__/update?mode=available|required|none|fixture
//   POST /__fixture__/minimum-version?v=0.3.0   426 for older clients ('' clears)
//   POST /__fixture__/latency?ms=800
//   POST /__fixture__/reset
//   GET  /__fixture__/state
import 'dart:io';

import 'package:mastersat_fixture_server/fixture_server.dart';

Future<void> main(List<String> args) async {
  String? opt(String name) {
    final i = args.indexOf('--$name');
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  }

  if (args.contains('--help') || args.contains('-h')) {
    stdout.writeln('usage: dart run bin/fixture_server.dart [--port 8765] [--latency-ms N] '
        '[--access-ttl-minutes N] [--minimum-version X.Y.Z] [--scoring-polls N] [--verbose]');
    return;
  }
  final server = FixtureServer(
    accessTtl: Duration(minutes: int.tryParse(opt('access-ttl-minutes') ?? '') ?? 180),
    minimumVersion: opt('minimum-version'),
    latency: Duration(milliseconds: int.tryParse(opt('latency-ms') ?? '') ?? 0),
    verbose: args.contains('--verbose'),
  );
  final polls = int.tryParse(opt('scoring-polls') ?? '');
  if (polls != null) server.api.scoringPolls = polls;
  final origin = await server.start(port: int.tryParse(opt('port') ?? '') ?? 8765);
  stdout.writeln('MasterSAT fixture server on $origin  (Ctrl+C to stop)');
  ProcessSignal.sigint.watch().listen((_) async {
    await server.close();
    exit(0);
  });
}
