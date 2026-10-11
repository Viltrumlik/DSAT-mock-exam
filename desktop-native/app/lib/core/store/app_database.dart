// The per-user cache database: `store-<user_id>.db` (architecture §4.1, design §1.2).
//
// drift on bundled SQLite (sqlite3 3.x ships its own SQLite), on drift's background isolate
// (`NativeDatabase.createInBackground`) so no query ever runs on the UI thread. WAL mode and
// `synchronous=FULL`, so a committed row survives a power cut.
//
// app-core's tables (the exam engine keeps its journal/outbox tables in its own schema):
//   home_cache(id=1, etag, payload, fetched_wall_ms)  — the last `GET home`, shown instantly
//   settings(key PK, value)                            — JSON values: filters, window placement,
//                                                         update channel, …
// The schema is plain SQL (no build_runner step): two tiny tables do not need generated row
// classes, and plain SQL keeps the file readable next to the design's DDL.
import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';

class AppDatabase extends GeneratedDatabase {
  AppDatabase(super.executor);

  /// Opens (creating) [file] on a background isolate.
  factory AppDatabase.open(File file) => AppDatabase(
        NativeDatabase.createInBackground(
          file,
          setup: (db) {
            db.execute('PRAGMA journal_mode=WAL;');
            db.execute('PRAGMA synchronous=FULL;');
            db.execute('PRAGMA foreign_keys=ON;');
          },
        ),
      );

  /// An in-memory database (tests).
  factory AppDatabase.memory() => AppDatabase(NativeDatabase.memory());

  static const _ddl = <String>[
    'CREATE TABLE IF NOT EXISTS home_cache ('
        ' id INTEGER PRIMARY KEY CHECK (id = 1),'
        ' etag TEXT,'
        ' payload TEXT NOT NULL,'
        ' fetched_wall_ms INTEGER NOT NULL'
        ')',
    'CREATE TABLE IF NOT EXISTS settings ('
        ' key TEXT PRIMARY KEY NOT NULL,'
        ' value TEXT NOT NULL'
        ')',
  ];

  @override
  Iterable<TableInfo<Table, Object?>> get allTables => const [];

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) async {
          for (final s in _ddl) {
            await customStatement(s);
          }
        },
        beforeOpen: (details) async {
          // Idempotent: also repairs a file whose tables were dropped by hand.
          for (final s in _ddl) {
            await customStatement(s);
          }
        },
      );
}
