// Per-user settings (JSON values in the `settings` table): library filters, window placement,
// update channel. Reads are served from memory after [SettingsStore.load]; writes go straight
// to SQLite.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'app_database.dart';

/// Velopack update channel (architecture §6: the owner is on beta, students on stable).
enum UpdateChannel {
  stable('stable'),
  beta('beta');

  const UpdateChannel(this.wire);
  final String wire;

  static UpdateChannel fromWire(String? s) => s == 'beta' ? beta : stable;
}

/// The main window's last normal placement (restored by the Windows runner).
@immutable
class WindowPlacement {
  const WindowPlacement({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    this.maximized = false,
  });

  factory WindowPlacement.fromJson(Map<String, Object?> j) => WindowPlacement(
        x: (j['x']! as num).toDouble(),
        y: (j['y']! as num).toDouble(),
        width: (j['width']! as num).toDouble(),
        height: (j['height']! as num).toDouble(),
        maximized: (j['maximized'] as bool?) ?? false,
      );

  final double x;
  final double y;
  final double width;
  final double height;
  final bool maximized;

  Map<String, Object?> toJson() => {'x': x, 'y': y, 'width': width, 'height': height, 'maximized': maximized};

  @override
  bool operator ==(Object other) =>
      other is WindowPlacement &&
      other.x == x &&
      other.y == y &&
      other.width == width &&
      other.height == height &&
      other.maximized == maximized;

  @override
  int get hashCode => Object.hash(x, y, width, height, maximized);
}

abstract final class SettingsKeys {
  static const libraryFilters = 'library.filters';
  static const windowPlacement = 'window.placement';
  static const updateChannel = 'update.channel';
}

class SettingsStore {
  SettingsStore(this._db);

  final AppDatabase _db;
  final Map<String, Object?> _values = {};
  bool _loaded = false;

  /// Reads every setting into memory.
  Future<void> load() async {
    final rows = await _db.customSelect('SELECT key, value FROM settings').get();
    _values.clear();
    for (final r in rows) {
      try {
        _values[r.read<String>('key')] = jsonDecode(r.read<String>('value'));
      } on FormatException {
        // A value that no longer parses is treated as unset.
      }
    }
    _loaded = true;
  }

  bool get isLoaded => _loaded;

  Object? read(String key) => _values[key];

  Map<String, Object?>? readMap(String key) {
    final v = _values[key];
    return v is Map ? v.cast<String, Object?>() : null;
  }

  Future<void> write(String key, Object? value) async {
    if (value == null) {
      _values.remove(key);
      await _db.customStatement('DELETE FROM settings WHERE key = ?', [key]);
      return;
    }
    _values[key] = value;
    await _db.customStatement(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, jsonEncode(value)],
    );
  }

  UpdateChannel get updateChannel => UpdateChannel.fromWire(read(SettingsKeys.updateChannel) as String?);
  Future<void> setUpdateChannel(UpdateChannel c) => write(SettingsKeys.updateChannel, c.wire);

  WindowPlacement? get windowPlacement {
    final m = readMap(SettingsKeys.windowPlacement);
    if (m == null) return null;
    try {
      return WindowPlacement.fromJson(m);
    } catch (_) {
      return null;
    }
  }

  Future<void> setWindowPlacement(WindowPlacement p) => write(SettingsKeys.windowPlacement, p.toJson());
}
