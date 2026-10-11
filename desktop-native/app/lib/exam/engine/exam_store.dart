// The engine's own SQLite database, one per signed-in user: `exam-<user_id>.db` in the app's
// data folder (%LOCALAPPDATA%\MasterSAT on Windows). design_data_server.md §1.1–§1.2.
//
//  * WAL, `synchronous=FULL` (a committed answer survives a power cut), `foreign_keys=ON`.
//  * drift without code generation: a [GeneratedDatabase] with no generated tables, raw SQL
//    through `customStatement`/`customSelect`. The schema is small and stable, and raw SQL
//    keeps every statement visible next to the rule it implements.
//  * Answer values, outbox payloads, past-paper content and notes are SEALED through
//    [NativeBridge.seal] (AES-256-GCM, DPAPI-wrapped key). Midterm content is never written
//    here at all (memory only).
//  * Production opens it on drift's background isolate; tests open it on the test isolate so
//    fake_async drives every write.
import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:sqlite3/sqlite3.dart' as sqlite;

import '../../core/models/models.dart';
import '../../native/native_bridge.dart';

/// `journal.op`.
enum JournalOp {
  answer,
  clear,
  flag,
  unflag,
  submit,
  deadline,
  offscreen;

  static JournalOp fromName(String s) => values.firstWhere((v) => v.name == s);
}

/// One journal row: every select/clear/flag the student made, in order.
class JournalEntry {
  const JournalEntry({
    required this.attemptId,
    required this.seq,
    required this.moduleId,
    this.qid,
    required this.op,
    this.value,
    required this.monoMs,
    required this.wallMs,
  });

  final int attemptId;
  final int seq;
  final int moduleId;
  final int? qid;
  final JournalOp op;
  final String? value;
  final int monoMs;
  final int wallMs;

  @override
  String toString() => 'JournalEntry($attemptId#$seq m$moduleId q$qid ${op.name} ${value ?? ''})';
}

/// One question's current state in `answer_state`.
class AnswerCell {
  const AnswerCell({this.value, this.flagged = false, this.updatedSeq = 0});

  final String? value;
  final bool flagged;
  final int updatedSeq;
}

/// The local `attempt` row.
class AttemptRecord {
  const AttemptRecord({
    required this.id,
    required this.kind,
    required this.refId,
    required this.serverState,
    this.serverVersion = 0,
    required this.moduleIds,
    this.activeModuleId,
    required this.localPhase,
    this.contentHashes = const {},
    this.ackedSeq = const {},
    this.remainingMsAtTick,
    this.tickWallMs,
    this.paused = false,
    this.terminalAt,
    this.test,
    this.moduleMeta = const [],
    this.updatedWallMs = 0,
  });

  final int id;
  final AttemptKind kind;
  final int refId;
  final AttemptState serverState;
  final int serverVersion;
  final List<int> moduleIds;
  final int? activeModuleId;

  /// `welcome` | `running` | `review` | `transition` | `submitting` | `done`.
  final String localPhase;
  final Map<int, String> contentHashes;

  /// Per module: the highest journal seq the server is known to hold.
  final Map<int, int> ackedSeq;
  final int? remainingMsAtTick;
  final int? tickWallMs;
  final bool paused;
  final int? terminalAt;

  /// Past papers only (sealed in the row).
  final TestInfo? test;

  /// Module metadata (id, order, time limit, hash, deferred) WITHOUT questions, so a reopen
  /// can rebuild the modules from the content cache with no network.
  final List<ModuleContent> moduleMeta;
  final int updatedWallMs;

  bool get finished => terminalAt != null;
}

enum OutboxLane {
  /// Answers: start, sync, submit. One request in flight per attempt.
  exam,

  /// Annotations and question reports — never blocks the exam lane.
  low,

  /// Off-screen events: never queued behind a sync that is hanging on a slow network.
  urgent,
}

enum OutboxState { pending, inflight, done, dead, parked }

enum OutboxKind { start, sync, submit, offscreen, annotation, report }

/// One queued request. The payload is frozen when enqueued — one key, one body, forever.
class OutboxItem {
  const OutboxItem({
    this.id = 0,
    required this.attemptId,
    required this.attemptKind,
    required this.lane,
    required this.kind,
    required this.idemKey,
    required this.payload,
    this.coversModule,
    this.coversSeq,
    this.state = OutboxState.pending,
    this.tries = 0,
    this.serverFailures = 0,
    this.nextAtMs = 0,
    this.lastError,
    this.createdWallMs = 0,
  });

  final int id;
  final int attemptId;
  final AttemptKind attemptKind;
  final OutboxLane lane;
  final OutboxKind kind;
  final String idemKey;
  final Map<String, Object?> payload;
  final int? coversModule;
  final int? coversSeq;
  final OutboxState state;
  final int tries;

  /// Consecutive server-answered failures (5xx); network errors do not count.
  final int serverFailures;

  /// Wall-clock ms before which the item is not sent (backoff / `retry_after_ms`).
  final int nextAtMs;
  final String? lastError;
  final int createdWallMs;

