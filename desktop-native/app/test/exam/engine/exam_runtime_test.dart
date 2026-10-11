// The per-user runtime on a REAL file database in the production configuration (SQLite on
// drift's background isolate, real time): one file per student, WAL + synchronous=FULL, sealed
// values, a click on disk within 30 ms, and the start-up drain of what a closed app left behind.
import 'dart:io';
import 'dart:typed_data';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/exam/engine/exam_runtime.dart';
import 'package:mastersat_app/exam/engine/exam_store.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';

import 'support/engine_harness.dart' show P52;

Future<Uint8List> fixtureFetch(Uri url) async {
  final key = Uri.decodeComponent(url.path.replaceFirst('/mastersat-media/', ''));
  final bytes = FixtureV1Api.fixtureMedia(key);
  if (bytes == null) throw StateError('no fixture image $key');
  return bytes;
}

Future<void> eventually(bool Function() ok, {Duration within = const Duration(seconds: 10)}) async {
  final sw = Stopwatch()..start();
  while (!ok()) {
    if (sw.elapsed > within) throw TimeoutException('condition not met within $within');
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}

class TimeoutException implements Exception {
  TimeoutException(this.message);
  final String message;
  @override
  String toString() => message;
}

void main() {
  late Directory dir;
  late FakeNativeBridge native;
  late FixtureV1Api api;

  setUp(() {
    driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
    dir = Directory.systemTemp.createTempSync('exam-runtime-test');
    native = FakeNativeBridge();
    api = FixtureV1Api();
  });

  tearDown(() {
    try {
      dir.deleteSync(recursive: true);
    } on FileSystemException {
      // best effort
    }
  });

  ExamRuntime open(int user) =>
      ExamRuntime.open(dataDir: dir, userId: user, api: api, native: native, fetchMedia: fixtureFetch);

  test('one database per student, WAL + synchronous=FULL + foreign keys', () async {
    final a = open(77);
    final b = open(78);
    expect(await a.store.pragmas(), {'journal_mode': 'wal', 'synchronous': 2, 'foreign_keys': 1});
    await a.store.record(const JournalEntry(
        attemptId: 1, seq: 1, moduleId: 10, qid: 100, op: JournalOp.answer, value: 'B', monoMs: 0, wallMs: 0));
    expect(await a.store.answerState(1, 10), hasLength(1));
    expect(await b.store.answerState(1, 10), isEmpty, reason: "one student never sees another's work");
    await a.close();
    await b.close();
    expect(File('${dir.path}/exam-77.db').existsSync(), isTrue);
    expect(File('${dir.path}/exam-78.db').existsSync(), isTrue);
    expect(() => a.pastpaper(52, studentName: 'x'), throwsStateError);
  });

  test('a click is on disk within 30 ms (p95 over 200 writes, production configuration)', () async {
    final rt = open(77);
    await rt.store.pragmas(); // open the connection first
    final times = <int>[];
    for (var i = 1; i <= 200; i++) {
      final sw = Stopwatch()..start();
      await rt.store.record(JournalEntry(
        attemptId: 9,
        seq: i,
        moduleId: 301,
        qid: 1000 + i % 6,
        op: i % 5 == 0 ? JournalOp.flag : JournalOp.answer,
        value: i % 5 == 0 ? null : 'ABCD'[i % 4],
        monoMs: i,
        wallMs: i,
      ));
      times.add(sw.elapsedMicroseconds);
    }
    times.sort();
    final p95 = Duration(microseconds: times[(times.length * 0.95).floor() - 1]);
    // ignore: avoid_print
    print('journal write: median ${times[100] / 1000} ms, p95 ${p95.inMicroseconds / 1000} ms');
    expect(p95, lessThanOrEqualTo(const Duration(milliseconds: 30)));
    await rt.close();
  });

  test('answers are sealed on disk (no plaintext answer in the file)', () async {
    // The fake bridge's seal is the identity; this one scrambles, as DPAPI would.
    native = _XorSealBridge();
    final rt = open(77);
    const marker = 'PLAINTEXT-ANSWER-7781';
    await rt.store.record(const JournalEntry(
        attemptId: 9, seq: 1, moduleId: 301, qid: 1002, op: JournalOp.answer, value: marker, monoMs: 0, wallMs: 0));
    await rt.close();
    final bytes = [
      ...File('${dir.path}/exam-77.db').readAsBytesSync(),
      if (File('${dir.path}/exam-77.db-wal').existsSync()) ...File('${dir.path}/exam-77.db-wal').readAsBytesSync(),
    ];
    expect(String.fromCharCodes(bytes).contains(marker), isFalse);
  });

  test('the app closed with a sync unsent: the next start sends it', () async {
    var rt = open(77);
    var e = rt.pastpaper(52, studentName: 'Aziza Karimova');
    await e.open();
    await e.start();
    await eventually(() => api.stateOf(P52.attempt) != null && api.stateOf(P52.attempt)!.isActive);
    api.offline = true;
    e.select(1001, 'B');
    e.toggleFlag(1003);
    await e.closeGracefully(); // the sync is queued but cannot go
    e.dispose();
    expect(await rt.unsentCount(), greaterThan(0), reason: 'sign-out would be blocked');
    await rt.close();

    api.offline = false;
    rt = open(77);
    expect(await rt.resumePendingSends(), 1);
    await eventually(() => api.serverAnswers(P52.attempt, P52.m1)[1001] == 'B');
    expect(api.serverFlags(P52.attempt, P52.m1), {1003});
    for (var i = 0; i < 250 && await rt.unsentCount() > 0; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    expect(await rt.unsentCount(), 0);
    // The sitting itself reopens from this computer's copy.
    e = rt.pastpaper(52, studentName: 'Aziza Karimova');
    await e.open();
    expect(e.answerFor(1001), 'B');
    e.dispose();
    await rt.close();
  }, timeout: const Timeout(Duration(seconds: 60)));
}

class _XorSealBridge extends FakeNativeBridge {
  static Uint8List _x(Uint8List b) => Uint8List.fromList([for (final v in b) v ^ 0x5A]);

  @override
  Uint8List seal(Uint8List plain) => _x(plain);

  @override
  Uint8List open(Uint8List sealed) => _x(sealed);
}
