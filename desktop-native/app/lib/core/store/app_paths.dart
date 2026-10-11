// Where the app keeps its files (architecture §6: user data lives OUTSIDE the install folder,
// so an update or uninstall can never remove an unsent answer).
//
//   Windows: %LOCALAPPDATA%\MasterSAT\        (not Roaming: the data belongs to this PC)
//   macOS (development only): the app-support folder from path_provider.
//
//   auth.bin              sealed tokens (DPAPI via NativeBridge.protect)
//   signin.bin            the PKCE verifier while a browser sign-in is open (10 min)
//   store-<user_id>.db    the per-user drift database (Home cache, settings)
//   media\                cached question images (exam engine)
//   webview2\             WebView2 user data (windows-host)
//   logs\                 diagnostics logs
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class AppPaths {
  const AppPaths(this.root);

  /// Resolves the platform root (creating it).
  static Future<AppPaths> resolve() async {
    String root;
    final local = Platform.isWindows ? Platform.environment['LOCALAPPDATA'] : null;
    if (local != null && local.isNotEmpty) {
      root = p.join(local, 'MasterSAT');
    } else {
      root = p.join((await getApplicationSupportDirectory()).path, 'MasterSAT');
    }
    final paths = AppPaths(root);
    await Directory(root).create(recursive: true);
    return paths;
  }

  final String root;

  File get authFile => File(p.join(root, 'auth.bin'));
  File get pendingSignInFile => File(p.join(root, 'signin.bin'));
  File storeFile(int userId) => File(p.join(root, 'store-$userId.db'));
  Directory get mediaDir => Directory(p.join(root, 'media'));
  Directory get webviewDir => Directory(p.join(root, 'webview2'));
  Directory get logsDir => Directory(p.join(root, 'logs'));

  /// The files that make up one user's database (SQLite WAL mode adds -wal and -shm).
  List<File> storeFiles(int userId) {
    final base = storeFile(userId).path;
    return [File(base), File('$base-wal'), File('$base-shm'), File('$base-journal')];
  }
}

/// Writes [bytes] to [file] atomically: a temp file, flushed, then renamed over the target.
Future<void> writeFileAtomically(File file, List<int> bytes) async {
  await file.parent.create(recursive: true);
  final tmp = File('${file.path}.tmp');
  final raf = await tmp.open(mode: FileMode.write);
  try {
    await raf.writeFrom(bytes);
    await raf.flush();
  } finally {
    await raf.close();
  }
  await tmp.rename(file.path);
}