  @override
  String toString() => 'OutboxItem(#$id ${kind.name} $idemKey ${state.name} tries=$tries)';
}

/// A cached image.
class MediaRow {
  const MediaRow({required this.key, required this.path, required this.bytes, required this.contentType});
  final String key;
  final String path;
  final int bytes;
  final String contentType;
}

class _ExamDb extends GeneratedDatabase {
  _ExamDb(super.executor);

  @override
  Iterable<TableInfo<Table, Object?>> get allTables => const [];

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) async {
          for (final ddl in ExamStore.schema) {
            await customStatement(ddl);
          }
        },
        beforeOpen: (details) async {
          // Crash recovery: anything that was in flight when the process died is pending again.
          await customStatement("UPDATE outbox SET state = 'pending' WHERE state = 'inflight'");
        },
      );
}

/// The pragmas every connection gets (top-level so the background isolate can run it).
void examStorePragmas(sqlite.Database db) {
  db.execute('PRAGMA journal_mode = WAL');
  db.execute('PRAGMA synchronous = FULL');
  db.execute('PRAGMA foreign_keys = ON');
}

class ExamStore {
  ExamStore._(this._db, this._native, this.mediaDir);

  /// Opens (creating if needed) `exam-<userId>.db` under [dataDir], with images under
  /// `dataDir/media`. [background] puts SQLite on drift's own isolate (production).
  static ExamStore open({
    required Directory dataDir,
    required int userId,
    required NativeBridge native,
    bool background = true,
  }) {
    dataDir.createSync(recursive: true);
    final file = File('${dataDir.path}${Platform.pathSeparator}${fileNameFor(userId)}');
    final executor = background
        ? NativeDatabase.createInBackground(file, setup: examStorePragmas)
        : NativeDatabase(file, setup: examStorePragmas);
    final media = Directory('${dataDir.path}${Platform.pathSeparator}media')..createSync(recursive: true);
    return ExamStore._(_ExamDb(executor), native, media);
  }

  /// For tests: any executor (e.g. `NativeDatabase.memory()`).
  factory ExamStore.withExecutor(QueryExecutor executor, {required NativeBridge native, required Directory mediaDir}) {
    mediaDir.createSync(recursive: true);
    return ExamStore._(_ExamDb(executor), native, mediaDir);
  }

  static String fileNameFor(int userId) => 'exam-$userId.db';

  final _ExamDb _db;
  final NativeBridge _native;

  /// Sealed image files live here, named `sha256(key)`.
  final Directory mediaDir;

  static const List<String> schema = [
    '''CREATE TABLE attempt(
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('pastpaper','midterm')),
      ref_id INTEGER NOT NULL,
      server_state TEXT NOT NULL,
      server_version INTEGER NOT NULL DEFAULT 0,
      module_ids TEXT NOT NULL,
      active_module_id INTEGER,
      local_phase TEXT NOT NULL,
      content_hashes TEXT NOT NULL DEFAULT '{}',
      acked_seq TEXT NOT NULL DEFAULT '{}',
      remaining_ms_at_tick INTEGER,
      tick_wall_ms INTEGER,
      paused INTEGER NOT NULL DEFAULT 0,
      terminal_at INTEGER,
      test BLOB,
      module_meta TEXT NOT NULL DEFAULT '[]',
      updated_wall_ms INTEGER NOT NULL DEFAULT 0)''',
    'CREATE INDEX attempt_by_ref ON attempt(kind, ref_id)',
    '''CREATE TABLE journal(
      attempt_id INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      module_id INTEGER NOT NULL,
      qid INTEGER,
      op TEXT NOT NULL CHECK(op IN ('answer','clear','flag','unflag','submit','deadline','offscreen')),
      value BLOB,
      mono_ms INTEGER NOT NULL,
      wall_ms INTEGER NOT NULL,
      PRIMARY KEY(attempt_id, seq))''',
    '''CREATE TABLE answer_state(
      attempt_id INTEGER NOT NULL,
      module_id INTEGER NOT NULL,
      qid INTEGER NOT NULL,
      value BLOB,
      flagged INTEGER NOT NULL DEFAULT 0,
      updated_seq INTEGER NOT NULL,
      PRIMARY KEY(attempt_id, module_id, qid))''',
    '''CREATE TABLE outbox(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id INTEGER NOT NULL,
      attempt_kind TEXT NOT NULL,
      lane TEXT NOT NULL CHECK(lane IN ('exam','low','urgent')),
      kind TEXT NOT NULL,
      idem_key TEXT NOT NULL UNIQUE,
      payload BLOB NOT NULL,
      covers_module INTEGER,
      covers_seq INTEGER,
      state TEXT NOT NULL CHECK(state IN ('pending','inflight','done','dead','parked')),
      tries INTEGER NOT NULL DEFAULT 0,
      server_failures INTEGER NOT NULL DEFAULT 0,
      next_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_wall_ms INTEGER NOT NULL DEFAULT 0)''',
    'CREATE INDEX outbox_by_lane ON outbox(attempt_id, lane, state)',
    '''CREATE TABLE content(
      hash TEXT PRIMARY KEY,
      module_id INTEGER NOT NULL,
      blob BLOB NOT NULL,
      last_used INTEGER NOT NULL)''',
    '''CREATE TABLE media(
      key TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      last_used INTEGER NOT NULL)''',
    '''CREATE TABLE annotation(
      attempt_ref TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      container TEXT NOT NULL,
      data TEXT NOT NULL,
      dirty INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(attempt_ref, target_id, container))''',
    'CREATE TABLE notes(attempt_ref TEXT PRIMARY KEY, text BLOB NOT NULL)',
    'CREATE TABLE desmos_state(attempt_ref TEXT PRIMARY KEY, state TEXT NOT NULL)',
    'CREATE TABLE view_state(attempt_ref TEXT PRIMARY KEY, zoom REAL NOT NULL, split REAL NOT NULL, highlighter INTEGER NOT NULL)',
    'CREATE TABLE receipt(attempt_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, submitted_wall_ms INTEGER NOT NULL)',
  ];

