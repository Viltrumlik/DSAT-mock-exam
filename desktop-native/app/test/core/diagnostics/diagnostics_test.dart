// "Copy diagnostics": useful to support, and never a way to sign in as the student.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/clock/clock.dart';
import 'package:mastersat_app/core/diagnostics/diagnostics.dart';
import 'package:mastersat_app/core/store/unsent_work.dart';

import '../harness/app_harness.dart';

void main() {
  test('the event log masks anything that looks like a token and keeps the last N', () {
    final log = EventLog(capacity: 3, clock: ManualClock(DateTime.utc(2026, 10, 11, 9)));
    final jwt = fakeJwt(expires: DateTime.utc(2027));
    log.add('auth', 'refresh with $jwt failed');
    log.add('http', 'Authorization: Bearer abc.def.ghi rejected');
    log.add('a', '1');
    log.add('b', '2');
    expect(log.events, hasLength(3));
    expect(log.events.first.message, 'Authorization: [redacted] rejected');
    expect(jsonEncode(log.events.map((e) => e.toJson()).toList()), isNot(contains(jwt)));
  });

  test('the report has app, OS, session, home, unsent, update and clock sections', () {
    final now = DateTime.utc(2026, 10, 11, 9);
    final json = jsonDecode(diagnosticsJson(DiagnosticsInput(
      appVersion: '0.2.0',
      buildMode: 'release',
      apiOrigin: 'https://mastersat.uz',
      clientHeader: 'windows/0.2.0',
      nativeLibraryVersion: '0.2.0',
      signedIn: true,
      userId: 77,
      accessExpiresAt: now.add(const Duration(hours: 3)),
      nextRefreshAt: now.add(const Duration(hours: 2, minutes: 30)),
      homeFetchedAt: now,
      homeEtag: '"e"',
      midtermCount: 4,
      pastpaperCount: 6,
      online: true,
      unsent: const UnsentSummary({'exam outbox': 2}).toJson(),
      updateChannel: 'beta',
      updateState: 'up to date',
      serverClockOffset: const Duration(seconds: -3),
      events: const [],
      now: now,
    ))) as Map<String, Object?>;
    expect(json.keys, containsAll(['schema', 'generated_at', 'app', 'os', 'session', 'home', 'unsent', 'update', 'clock']));
    expect((json['app']! as Map)['client_header'], 'windows/0.2.0');
    expect((json['session']! as Map)['user_id'], 77);
    expect((json['unsent']! as Map)['total'], 2);
    expect((json['clock']! as Map)['server_offset_ms'], -3000);
  });

  test('UnsentWork asks every registered counter; a failing counter counts as unsent', () async {
    final u = UnsentWork();
    expect((await u.check()).isEmpty, isTrue);
    final off = u.register('outbox', () => 3);
    u.register('reports', () async => 0);
    u.register('broken', () => throw StateError('db closed'));
    final s = await u.check();
    expect(s.bySource, {'outbox': 3, 'broken': 1});
    expect(s.total, 4);
    off();
    expect((await u.check()).bySource.keys, ['broken']);
  });
}
