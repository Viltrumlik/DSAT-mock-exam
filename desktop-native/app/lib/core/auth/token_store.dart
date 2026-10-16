// Tokens at rest: `%LOCALAPPDATA%\MasterSAT\auth.bin`, sealed with DPAPI for the current
// Windows user (NativeBridge.protect → ms_protect). Tokens never go into the SQLite store or
// any log; the password never goes anywhere (it is sent once and not kept).
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import '../../native/native_bridge.dart';
import '../store/app_paths.dart';
import 'session.dart';

/// Where the session lives.
abstract class TokenStore {
  /// The sealed file under [paths] (the app).
  factory TokenStore.at(AppPaths paths, NativeBridge native) => FileTokenStore(authFile: paths.authFile, native: native);

  /// The stored session, or null.
  Future<AuthSession?> read();
  Future<void> write(AuthSession session);
  Future<void> clear();
}

/// In memory (tests; nothing touches the disk).
class MemoryTokenStore implements TokenStore {
  MemoryTokenStore({this.session});

  AuthSession? session;

  /// How many times [write] ran (tests check a refresh stored the rotated pair).
  int writes = 0;

  @override
  Future<AuthSession?> read() async => session;

  @override
  Future<void> write(AuthSession s) async {
    writes++;
    session = s;
  }

  @override
  Future<void> clear() async => session = null;
}

/// `auth.bin`, sealed with DPAPI through the native library.
class FileTokenStore implements TokenStore {
  FileTokenStore({required this.authFile, required this._native});

  final File authFile;
  final NativeBridge _native;

  static const _version = 1;

  /// The stored session, or null when there is none or it cannot be opened (another Windows
  /// user's file, a corrupted file): either way the student signs in again.
  @override
  Future<AuthSession?> read() async {
    final j = await _readSealed(authFile);
    if (j == null || j['v'] != _version) return null;
    try {
      return AuthSession.fromJson(j);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(AuthSession session) => _writeSealed(authFile, {'v': _version, ...session.toJson()});

  @override
  Future<void> clear() => _remove(authFile);

  Future<Map<String, Object?>?> _readSealed(File f) async {
    try {
      if (!await f.exists()) return null;
      final sealed = await f.readAsBytes();
      final plain = _native.unprotect(Uint8List.fromList(sealed));
      final j = jsonDecode(utf8.decode(plain));
      return j is Map ? j.cast<String, Object?>() : null;
    } on NativeBridgeException {
      return null;
    } on FormatException {
      return null;
    } on FileSystemException {
      return null;
    }
  }

  Future<void> _writeSealed(File f, Map<String, Object?> json) async {
    final sealed = _native.protect(Uint8List.fromList(utf8.encode(jsonEncode(json))));
    await writeFileAtomically(f, sealed);
  }

  static Future<void> _remove(File f) async {
    try {
      if (await f.exists()) await f.delete();
    } on FileSystemException {
      // Already gone.
    }
  }
}