  // ---------------------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------------------

  Future<T> transaction<T>(Future<T> Function() body) => _db.transaction(body);

  Future<void> close() => _db.close();

  /// The connection's durability settings (diagnostics, tests): `journal_mode`, `synchronous`
  /// (2 = FULL) and `foreign_keys`.
  Future<Map<String, Object?>> pragmas() async {
    Object? one(List<QueryRow> rows) => rows.isEmpty ? null : rows.first.data.values.first;
    return {
      'journal_mode': one(await _select('PRAGMA journal_mode')),
      'synchronous': one(await _select('PRAGMA synchronous')),
      'foreign_keys': one(await _select('PRAGMA foreign_keys')),
    };
  }

  Uint8List _seal(String s) => _native.seal(Uint8List.fromList(utf8.encode(s)));
  String _unseal(Uint8List b) => utf8.decode(_native.open(b));

  static Variable<Object> _v(Object? x) {
    if (x == null) return const Variable<Object>(null);
    if (x is bool) return Variable<int>(x ? 1 : 0);
    if (x is int) return Variable<int>(x);
    if (x is double) return Variable<double>(x);
    if (x is String) return Variable<String>(x);
    if (x is Uint8List) return Variable<Uint8List>(x);
    throw ArgumentError('Unsupported SQL value ${x.runtimeType}');
  }

  Future<List<QueryRow>> _select(String sql, [List<Object?> args = const []]) =>
      _db.customSelect(sql, variables: [for (final a in args) _v(a)]).get();

  Future<int> _update(String sql, [List<Object?> args = const []]) =>
      _db.customUpdate(sql, variables: [for (final a in args) _v(a)]);

  Future<int> _insert(String sql, [List<Object?> args = const []]) =>
      _db.customInsert(sql, variables: [for (final a in args) _v(a)]);

  static Map<int, String> _intStringMap(String json) =>
      {for (final e in (jsonDecode(json) as Map).entries) int.parse(e.key as String): e.value as String};

  static Map<int, int> _intIntMap(String json) =>
      {for (final e in (jsonDecode(json) as Map).entries) int.parse(e.key as String): (e.value as num).toInt()};

  // ---------------------------------------------------------------------------------------
  // attempt
  // ---------------------------------------------------------------------------------------

  /// Inserts the row, or refreshes its identity fields (kind, ref, modules, test) — never
  /// the fields the outbox and the engine move independently.
  Future<void> upsertAttempt(AttemptRecord r) async {
    await _insert(
      '''INSERT INTO attempt(id, kind, ref_id, server_state, server_version, module_ids, active_module_id,
           local_phase, content_hashes, acked_seq, remaining_ms_at_tick, tick_wall_ms, paused, terminal_at, test,
           module_meta, updated_wall_ms)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, ref_id = excluded.ref_id,
           module_ids = excluded.module_ids, test = COALESCE(excluded.test, attempt.test),
           module_meta = CASE WHEN excluded.module_meta = '[]' THEN attempt.module_meta ELSE excluded.module_meta END,
           updated_wall_ms = excluded.updated_wall_ms''',
      [
        r.id,
        r.kind.wire,
        r.refId,
        r.serverState.wire,
        r.serverVersion,
        jsonEncode(r.moduleIds),
        r.activeModuleId,
        r.localPhase,
        jsonEncode(stringKeys(r.contentHashes)),
        jsonEncode(stringKeys(r.ackedSeq)),
        r.remainingMsAtTick,
        r.tickWallMs,
        r.paused,
        r.terminalAt,
        r.test == null ? null : _seal(jsonEncode(r.test!.toJson())),
        jsonEncode([for (final m in r.moduleMeta) _metaJson(m)]),
        r.updatedWallMs,
      ],
    );
  }

