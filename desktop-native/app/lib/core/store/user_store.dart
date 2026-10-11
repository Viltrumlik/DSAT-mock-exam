// One signed-in student's local data: their drift database, with the Home cache and settings
// in it. Opened when the student is known (from auth.bin at launch, or the first `home` after
// sign-in); closed on sign-out. Students sharing a laptop never see each other's data.
import 'dart:io';

import 'app_database.dart';
import 'app_paths.dart';
import 'home_cache.dart';
import 'settings_store.dart';

class UserStore {
  UserStore._(this.userId, this.db)
      : homeCache = HomeCache(db),
        settings = SettingsStore(db);

  /// Opens `store-<userId>.db` under [paths] and loads the settings.
  static Future<UserStore> open(AppPaths paths, int userId) async {
    final store = UserStore._(userId, AppDatabase.open(paths.storeFile(userId)));
    await store.settings.load();
    return store;
  }

  /// An in-memory store (tests).
  static Future<UserStore> memory(int userId) async {
    final store = UserStore._(userId, AppDatabase.memory());
    await store.settings.load();
    return store;
  }

  final int userId;
  final AppDatabase db;
  final HomeCache homeCache;
  final SettingsStore settings;

  Future<void> close() => db.close();

  /// Removes one student's database files (Settings → "Delete data on this computer").
  /// The database must be closed first.
  static Future<void> removeFiles(AppPaths paths, int userId) async {
    for (final f in paths.storeFiles(userId)) {
      if (await f.exists()) await f.delete();
    }
  }

  /// Removes the caches every student shares (images, WebView2 data, logs). They can all be
  /// downloaded again; nothing in them is unsent work.
  static Future<void> removeSharedCaches(AppPaths paths) async {
    for (final d in [paths.mediaDir, paths.webviewDir, paths.logsDir]) {
      if (await d.exists()) {
        try {
          await d.delete(recursive: true);
        } on FileSystemException {
          // A file still open (a live WebView2): leave it; it is cleared next time.
        }
      }
    }
  }
}
