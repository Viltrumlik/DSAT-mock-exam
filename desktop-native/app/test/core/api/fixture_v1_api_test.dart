// FixtureV1Api behaves like the v1 server for whole flows (and fails like it).
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';

void main() {
  late DateTime clock;
  late FixtureV1Api api;

  setUp(() {
    clock = DateTime.utc(2026, 10, 11, 9);
    api = FixtureV1Api(now: () => clock);
  });

  SyncRequest body(int moduleId, int seq, Map<int, String> answers, [List<int> flagged = const []]) =>
      SyncRequest(moduleId: moduleId, seq: seq, answers: answers, flagged: flagged);

  test('past paper: open → start → sync → submit M1 → submit M2 → result', () async {
    final bundle = await api.pastpaperOpen(52, const PastpaperOpenRequest(start: false));
    expect(bundle.attempt.state, AttemptState.notStarted);
    expect(bundle.modules.map((m) => m.id), [301, 302]);
    expect(bundle.modules.every((m) => m.questions != null), isTrue);
    expect(bundle.media, isNotEmpty);
    final id = bundle.attempt.id;

    final started = await api.pastpaperStart(id, idempotencyKey: IdempotencyKeys.start(id));
    expect(started.attempt.state, AttemptState.module1Active);
    expect(started.attempt.timing.remainingMs, 35 * 60000);

    clock = clock.add(const Duration(minutes: 5));
    final synced = await api.pastpaperSync(id, body(301, 3, {1001: 'B', 1002: '2', 1003: ''}, [1004]),
        idempotencyKey: IdempotencyKeys.sync(id, 301, 3));
    expect(synced.applied, isTrue);
    expect(synced.attempt.timing.remainingMs, 30 * 60000);
    expect(api.serverAnswers(id, 301), {1001: 'B', 1002: '2'});
    expect(api.serverFlags(id, 301), {1004});

    final m1 = await api.pastpaperSubmit(id, body(301, 9, {1001: 'B', 1002: '2', 1003: 'B', 1004: 'C'}),
        idempotencyKey: IdempotencyKeys.submit(id, 301));
    expect(m1.transitionedTo, AttemptState.module2Active);
    expect(m1.attempt.module!.id, 302);

    // A replay of the same key returns the stored outcome with a FRESH attempt.
    clock = clock.add(const Duration(seconds: 30));
    final replay = await api.pastpaperSubmit(id, body(301, 9, const {}), idempotencyKey: IdempotencyKeys.submit(id, 301));
    expect(replay.transitionedTo, AttemptState.module2Active);
    expect(replay.attempt.timing.remainingMs, 35 * 60000 - 30000);

    // A late sync for module 1 is not applied and changes nothing.
    final late = await api.pastpaperSync(id, body(301, 10, {1001: 'D'}), idempotencyKey: IdempotencyKeys.sync(id, 301, 10));
    expect(late.applied, isFalse);
    expect(late.reason, 'module_not_active');
    expect(api.serverAnswers(id, 301)[1001], 'B');

    final m2 = await api.pastpaperSubmit(id, body(302, 12, {1011: '7/2', 1012: 'A', 1013: 'A', 1014: '-3'}),
        idempotencyKey: IdempotencyKeys.submit(id, 302));
    expect(m2.transitionedTo, AttemptState.scoring);
    expect(m2.result!.pollAfterMs, 2000);

    final scoring = await api.pastpaperResult(id);
    expect(scoring.isScoring, isTrue);
    expect(scoring.pollAfterMs, 2000);

    final done = await api.pastpaperResult(id, have: {301: bundle.modules[0].contentHash});
    expect(done.isCompleted, isTrue);
    expect(done.totals!.questions, 10);
    expect(done.totals!.correct, 8);
    expect(done.content[301]!.questions, isNull, reason: 'have matched');
    expect(done.content[302]!.questions, hasLength(4));
    expect(done.score, inInclusiveRange(200, 800));

    final home = await api.home();
    final row = home.home!.pastpapers.firstWhere((p) => p.id == 52);
    expect(row.state.status, PastpaperStatus.completed);
    expect(row.history.first.attemptId, id);
  });

  test('past paper: resume keeps saved answers, `have` skips unchanged content, pause freezes time', () async {
    final first = await api.pastpaperOpen(51, const PastpaperOpenRequest(start: true));
    expect(first.attempt.id, 9124);
    expect(first.answers[311], {2001: 'B', 2002: 'A', 2004: 'B'});
    expect(first.flagged[311], [2003]);
    expect(first.annotations, hasLength(2));

    final have = {for (final m in first.modules) m.id: m.contentHash};
    final again = await api.pastpaperOpen(51, PastpaperOpenRequest(start: true, have: have));
    expect(again.attempt.id, 9124);
    expect(again.modules.every((m) => m.unchanged && m.questions == null), isTrue);

    final paused = await api.pastpaperPause(9124);
    expect(paused.attempt.timing.paused, isTrue);
    expect(paused.attempt.timing.deadlineAt, isNull);
    final frozen = paused.attempt.timing.remainingMs;
    clock = clock.add(const Duration(minutes: 10));
    final resumed = await api.pastpaperResume(9124);
    expect(resumed.attempt.timing.remainingMs, frozen);
    expect(resumed.attempt.timing.paused, isFalse);
  });

  test('home: ETag round trip gives 304', () async {
    final fresh = await api.home();
    expect(fresh.notModified, isFalse);
    expect(fresh.etag, startsWith('"sha256:'));
    final again = await api.home(ifNoneMatch: fresh.etag);
    expect(again.notModified, isTrue);
    expect(again.home, isNull);
  });

  test('midterm: prepare → code → challenge → session → open → sync → 409 → submit → offscreen → result', () async {
    final prepared = await api.midtermPrepare(14, const MidtermPrepareRequest());
    expect(prepared.requiresCode, isTrue);
    expect(prepared.codeVerified, isFalse);
    final id = prepared.attempt.id;

    await expectLater(
      api.midtermPrepare(14, const MidtermPrepareRequest(code: '000000')),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 403).having((e) => e.code, 'code', 'code_incorrect')),
    );
    final verified = await api.midtermPrepare(14, const MidtermPrepareRequest(code: fixtureMidtermCode));
    expect(verified.mayProceed, isTrue);

    // No token yet: content is refused.
    await expectLater(
      api.midtermOpen(id, const MidtermOpenRequest(), lockdownSession: ''),
      throwsA(isA<ApiError>().having((e) => e.isLockdownRefusal, 'lockdown', isTrue)),
    );

    final challenge = await api.midtermChallenge(id);
    final session = await api.midtermSession(
      id,
      LockdownSessionRequest(nonce: challenge.nonce, keyId: 'k', mac: 'ab', appVersion: '0.2.0', precheck: '{}'),
    );
    // The nonce is single-use.
    await expectLater(
      api.midtermSession(
          id, LockdownSessionRequest(nonce: challenge.nonce, keyId: 'k', mac: 'ab', appVersion: '0.2.0', precheck: '{}')),
      throwsA(isA<ApiError>().having((e) => e.code, 'code', 'desktop_challenge_invalid')),
    );
    final token = session.lockdownSession;

    final open = await api.midtermOpen(id, const MidtermOpenRequest(), lockdownSession: token);
    expect(open.attempt.state, AttemptState.module1Active);
    expect(open.modules.map((m) => m.id), [401], reason: 'live module only');
    expect(open.media.first.expiresAt.difference(clock), const Duration(minutes: 15));

    clock = clock.add(const Duration(minutes: 10));
    final synced = await api.midtermSync(id, body(401, 2, {3001: 'C'}),
        lockdownSession: token, idempotencyKey: IdempotencyKeys.sync(id, 401, 2));
    expect(synced.applied, isTrue);

    // Early hand-in: 409 module_not_expired, never cached.
    try {
      await api.midtermSubmit(id, body(401, 3, {3001: 'C', 3002: '6'}),
          lockdownSession: token, idempotencyKey: IdempotencyKeys.submit(id, 401));
      fail('expected 409');
    } on ApiError catch (e) {
      expect(e.status, 409);
      expect(e.code, 'module_not_expired');
      expect(e.retryAfterMs, 25 * 60000);
    }

    final off = await api.midtermOffscreen(
      id,
      OffscreenRequest(eventId: 'e1', occurredAt: clock, awayMs: 4000),
      lockdownSession: token,
      idempotencyKey: IdempotencyKeys.offscreen(id, 'e1'),
    );
    expect(off.violations, 1);
    // Same event again: not a second strike.
    final offReplay = await api.midtermOffscreen(
      id,
      OffscreenRequest(eventId: 'e1', occurredAt: clock, awayMs: 4000),
      lockdownSession: token,
      idempotencyKey: IdempotencyKeys.offscreen(id, 'e1'),
    );
    expect(offReplay.violations, 1);

    clock = clock.add(const Duration(minutes: 25, milliseconds: 750));
    final m1 = await api.midtermSubmit(id, body(401, 3, {3001: 'C', 3002: '6'}),
        lockdownSession: token, idempotencyKey: IdempotencyKeys.submit(id, 401));
    expect(m1.transitionedTo, AttemptState.module2Active);
    expect(m1.nextModule!.id, 402);
    expect(m1.nextModule!.questions, hasLength(3));
    expect(m1.media, isNotEmpty);

    // Late answers for module 1 are banked within 300 s of its deadline …
    clock = clock.add(const Duration(seconds: 200));
    final banked = await api.midtermSync(id, body(401, 4, {3004: 'B'}),
        lockdownSession: token, idempotencyKey: IdempotencyKeys.sync(id, 401, 4));
    expect(banked.applied, isTrue);
    // … and dropped after.
    clock = clock.add(const Duration(seconds: 200));
    final dropped = await api.midtermSync(id, body(401, 5, {3004: 'A'}),
        lockdownSession: token, idempotencyKey: IdempotencyKeys.sync(id, 401, 5));
    expect(dropped.applied, isFalse);
    expect(dropped.reason, 'late');

    clock = clock.add(const Duration(minutes: 35));
    final m2 = await api.midtermSubmit(id, body(402, 6, {3011: 'B'}),
        lockdownSession: token, idempotencyKey: IdempotencyKeys.submit(id, 402));
    expect(m2.transitionedTo, AttemptState.scoring);
    expect((await api.midtermResult(id)).state, AttemptState.scoring);
    final result = await api.midtermResult(id);
    expect(result.isCompleted, isTrue);
    expect(result.released, isTrue);
    expect(result.totalScore, isNotNull);
  });

  test('midterm: the third off-screen strike ends the sitting', () async {
    final p = await api.midtermPrepare(14, const MidtermPrepareRequest(code: fixtureMidtermCode));
    final c = await api.midtermChallenge(p.attempt.id);
    final s = await api.midtermSession(p.attempt.id,
        LockdownSessionRequest(nonce: c.nonce, keyId: 'k', mac: 'ab', appVersion: '0.2.0', precheck: '{}'));
    await api.midtermOpen(p.attempt.id, const MidtermOpenRequest(), lockdownSession: s.lockdownSession);
    late OffscreenOutcome last;
    for (var i = 0; i < 3; i++) {
      last = await api.midtermOffscreen(p.attempt.id, OffscreenRequest(eventId: 'e$i', occurredAt: clock, awayMs: 3500),
          lockdownSession: s.lockdownSession, idempotencyKey: IdempotencyKeys.offscreen(p.attempt.id, 'e$i'));
    }
    expect(last.terminated, isTrue);
    expect(last.graceSeconds, 0);
    expect(last.attempt.state, AttemptState.scoring);
    expect(last.attempt.midterm!.terminatedReason, 'OFFSCREEN');
  });

  test('offline and injected failures raise typed errors', () async {
    api.offline = true;
    await expectLater(api.home(), throwsA(isA<NetworkError>()));
    api.offline = false;
    api.failNext(const UpdateRequired(updateUrl: 'https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe'));
    await expectLater(api.home(), throwsA(isA<UpdateRequired>()));
    await expectLater(api.pastpaperOpen(999, const PastpaperOpenRequest(start: false)),
        throwsA(isA<ApiError>().having((e) => e.code, 'code', 'not_visible')));
    expect(const NetworkError('x').isTransient, isTrue);
  });

  test('auth refresh rotates; a spent refresh is refused', () async {
    final t = await api.authExchange(const AuthExchangeRequest(code: 'c', verifier: 'v'));
    final r1 = await api.authRefresh(RefreshRequest(refresh: t.refresh));
    expect(r1.refresh, isNot(t.refresh));
    await expectLater(api.authRefresh(RefreshRequest(refresh: t.refresh)),
        throwsA(isA<ApiError>().having((e) => e.isUnauthorized, '401', isTrue)));
  });

  test('question reports dedupe and replay by key', () async {
    const r = QuestionReportRequest(questionId: 2002, category: ReportCategory.typoUnclear, message: 'x');
    final a = await api.questionReport(r, idempotencyKey: IdempotencyKeys.report('u1'));
    final b = await api.questionReport(r, idempotencyKey: IdempotencyKeys.report('u2'));
    final c = await api.questionReport(r, idempotencyKey: IdempotencyKeys.report('u1'));
    expect(a.deduped, isFalse);
    expect(b.deduped, isTrue);
    expect(b.id, a.id);
    expect(c.id, a.id);
  });

  test('paths and keys follow the contract', () {
    expect(V1Paths.pastpaperResult(9123, {301: 'sha256:ab'}),
        '/api/desktop/v1/pastpapers/attempts/9123/result?have=301%3Asha256%3Aab');
    expect(IdempotencyKeys.sync(9123, 301, 12), 'sync.9123.301.12');
    expect(IdempotencyKeys.offscreen(5521, 'u'), 'off.5521.u');
    expect(V1Headers.clientValue('0.2.0'), 'windows/0.2.0');
    expect(V1Paths.media(AttemptKind.midterm, 5521), '/api/desktop/v1/attempts/midterm/5521/media');
  });
}