  AttemptRecord _attemptFrom(QueryRow row) {
    final testBlob = row.readNullable<Uint8List>('test');
    return AttemptRecord(
      id: row.read<int>('id'),
      kind: AttemptKind.fromWire(row.read<String>('kind')),
      refId: row.read<int>('ref_id'),
      serverState: AttemptState.fromWire(row.read<String>('server_state')),
      serverVersion: row.read<int>('server_version'),
      moduleIds: [for (final v in jsonDecode(row.read<String>('module_ids')) as List) (v as num).toInt()],
      activeModuleId: row.readNullable<int>('active_module_id'),
      localPhase: row.read<String>('local_phase'),
      contentHashes: _intStringMap(row.read<String>('content_hashes')),
      ackedSeq: _intIntMap(row.read<String>('acked_seq')),
      remainingMsAtTick: row.readNullable<int>('remaining_ms_at_tick'),
      tickWallMs: row.readNullable<int>('tick_wall_ms'),
      paused: row.read<int>('paused') != 0,
      terminalAt: row.readNullable<int>('terminal_at'),
      test: testBlob == null ? null : TestInfo.fromJson(JsonReader.of(jsonDecode(_unseal(testBlob)))),
      moduleMeta: [
        for (final m in jsonDecode(row.read<String>('module_meta')) as List) ModuleContent.fromJson(JsonReader.of(m)),
      ],
      updatedWallMs: row.read<int>('updated_wall_ms'),
    );
  }

  static Map<String, Object?> _metaJson(ModuleContent m) => {
        'id': m.id,
        'order': m.order,
        'time_limit_minutes': m.timeLimitMinutes,
        'question_count': m.questionCount,
        'content_hash': m.contentHash,
        'unchanged': false,
        'deferred': m.deferred,
        'questions': null,
      };

  Future<void> setModuleMeta(int id, List<ModuleContent> meta) => _update(
      'UPDATE attempt SET module_meta = ? WHERE id = ?', [jsonEncode([for (final m in meta) _metaJson(m)]), id]);

  Future<AttemptRecord?> loadAttempt(int id) async {
    final rows = await _select('SELECT * FROM attempt WHERE id = ?', [id]);
    return rows.isEmpty ? null : _attemptFrom(rows.single);
  }

  /// The newest unfinished local attempt for a paper / midterm.
  Future<AttemptRecord?> findUnfinished(AttemptKind kind, int refId) async {
    final rows = await _select(
        'SELECT * FROM attempt WHERE kind = ? AND ref_id = ? AND terminal_at IS NULL ORDER BY id DESC LIMIT 1',
        [kind.wire, refId]);
    return rows.isEmpty ? null : _attemptFrom(rows.single);
  }

  /// Every unfinished local attempt (Home overlays them; the drainer sends their items).
  Future<List<AttemptRecord>> unfinishedAttempts() async =>
      [for (final r in await _select('SELECT * FROM attempt WHERE terminal_at IS NULL ORDER BY id')) _attemptFrom(r)];

  Future<void> setPhase(int id, String phase, {int? activeModuleId}) => _update(
      'UPDATE attempt SET local_phase = ?, active_module_id = COALESCE(?, active_module_id) WHERE id = ?',
      [phase, activeModuleId, id]);

  /// Forward-only by version (a reply that left the server earlier never rolls it back).
  Future<void> setServerState(int id, AttemptState state, int version) => _update(
      'UPDATE attempt SET server_state = ?, server_version = ? WHERE id = ? AND server_version <= ?',
      [state.wire, version, id, version]);

  Future<void> setAcked(int id, int moduleId, int seq) async {
    await transaction(() async {
      final rows = await _select('SELECT acked_seq FROM attempt WHERE id = ?', [id]);
      if (rows.isEmpty) return;
      final acked = _intIntMap(rows.single.read<String>('acked_seq'));
      if ((acked[moduleId] ?? -1) >= seq) return;
      acked[moduleId] = seq;
      await _update('UPDATE attempt SET acked_seq = ? WHERE id = ?', [jsonEncode(stringKeys(acked)), id]);
    });
  }

  Future<void> setTick(int id, {required int remainingMs, required int wallMs, required bool paused}) => _update(
      'UPDATE attempt SET remaining_ms_at_tick = ?, tick_wall_ms = ?, paused = ? WHERE id = ?',
      [remainingMs, wallMs, paused, id]);

  Future<void> setContentHashes(int id, Map<int, String> hashes) =>
      _update('UPDATE attempt SET content_hashes = ? WHERE id = ?', [jsonEncode(stringKeys(hashes)), id]);

  Future<void> setModuleIds(int id, List<int> moduleIds) =>
      _update('UPDATE attempt SET module_ids = ? WHERE id = ?', [jsonEncode(moduleIds), id]);

  Future<void> setTerminal(int id, int wallMs) =>
      _update('UPDATE attempt SET terminal_at = COALESCE(terminal_at, ?), local_phase = ? WHERE id = ?',
          [wallMs, 'done', id]);

  // ---------------------------------------------------------------------------------------
  // journal + answer_state (one transaction per click)
  // ---------------------------------------------------------------------------------------

