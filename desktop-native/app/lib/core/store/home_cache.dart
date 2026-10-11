// The last `GET home` answer, so Home draws on the very first frame (architecture §2.3) and
// works offline with an "updated hh:mm" banner (design §1.11).
import 'dart:convert';

import 'package:drift/drift.dart';

import '../models/models.dart';
import 'app_database.dart';

/// One cached Home.
class CachedHome {
  const CachedHome({required this.home, required this.etag, required this.fetchedAt});

  final HomeResponse home;
  final String? etag;

  /// When this payload last came from (or was confirmed by) the server. Local wall clock, UTC.
  final DateTime fetchedAt;
}

class HomeCache {
  HomeCache(this._db);

  final AppDatabase _db;

  /// The cached Home, or null when there is none or it no longer parses (a schema change):
  /// a cache that cannot be read is simply fetched again.
  Future<CachedHome?> read() async {
    final rows = await _db
        .customSelect('SELECT etag, payload, fetched_wall_ms FROM home_cache WHERE id = 1')
        .get();
    if (rows.isEmpty) return null;
    final row = rows.first;
    try {
      final json = jsonDecode(row.read<String>('payload'));
      final home = HomeResponse.fromJson(JsonReader.of(json));
      return CachedHome(
        home: home,
        etag: row.readNullable<String>('etag'),
        fetchedAt: DateTime.fromMillisecondsSinceEpoch(row.read<int>('fetched_wall_ms'), isUtc: true),
      );
    } on FormatException {
      return null;
    }
  }

  /// Stores a fresh payload.
  Future<void> write(HomeResponse home, String? etag, DateTime fetchedAt) => _db.customStatement(
        'INSERT INTO home_cache (id, etag, payload, fetched_wall_ms) VALUES (1, ?, ?, ?) '
        'ON CONFLICT(id) DO UPDATE SET etag = excluded.etag, payload = excluded.payload, '
        'fetched_wall_ms = excluded.fetched_wall_ms',
        [etag, jsonEncode(home.toJson()), fetchedAt.toUtc().millisecondsSinceEpoch],
      );

  /// A 304: the payload is still current as of [fetchedAt].
  Future<void> touch(DateTime fetchedAt, {String? etag}) => _db.customUpdate(
        'UPDATE home_cache SET fetched_wall_ms = ?, etag = COALESCE(?, etag) WHERE id = 1',
        variables: [Variable.withInt(fetchedAt.toUtc().millisecondsSinceEpoch), Variable<String>(etag)],
        updates: const {},
      );

  Future<void> clear() => _db.customStatement('DELETE FROM home_cache');
}
