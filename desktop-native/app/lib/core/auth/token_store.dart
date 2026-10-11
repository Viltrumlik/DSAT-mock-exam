// Tokens at rest: `%LOCALAPPDATA%\MasterSAT\auth.bin`, sealed with DPAPI for the current
// Windows user (NativeBridge.protect → ms_protect). Tokens never go into the SQLite store or
// any log. The pending PKCE verifier of an open browser sign-in is kept the same way in
// `signin.bin` for 10 minutes, so a sign-in link that cold-starts the app still completes.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import '../../native/native_bridge.dart';
import '../store/app_paths.dart';
import 'session.dart';

/// A browser sign-in in progress: the verifier stays on this computer; only the challenge
/// went to the browser.
class PendingSignIn {
  const PendingSignIn({required this.verifier, required this.challenge, required this.startedAt});

  factory PendingSignIn.fromJson(Map<String, Object?> j) => PendingSignIn(
        verifier: j['verifier']! as String,
        challenge: j['challenge']! as String,
        startedAt: DateTime.parse(j['started_at']! as String).toUtc(),
      );

  /// How long a pending sign-in is honoured (the server's code lives for less than this).
  static const lifetime = Duration(minutes: 10);

  final String verifier;
  final String challenge;
  final DateTime startedAt;

  bool isExpired(DateTime now) => now.difference(startedAt) > lifetime;

  Map<String, Object?> toJson() =>
      {'verifier': verifier, 'challenge': challenge, 'started_at': startedAt.toUtc().toIso8601String()};
}

class TokenStore {
  TokenStore({required this.authFile, required this.pendingFile, required this._native});

  factory TokenStore.at(AppPaths paths, NativeBridge native) =>
      TokenStore(authFile: paths.authFile, pendingFile: paths.pendingSignInFile, native: native);

  final File authFile;
  final File pendingFile;
  final NativeBridge _native;

  static const _version = 1;

  /// The stored session, or null when there is none or it cannot be opened (another Windows
  /// user's file, a corrupted file): either way the student signs in again.
  Future<AuthSession?> read() async {
    final j = await _readSealed(authFile);
    if (j == null || j['v'] != _version) return null;
    try {
      return AuthSession.fromJson(j);
    } catch (_) {
      return null;
    }
  }

  Future<void> write(AuthSession session) => _writeSealed(authFile, {'v': _version, ...session.toJson()});

  Future<void> clear() => _remove(authFile);

  Future<PendingSignIn?> readPending() async {
    final j = await _readSealed(pendingFile);
    if (j == null) return null;
    try {
      return PendingSignIn.fromJson(j);
    } catch (_) {
      return null;
    }
  }

  Future<void> writePending(PendingSignIn p) => _writeSealed(pendingFile, p.toJson());

  Future<void> clearPending() => _remove(pendingFile);

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