  /// Appends [e] and updates `answer_state` in the SAME transaction (design §1.4).
  Future<void> record(JournalEntry e) => transaction(() async {
        await _insert(
          'INSERT INTO journal(attempt_id, seq, module_id, qid, op, value, mono_ms, wall_ms) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
          [e.attemptId, e.seq, e.moduleId, e.qid, e.op.name, e.value == null ? null : _seal(e.value!), e.monoMs, e.wallMs],
        );
        final qid = e.qid;
        if (qid == null) return;
        switch (e.op) {
          case JournalOp.answer:
          case JournalOp.clear:
            final value = e.op == JournalOp.answer ? e.value : null;
            await _insert(
              '''INSERT INTO answer_state(attempt_id, module_id, qid, value, flagged, updated_seq) VALUES(?, ?, ?, ?, 0, ?)
                 ON CONFLICT(attempt_id, module_id, qid) DO UPDATE SET value = excluded.value, updated_seq = excluded.updated_seq''',
              [e.attemptId, e.moduleId, qid, value == null ? null : _seal(value), e.seq],
            );
          case JournalOp.flag:
          case JournalOp.unflag:
            await _insert(
              '''INSERT INTO answer_state(attempt_id, module_id, qid, value, flagged, updated_seq) VALUES(?, ?, ?, NULL, ?, ?)
                 ON CONFLICT(attempt_id, module_id, qid) DO UPDATE SET flagged = excluded.flagged, updated_seq = excluded.updated_seq''',
              [e.attemptId, e.moduleId, qid, e.op == JournalOp.flag, e.seq],
            );
          case JournalOp.submit:
          case JournalOp.deadline:
          case JournalOp.offscreen:
            break;
        }
      });

  /// Replaces a module's `answer_state` with a reconciled map (server ⊕ newer local journal).
  /// The journal is untouched.
  Future<void> replaceModuleState(int attemptId, int moduleId, Map<int, String> answers, Set<int> flagged,
          {required int seq}) =>
      transaction(() async {
        await _update('DELETE FROM answer_state WHERE attempt_id = ? AND module_id = ?', [attemptId, moduleId]);
        final qids = {...answers.keys, ...flagged};
        for (final q in qids) {
          final v = answers[q];
          await _insert(
            'INSERT INTO answer_state(attempt_id, module_id, qid, value, flagged, updated_seq) VALUES(?, ?, ?, ?, ?, ?)',
            [attemptId, moduleId, q, v == null || v.isEmpty ? null : _seal(v), flagged.contains(q), seq],
          );
        }
      });

  Future<Map<int, AnswerCell>> answerState(int attemptId, int moduleId) async {
    final rows =
        await _select('SELECT * FROM answer_state WHERE attempt_id = ? AND module_id = ?', [attemptId, moduleId]);
    return {
      for (final r in rows)
        r.read<int>('qid'): AnswerCell(
          value: r.readNullable<Uint8List>('value')?.let(_unseal),
          flagged: r.read<int>('flagged') != 0,
          updatedSeq: r.read<int>('updated_seq'),
        ),
    };
  }

  Future<int> maxSeq(int attemptId) async {
    final rows = await _select('SELECT COALESCE(MAX(seq), 0) AS m FROM journal WHERE attempt_id = ?', [attemptId]);
    return rows.single.read<int>('m');
  }

  JournalEntry _journalFrom(QueryRow r) => JournalEntry(
        attemptId: r.read<int>('attempt_id'),
        seq: r.read<int>('seq'),
        moduleId: r.read<int>('module_id'),
        qid: r.readNullable<int>('qid'),
        op: JournalOp.fromName(r.read<String>('op')),
        value: r.readNullable<Uint8List>('value')?.let(_unseal),
        monoMs: r.read<int>('mono_ms'),
        wallMs: r.read<int>('wall_ms'),
      );

  /// Journal rows for a module with `seq > afterSeq`, in order.
  Future<List<JournalEntry>> journalAfter(int attemptId, int moduleId, int afterSeq) async => [
        for (final r in await _select(
            'SELECT * FROM journal WHERE attempt_id = ? AND module_id = ? AND seq > ? ORDER BY seq',
            [attemptId, moduleId, afterSeq]))
          _journalFrom(r),
      ];

  /// Modules this computer has handed in (journal `submit` rows).
  Future<Set<int>> handedInModules(int attemptId) async => {
        for (final r in await _select(
            "SELECT DISTINCT module_id FROM journal WHERE attempt_id = ? AND op = 'submit'", [attemptId]))
          r.read<int>('module_id'),
      };

  Future<List<JournalEntry>> journal(int attemptId) async => [
        for (final r in await _select('SELECT * FROM journal WHERE attempt_id = ? ORDER BY seq', [attemptId]))
          _journalFrom(r),
      ];

  /// After the server confirms SCORING/COMPLETED and nothing is left to send: drop the
  /// journal and answer state, keep a receipt (design §1.1).
  Future<void> purgeJournal(int attemptId, {required AttemptKind kind, required int wallMs}) => transaction(() async {
        await _update('DELETE FROM journal WHERE attempt_id = ?', [attemptId]);
        await _update('DELETE FROM answer_state WHERE attempt_id = ?', [attemptId]);
        await _insert('INSERT OR IGNORE INTO receipt(attempt_id, kind, submitted_wall_ms) VALUES(?, ?, ?)',
            [attemptId, kind.wire, wallMs]);
      });

  Future<bool> hasReceipt(int attemptId) async =>
      (await _select('SELECT 1 FROM receipt WHERE attempt_id = ?', [attemptId])).isNotEmpty;

  // ---------------------------------------------------------------------------------------
  // outbox
  // ---------------------------------------------------------------------------------------

  OutboxItem _outboxFrom(QueryRow r) => OutboxItem(
        id: r.read<int>('id'),
        attemptId: r.read<int>('attempt_id'),
        attemptKind: AttemptKind.fromWire(r.read<String>('attempt_kind')),
        lane: OutboxLane.values.byName(r.read<String>('lane')),
        kind: OutboxKind.values.byName(r.read<String>('kind')),
        idemKey: r.read<String>('idem_key'),
        payload: (jsonDecode(_unseal(r.read<Uint8List>('payload'))) as Map).cast<String, Object?>(),
        coversModule: r.readNullable<int>('covers_module'),
        coversSeq: r.readNullable<int>('covers_seq'),
        state: OutboxState.values.byName(r.read<String>('state')),
        tries: r.read<int>('tries'),
        serverFailures: r.read<int>('server_failures'),
        nextAtMs: r.read<int>('next_at_ms'),
        lastError: r.readNullable<String>('last_error'),
        createdWallMs: r.read<int>('created_wall_ms'),
      );

  /// Queues [item] with the design §1.5 coalescing rules:
  ///  * a newer pending `sync` for a module replaces older pending ones;
  ///  * a `submit` for module k cancels pending syncs for module k;
  ///  * an `annotation` replaces the pending write for the same (ref, question, container);
  ///  * `offscreen` and `report` are never merged.
  /// An item whose key is already queued is ignored. Returns whether it was inserted.
  Future<bool> enqueue(OutboxItem item) => transaction(() async {
        switch (item.kind) {
          case OutboxKind.sync:
          case OutboxKind.submit:
            await _update(
                "DELETE FROM outbox WHERE attempt_id = ? AND kind = 'sync' AND covers_module = ? AND state = 'pending'",
                [item.attemptId, item.coversModule]);
          case OutboxKind.annotation:
            await _update("DELETE FROM outbox WHERE idem_key = ? AND state IN ('pending','dead','parked')",
                [item.idemKey]);
          case OutboxKind.start:
          case OutboxKind.offscreen:
          case OutboxKind.report:
            break;
        }
        final before = await _select('SELECT 1 FROM outbox WHERE idem_key = ?', [item.idemKey]);
        if (before.isNotEmpty) return false;
        await _insert(
          '''INSERT INTO outbox(attempt_id, attempt_kind, lane, kind, idem_key, payload, covers_module, covers_seq, state,
               tries, server_failures, next_at_ms, last_error, created_wall_ms)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, NULL, ?)''',
          [
            item.attemptId,
            item.attemptKind.wire,
            item.lane.name,
            item.kind.name,
            item.idemKey,
            _seal(jsonEncode(item.payload)),
            item.coversModule,
            item.coversSeq,
            item.nextAtMs,
            item.createdWallMs,
          ],
        );
        return true;
      });

  /// The next item to send on [lane]: strictly first in, first out (a `start` must reach the
  /// server before the module-1 `submit` queued after it), off-screen events first.
  Future<OutboxItem?> nextPending(int attemptId, OutboxLane lane) async {
    final rows = await _select(
      '''SELECT * FROM outbox WHERE attempt_id = ? AND lane = ? AND state = 'pending'
         ORDER BY CASE kind WHEN 'offscreen' THEN 0 ELSE 1 END, id LIMIT 1''',
      [attemptId, lane.name],
    );
    return rows.isEmpty ? null : _outboxFrom(rows.single);
  }

  Future<List<OutboxItem>> outbox(int attemptId, {Set<OutboxState>? states}) async {
    final rows = await _select('SELECT * FROM outbox WHERE attempt_id = ? ORDER BY id', [attemptId]);
    return [
      for (final r in rows)
        if (states == null || states.contains(OutboxState.values.byName(r.read<String>('state')))) _outboxFrom(r),
    ];
  }

  /// Off-screen event ids queued but not yet acknowledged (restored into the guard's tally).
  Future<List<String>> unsentOffscreenEvents(int attemptId) async => [
        for (final i in await outbox(attemptId, states: const {OutboxState.pending, OutboxState.inflight}))
          if (i.kind == OutboxKind.offscreen) (i.payload['event_id'] as String?) ?? i.idemKey,
      ];

  Future<OutboxItem?> outboxItem(int id) async {
    final rows = await _select('SELECT * FROM outbox WHERE id = ?', [id]);
    return rows.isEmpty ? null : _outboxFrom(rows.single);
  }

  /// Items not yet acknowledged (pending, in flight or parked), optionally on one lane.
  Future<int> unsentCount(int attemptId, {OutboxLane? lane}) async {
    final rows = await _select(
      "SELECT COUNT(*) AS c FROM outbox WHERE attempt_id = ? AND state IN ('pending','inflight','parked')"
      '${lane == null ? '' : ' AND lane = ?'}',
      [attemptId, if (lane != null) lane.name],
    );
    return rows.single.read<int>('c');
  }

  /// Attempts (id, kind) that still have unsent outbox items, finished or not.
  Future<List<(int, AttemptKind)>> attemptsWithUnsent() async => [
        for (final r in await _select(
            "SELECT DISTINCT attempt_id, attempt_kind FROM outbox WHERE state IN ('pending','inflight','parked') "
            'ORDER BY attempt_id'))
          (r.read<int>('attempt_id'), AttemptKind.fromWire(r.read<String>('attempt_kind'))),
      ];

  /// Every attempt with something left to send (sign-out guard, Home overlay).
  Future<int> unsentTotal() async {
    final rows = await _select("SELECT COUNT(*) AS c FROM outbox WHERE state IN ('pending','inflight','parked')");
    return rows.single.read<int>('c');
  }

  Future<void> markInflight(int id) => _update("UPDATE outbox SET state = 'inflight' WHERE id = ?", [id]);

  /// Back to pending at [nextAtMs] (transient failure / `retry_after_ms`).
  Future<void> reschedule(int id,
          {required int nextAtMs, required int tries, required int serverFailures, String? error}) =>
      _update(
        "UPDATE outbox SET state = 'pending', next_at_ms = ?, tries = ?, server_failures = ?, last_error = ? WHERE id = ?",
        [nextAtMs, tries, serverFailures, error, id],
      );

  Future<void> markDead(int id, String error) =>
      _update("UPDATE outbox SET state = 'dead', last_error = ? WHERE id = ?", [error, id]);

  Future<void> markParked(int id, String error, {required int tries, required int serverFailures}) => _update(
      "UPDATE outbox SET state = 'parked', last_error = ?, tries = ?, server_failures = ? WHERE id = ?",
      [error, tries, serverFailures, id]);

  /// Parked items go back to pending (the student pressed "Try again").
  Future<int> unpark(int attemptId) => _update(
      "UPDATE outbox SET state = 'pending', server_failures = 0, next_at_ms = 0 WHERE attempt_id = ? AND state = 'parked'",
      [attemptId]);

  /// Connectivity is back: everything waiting on a failure backoff is due now. Items waiting
  /// for a deadline (a midterm submit queued for `deadline + 750 ms`, or one told
  /// `module_not_expired`) keep their time.
  Future<int> makeDueNow(int attemptId) => _update(
      "UPDATE outbox SET next_at_ms = 0 WHERE attempt_id = ? AND state = 'pending' AND tries > 0 "
      "AND COALESCE(last_error, '') != ?",
      [attemptId, notExpiredMarker]);

  /// `last_error` of a midterm submit the server called early.
  static const notExpiredMarker = 'module_not_expired';

  /// Acknowledged: delete the item and record what the server now holds, in one transaction.
  Future<void> completeOutbox(OutboxItem item, {AttemptLite? attempt, bool applied = false}) =>
      transaction(() async {
        await _update('DELETE FROM outbox WHERE id = ?', [item.id]);
        if (attempt != null) {
          await setServerState(item.attemptId, attempt.state, attempt.version);
        }
        if (applied && item.coversModule != null && item.coversSeq != null) {
          await setAcked(item.attemptId, item.coversModule!, item.coversSeq!);
        }
      });

  /// Drop every unsent item of an attempt (the server says it is already handed in).
  Future<void> discardOutbox(int attemptId, {Set<OutboxLane> lanes = const {OutboxLane.exam, OutboxLane.urgent}}) =>
      _update(
        "DELETE FROM outbox WHERE attempt_id = ? AND state IN ('pending','parked','dead') AND lane IN "
        "(${lanes.map((l) => "'${l.name}'").join(',')})",
        [attemptId],
      );

  // ---------------------------------------------------------------------------------------
  // content (past papers only)
  // ---------------------------------------------------------------------------------------

  Future<void> putContent(String hash, int moduleId, List<Question> questions, int wallMs) => _insert(
        'INSERT INTO content(hash, module_id, blob, last_used) VALUES(?, ?, ?, ?) '
        'ON CONFLICT(hash) DO UPDATE SET last_used = excluded.last_used',
        [hash, moduleId, _seal(jsonEncode([for (final q in questions) q.toJson()])), wallMs],
      );

  Future<List<Question>?> getContent(String hash) async {
    final rows = await _select('SELECT blob FROM content WHERE hash = ?', [hash]);
    if (rows.isEmpty) return null;
    final list = jsonDecode(_unseal(rows.single.read<Uint8List>('blob'))) as List;
    return [for (var i = 0; i < list.length; i++) Question.fromJson(JsonReader.of(list[i], r'$[' '$i' ']'))];
  }

  // ---------------------------------------------------------------------------------------
  // media
  // ---------------------------------------------------------------------------------------

  Future<void> putMedia(MediaRow m, int wallMs) => _insert(
        'INSERT INTO media(key, path, bytes, content_type, last_used) VALUES(?, ?, ?, ?, ?) '
        'ON CONFLICT(key) DO UPDATE SET path = excluded.path, bytes = excluded.bytes, '
        'content_type = excluded.content_type, last_used = excluded.last_used',
        [m.key, m.path, m.bytes, m.contentType, wallMs],
      );

  Future<MediaRow?> media(String key) async {
    final rows = await _select('SELECT * FROM media WHERE key = ?', [key]);
    if (rows.isEmpty) return null;
    final r = rows.single;
    return MediaRow(
        key: r.read<String>('key'),
        path: r.read<String>('path'),
        bytes: r.read<int>('bytes'),
        contentType: r.read<String>('content_type'));
  }

  Future<void> touchMedia(String key, int wallMs) =>
      _update('UPDATE media SET last_used = ? WHERE key = ?', [wallMs, key]);

  /// Least-recently-used media beyond [maxBytes], skipping [keep] (images of unfinished attempts).
  Future<List<MediaRow>> mediaToEvict(int maxBytes, Set<String> keep) async {
    final rows = await _select('SELECT * FROM media ORDER BY last_used DESC');
    var total = 0;
    final out = <MediaRow>[];
    for (final r in rows) {
      final m = MediaRow(
          key: r.read<String>('key'),
          path: r.read<String>('path'),
          bytes: r.read<int>('bytes'),
          contentType: r.read<String>('content_type'));
      total += m.bytes;
      if (total > maxBytes && !keep.contains(m.key)) out.add(m);
    }
    return out;
  }

  Future<void> deleteMedia(String key) => _update('DELETE FROM media WHERE key = ?', [key]);

  // ---------------------------------------------------------------------------------------
  // annotations, notes, Desmos, view
  // ---------------------------------------------------------------------------------------

  Future<void> putAnnotation(String ref, int targetId, AnnotationContainer c, List<Annotation> data,
          {required bool dirty}) =>
      _insert(
        'INSERT INTO annotation(attempt_ref, target_id, container, data, dirty) VALUES(?, ?, ?, ?, ?) '
        'ON CONFLICT(attempt_ref, target_id, container) DO UPDATE SET data = excluded.data, dirty = excluded.dirty',
        [ref, targetId, c.wire, jsonEncode([for (final a in data) a.toJson()]), dirty],
      );

  Future<List<AnnotationRow>> annotations(String ref) async => [
        for (final r in await _select('SELECT * FROM annotation WHERE attempt_ref = ?', [ref]))
          AnnotationRow(
            targetId: r.read<int>('target_id'),
            container: AnnotationContainer.fromWire(r.read<String>('container')),
            data: [
              for (final a in jsonDecode(r.read<String>('data')) as List) Annotation.fromJson(JsonReader.of(a)),
            ],
          ),
      ];

  Future<void> setNotes(String ref, String text) => _insert(
      'INSERT INTO notes(attempt_ref, text) VALUES(?, ?) ON CONFLICT(attempt_ref) DO UPDATE SET text = excluded.text',
      [ref, _seal(text)]);

  Future<String> notes(String ref) async {
    final rows = await _select('SELECT text FROM notes WHERE attempt_ref = ?', [ref]);
    return rows.isEmpty ? '' : _unseal(rows.single.read<Uint8List>('text'));
  }

  Future<void> setDesmosState(String ref, Object? state) => state == null
      ? _update('DELETE FROM desmos_state WHERE attempt_ref = ?', [ref])
      : _insert(
          'INSERT INTO desmos_state(attempt_ref, state) VALUES(?, ?) '
          'ON CONFLICT(attempt_ref) DO UPDATE SET state = excluded.state',
          [ref, jsonEncode(state)]);

  Future<Object?> desmosState(String ref) async {
    final rows = await _select('SELECT state FROM desmos_state WHERE attempt_ref = ?', [ref]);
    return rows.isEmpty ? null : jsonDecode(rows.single.read<String>('state'));
  }

  Future<void> setViewState(String ref, {required double zoom, required double split, required bool highlighter}) =>
      _insert(
        'INSERT INTO view_state(attempt_ref, zoom, split, highlighter) VALUES(?, ?, ?, ?) '
        'ON CONFLICT(attempt_ref) DO UPDATE SET zoom = excluded.zoom, split = excluded.split, '
        'highlighter = excluded.highlighter',
        [ref, zoom, split, highlighter],
      );

  Future<({double zoom, double split, bool highlighter})?> viewState(String ref) async {
    final rows = await _select('SELECT * FROM view_state WHERE attempt_ref = ?', [ref]);
    if (rows.isEmpty) return null;
    final r = rows.single;
    return (zoom: r.read<double>('zoom'), split: r.read<double>('split'), highlighter: r.read<int>('highlighter') != 0);
  }
}
