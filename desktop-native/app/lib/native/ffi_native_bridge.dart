// FfiNativeBridge — the real NativeBridge: dart:ffi over native/include/mastersat_native.h.
//
// Which library:
//  * Windows (the product): `mastersat_native.dll` by its bare name. The runner (C++) links the
//    DLL's import library and has already called ms_startup + ms_init, so LoadLibrary returns
//    THAT module — Dart and C++ share one set of Rust statics (the window handle, the lock, the
//    pre-check captured at lock time). A full path to some other copy would load a second,
//    uninitialised module, so the bare name is always tried first.
//  * macOS (development only): `libmastersat_native.dylib` from the cargo target folder
//    (`cargo build --manifest-path desktop-native/native/Cargo.toml`), or the app bundle's
//    Frameworks folder, or MASTERSAT_NATIVE_LIB. Nobody else calls ms_init there, so [open] does
//    (`ms_init(0, version)`: no window to manage), as the header's dev-host contract says.
//
// Conventions (the header's CONVENTIONS block): every output is Rust-allocated and freed here
// with ms_free / ms_free_bytes; a non-OK status throws [NativeBridgeException] carrying
// `ms_last_error()` (thread-local, so it is read immediately, before any other call). The SLOW
// calls (uninstall, update check, update download) run on a background isolate that opens the
// same module by the same path.
import 'dart:async';
import 'dart:ffi';
import 'dart:io';
import 'dart:isolate';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:ffi/ffi.dart';

import 'native_bridge.dart';

/// No candidate library could be opened (development hosts without a built library).
class NativeLibraryUnavailable implements Exception {
  const NativeLibraryUnavailable(this.attempts);

  /// `"<candidate>: <why>"` per path tried, in order.
  final List<String> attempts;

  @override
  String toString() => 'NativeLibraryUnavailable(${attempts.join('; ')})';
}

/// Where mastersat_native is looked for, in order.
abstract final class NativeLibraryLocation {
  /// Overrides the search on every platform (tests, CI, unusual dev layouts).
  static const envVar = 'MASTERSAT_NATIVE_LIB';
  static const windowsName = 'mastersat_native.dll';
  static const macosName = 'libmastersat_native.dylib';
  static const linuxName = 'libmastersat_native.so';

  /// The candidates for this process. [environment], [executable] and [currentDirectory] are
  /// injectable for tests; they default to the running process's.
  static List<String> candidates({
    Map<String, String>? environment,
    String? executable,
    String? currentDirectory,
    String? operatingSystem,
  }) {
    final env = environment ?? Platform.environment;
    final os = operatingSystem ?? Platform.operatingSystem;
    final exe = executable ?? Platform.resolvedExecutable;
    final cwd = currentDirectory ?? Directory.current.path;
    final windows = os == 'windows';
    final sep = windows ? r'\' : '/';
    final name = switch (os) {
      'windows' => windowsName,
      'macos' => macosName,
      _ => linuxName,
    };
    String join(List<String> parts) => parts.join(sep);
    String dirOf(String path) {
      final i = path.lastIndexOf(sep);
      return i <= 0 ? path : path.substring(0, i);
    }

    final override = env[envVar];
    final out = <String>[];
    if (windows) {
      // The module the runner already loaded — always first (see the file comment).
      out.add(windowsName);
      if (override != null && override.isNotEmpty) out.add(override);
    } else {
      if (override != null && override.isNotEmpty) out.add(override);
      if (os == 'macos') {
        // An app bundle: Contents/MacOS/<exe> → Contents/Frameworks/<lib>.
        out.add(join([dirOf(dirOf(exe)), 'Frameworks', macosName]));
      }
    }
    // Development: the cargo target folder, seen from desktop-native/app (flutter test / run),
    // from desktop-native, or from the repository root. Debug first: it embeds the development
    // proof key, which a release build without DESKTOP_PROOF_KEY does not.
    for (final base in [
      join([cwd, '..', 'native', 'target']),
      join([cwd, 'native', 'target']),
      join([cwd, 'desktop-native', 'native', 'target']),
    ]) {
      for (final profile in const ['debug', 'release']) {
        out.add(join([base, profile, name]));
      }
    }
    return out;
  }
}

// ── Native signatures ───────────────────────────────────────────────────────────────────────

typedef MsOutStr = Pointer<Pointer<Utf8>>;
typedef MsBytesNative = Int32 Function(Pointer<Uint8>, Size, Pointer<Pointer<Uint8>>, Pointer<Size>);
typedef MsBytesDart = int Function(Pointer<Uint8>, int, Pointer<Pointer<Uint8>>, Pointer<Size>);
typedef MsOutNative = Int32 Function(MsOutStr);
typedef MsOutDart = int Function(MsOutStr);
typedef MsStrNative = Int32 Function(Pointer<Utf8>);
typedef MsStrDart = int Function(Pointer<Utf8>);
typedef MsVoidNative = Int32 Function();
typedef MsVoidDart = int Function();

/// Every function of mastersat_native.h, bound once per isolate.
final class MsBindings {
  MsBindings(this.library)
    : free = library.lookupFunction<Void Function(Pointer<Utf8>), void Function(Pointer<Utf8>)>('ms_free'),
      freeBytes = library.lookupFunction<Void Function(Pointer<Uint8>, Size), void Function(Pointer<Uint8>, int)>(
        'ms_free_bytes',
      ),
      version = library.lookupFunction<Pointer<Utf8> Function(), Pointer<Utf8> Function()>('ms_version'),
      lastError = library.lookupFunction<Pointer<Utf8> Function(), Pointer<Utf8> Function()>('ms_last_error'),
      startup = library
          .lookupFunction<Int32 Function(Int32, Pointer<Pointer<Utf8>>), int Function(int, Pointer<Pointer<Utf8>>)>(
            'ms_startup',
          ),
      init = library.lookupFunction<Int32 Function(IntPtr, Pointer<Utf8>), int Function(int, Pointer<Utf8>)>('ms_init'),
      registerProtocol = library.lookupFunction<MsStrNative, MsStrDart>('ms_register_protocol'),
      uninstallLegacy = library.lookupFunction<MsOutNative, MsOutDart>('ms_uninstall_legacy'),
      precheckJson = library.lookupFunction<MsOutNative, MsOutDart>('ms_precheck_json'),
      closeApp = library.lookupFunction<MsStrNative, MsStrDart>('ms_close_app'),
      lockEnter = library.lookupFunction<MsOutNative, MsOutDart>('ms_lock_enter'),
      lockExit = library.lookupFunction<MsVoidNative, MsVoidDart>('ms_lock_exit'),
      heartbeat = library.lookupFunction<MsVoidNative, MsVoidDart>('ms_heartbeat'),
      awayNow = library.lookupFunction<MsVoidNative, MsVoidDart>('ms_away_now'),
      batteryJson = library.lookupFunction<MsOutNative, MsOutDart>('ms_battery_json'),
      prove = library
          .lookupFunction<Int32 Function(Int64, Pointer<Utf8>, MsOutStr), int Function(int, Pointer<Utf8>, MsOutStr)>(
            'ms_prove',
          ),
      pkceNew = library.lookupFunction<Int32 Function(MsOutStr, MsOutStr), int Function(MsOutStr, MsOutStr)>(
        'ms_pkce_new',
      ),
      seal = library.lookupFunction<MsBytesNative, MsBytesDart>('ms_seal'),
      open = library.lookupFunction<MsBytesNative, MsBytesDart>('ms_open'),
      protect = library.lookupFunction<MsBytesNative, MsBytesDart>('ms_protect'),
      unprotect = library.lookupFunction<MsBytesNative, MsBytesDart>('ms_unprotect'),
      proxyFor = library.lookupFunction<Int32 Function(Pointer<Utf8>, MsOutStr), int Function(Pointer<Utf8>, MsOutStr)>(
        'ms_proxy_for',
      ),
      keepAwake = library.lookupFunction<Int32 Function(Int32), int Function(int)>('ms_keep_awake'),
      updateCheck = library
          .lookupFunction<
            Int32 Function(Pointer<Utf8>, Pointer<Utf8>, MsOutStr),
            int Function(Pointer<Utf8>, Pointer<Utf8>, MsOutStr)
          >('ms_update_check'),
      updateDownload = library.lookupFunction<MsVoidNative, MsVoidDart>('ms_update_download'),
      updateProgress = library.lookupFunction<MsVoidNative, MsVoidDart>('ms_update_progress'),
      updateApplyRestart = library.lookupFunction<MsVoidNative, MsVoidDart>('ms_update_apply_restart');

  final DynamicLibrary library;
  final void Function(Pointer<Utf8>) free;
  final void Function(Pointer<Uint8>, int) freeBytes;
  final Pointer<Utf8> Function() version;
  final Pointer<Utf8> Function() lastError;
  final int Function(int, Pointer<Pointer<Utf8>>) startup;
  final int Function(int, Pointer<Utf8>) init;
  final MsStrDart registerProtocol;
  final MsOutDart uninstallLegacy;
  final MsOutDart precheckJson;
  final MsStrDart closeApp;
  final MsOutDart lockEnter;
  final MsVoidDart lockExit;
  final MsVoidDart heartbeat;
  final MsVoidDart awayNow;
  final MsOutDart batteryJson;
  final int Function(int, Pointer<Utf8>, MsOutStr) prove;
  final int Function(MsOutStr, MsOutStr) pkceNew;
  final MsBytesDart seal;
  final MsBytesDart open;
  final MsBytesDart protect;
  final MsBytesDart unprotect;
  final int Function(Pointer<Utf8>, MsOutStr) proxyFor;
  final int Function(int) keepAwake;
  final int Function(Pointer<Utf8>, Pointer<Utf8>, MsOutStr) updateCheck;
  final MsVoidDart updateDownload;
  final MsVoidDart updateProgress;
  final MsVoidDart updateApplyRestart;
}

// ── The calling conventions, shared by every isolate ────────────────────────────────────────

/// One isolate's view of the module: the bindings plus the header's calling conventions.
final class _Calls {
  _Calls(this.b);

  final MsBindings b;

  /// `ms_last_error()` — read right after the failing call (thread-local in the library).
  String? lastError() {
    final p = b.lastError();
    if (p == nullptr) return null;
    try {
      return p.toDartString();
    } finally {
      b.free(p);
    }
  }

  Never fail(int code, String function) => throw NativeBridgeException(code, function, lastError());

  void check(int code, String function) {
    if (code != NativeStatus.ok) fail(code, function);
  }

  /// Take ownership of a returned string: copy it, then ms_free it.
  String take(Pointer<Utf8> p) {
    try {
      return p.toDartString();
    } finally {
      b.free(p);
    }
  }

  /// A `char** out` call. On error the output is NULL by contract; a stray one is freed anyway.
  String outString(String function, int Function(MsOutStr out) call) {
    final out = calloc<Pointer<Utf8>>();
    try {
      final code = call(out);
      if (code != NativeStatus.ok) {
        final message = lastError();
        if (out.value != nullptr) b.free(out.value);
        throw NativeBridgeException(code, function, message);
      }
      return take(out.value);
    } finally {
      calloc.free(out);
    }
  }

  /// A `uint8_t* in, size_t in_len, uint8_t** out, size_t* out_len` call. The native copy of the
  /// input is zeroed before it is freed (tokens and answers pass through here).
  Uint8List bytes(String function, MsBytesDart call, Uint8List input) {
    return using((arena) {
      final length = input.length;
      final inPtr = arena<Uint8>(math.max(length, 1));
      final view = inPtr.asTypedList(length);
      view.setAll(0, input);
      final out = arena<Pointer<Uint8>>();
      final outLen = arena<Size>();
      try {
        final code = call(inPtr, length, out, outLen);
        if (code != NativeStatus.ok) fail(code, function);
        final ptr = out.value;
        final n = outLen.value;
        try {
          return n == 0 ? Uint8List(0) : Uint8List.fromList(ptr.asTypedList(n));
        } finally {
          b.freeBytes(ptr, n);
        }
      } finally {
        view.fillRange(0, length, 0);
      }
    });
  }

  /// Run [body] with [value] as a temporary NUL-terminated UTF-8 string.
  String withString(String value, String Function(Pointer<Utf8> p) body) {
    final p = value.toNativeUtf8();
    try {
      return body(p);
    } finally {
      calloc.free(p);
    }
  }
}

// ── Background-isolate entry points ─────────────────────────────────────────────────────────
// Top level, and spawned from top-level functions too: a closure created inside a method can
// capture that method's whole context (here: `this`, whose FFI function pointers cannot be sent
// to another isolate). These capture only strings.

Future<String> _runUninstallLegacy(String path) =>
    Isolate.run(() => _isolateUninstallLegacy(path), debugName: 'ms_uninstall_legacy');

Future<String> _runUpdateCheck(String path, String feedUrl, String channel) =>
    Isolate.run(() => _isolateUpdateCheck(path, feedUrl, channel), debugName: 'ms_update_check');

Future<void> _runUpdateDownload(String path) =>
    Isolate.run(() => _isolateUpdateDownload(path), debugName: 'ms_update_download');

_Calls _attach(String libraryPath) => _Calls(MsBindings(DynamicLibrary.open(libraryPath)));

String _isolateUninstallLegacy(String libraryPath) {
  final c = _attach(libraryPath);
  return c.outString('ms_uninstall_legacy', c.b.uninstallLegacy);
}

String _isolateUpdateCheck(String libraryPath, String feedUrl, String channel) {
  final c = _attach(libraryPath);
  final feed = feedUrl.toNativeUtf8();
  final ch = channel.toNativeUtf8();
  try {
    return c.outString('ms_update_check', (out) => c.b.updateCheck(feed, ch, out));
  } finally {
    calloc
      ..free(feed)
      ..free(ch);
  }
}

void _isolateUpdateDownload(String libraryPath) {
  final c = _attach(libraryPath);
  c.check(c.b.updateDownload(), 'ms_update_download');
}

// ── The bridge ──────────────────────────────────────────────────────────────────────────────

class FfiNativeBridge implements NativeBridge {
  FfiNativeBridge._(this._c, this.libraryPath);

  /// Open the library (see [NativeLibraryLocation.candidates]) and, on a development host where
  /// no runner does it, call `ms_init(0, devAppVersion ?? libraryVersion)`. Throws
  /// [NativeLibraryUnavailable] when no candidate opens.
  ///
  /// [devAppVersion] is the version signed into proofs on a development host (the first
  /// ms_init in a process wins); on Windows the runner passes the real one.
  factory FfiNativeBridge.open({String? libraryPath, String? devAppVersion}) {
    final attempts = <String>[];
    for (final candidate in libraryPath != null ? [libraryPath] : NativeLibraryLocation.candidates()) {
      final DynamicLibrary lib;
      try {
        lib = DynamicLibrary.open(candidate);
      } on ArgumentError catch (e) {
        attempts.add('$candidate: ${e.message}');
        continue;
      }
      // Binding outside the try: a library that opens but lacks a symbol is a version mismatch,
      // which must fail loudly rather than fall through to some other copy.
      final bridge = FfiNativeBridge._(_Calls(MsBindings(lib)), candidate);
      if (!Platform.isWindows) bridge._initDevHost(devAppVersion ?? bridge.libraryVersion);
      return bridge;
    }
    throw NativeLibraryUnavailable(attempts);
  }

  final _Calls _c;

  /// The path the module was opened by — reused, verbatim, by background isolates so they get
  /// the same module (and its statics).
  final String libraryPath;

  MsBindings get _b => _c.b;

  /// How often [updateDownload] samples `ms_update_progress`.
  static const progressInterval = Duration(milliseconds: 250);

  void _initDevHost(String appVersion) {
    _c.check(using((arena) => _b.init(0, appVersion.toNativeUtf8(allocator: arena))), 'ms_init');
  }

  @override
  String get libraryVersion => _b.version().toDartString(); // static: never freed

  @override
  void registerProtocol(String exePath) {
    _c.check(using((arena) => _b.registerProtocol(exePath.toNativeUtf8(allocator: arena))), 'ms_register_protocol');
  }

  @override
  Future<LegacyUninstall> uninstallLegacy() async {
    final raw = await _runUninstallLegacy(libraryPath);
    return LegacyUninstall.parse(raw);
  }

  // ---- lockdown ---------------------------------------------------------------------------

  @override
  PrecheckReport precheck() => PrecheckReport.parse(_c.outString('ms_precheck_json', _b.precheckJson));

  @override
  void closeApp(String exe) {
    _c.check(using((arena) => _b.closeApp(exe.toNativeUtf8(allocator: arena))), 'ms_close_app');
  }

  @override
  PrecheckReport lockEnter() {
    final out = calloc<Pointer<Utf8>>();
    try {
      final code = _b.lockEnter(out);
      if (code == NativeStatus.errPrecheck && out.value != nullptr) {
        // The one documented exception to "NULL on error": the failing report, which the
        // pre-check screen shows (FakeNativeBridge puts it in the message the same way).
        throw NativeBridgeException(code, 'ms_lock_enter', _c.take(out.value));
      }
      if (code != NativeStatus.ok) {
        final message = _c.lastError();
        if (out.value != nullptr) _b.free(out.value);
        throw NativeBridgeException(code, 'ms_lock_enter', message);
      }
      return PrecheckReport.parse(_c.take(out.value));
    } finally {
      calloc.free(out);
    }
  }

  @override
  void lockExit() => _c.check(_b.lockExit(), 'ms_lock_exit');

  @override
  bool heartbeat() => _b.heartbeat() == 1;

  @override
  bool awayNow() => _b.awayNow() == 1;

  @override
  BatteryStatus? battery() => BatteryStatus.parse(_c.outString('ms_battery_json', _b.batteryJson));

  @override
  LockdownProof prove({required int attemptId, required String nonce}) {
    final raw = _c.withString(nonce, (n) => _c.outString('ms_prove', (out) => _b.prove(attemptId, n, out)));
    return LockdownProof.parse(raw);
  }

  // ---- sign-in ----------------------------------------------------------------------------

  @override
  PkcePair pkceNew() {
    return using((arena) {
      final verifier = arena<Pointer<Utf8>>();
      final challenge = arena<Pointer<Utf8>>();
      final code = _b.pkceNew(verifier, challenge);
      if (code != NativeStatus.ok) _c.fail(code, 'ms_pkce_new'); // both NULL by contract
      return PkcePair(verifier: _c.take(verifier.value), challenge: _c.take(challenge.value));
    });
  }

  // ---- data at rest -----------------------------------------------------------------------

  @override
  Uint8List seal(Uint8List plain) => _c.bytes('ms_seal', _b.seal, plain);

  @override
  Uint8List open(Uint8List sealed) => _c.bytes('ms_open', _b.open, sealed);

  @override
  Uint8List protect(Uint8List plain) => _c.bytes('ms_protect', _b.protect, plain);

  @override
  Uint8List unprotect(Uint8List blob) => _c.bytes('ms_unprotect', _b.unprotect, blob);

  // ---- network and power ------------------------------------------------------------------

  @override
  String proxyFor(String url) => _c.withString(url, (u) => _c.outString('ms_proxy_for', (out) => _b.proxyFor(u, out)));

  @override
  void keepAwake(bool on) => _c.check(_b.keepAwake(on ? 1 : 0), 'ms_keep_awake');

  // ---- updates ----------------------------------------------------------------------------

  @override
  Future<UpdateInfo> updateCheck({required String feedUrl, required String channel}) async {
    final raw = await _runUpdateCheck(libraryPath, feedUrl, channel);
    return UpdateInfo.parse(raw);
  }

  @override
  Future<void> updateDownload({void Function(int percent)? onProgress}) async {
    var last = -1;
    void sample() {
      final p = _b.updateProgress();
      if (p >= 0 && p != last) {
        last = p;
        onProgress?.call(p);
      }
    }

    final timer = onProgress == null ? null : Timer.periodic(progressInterval, (_) => sample());
    try {
      await _runUpdateDownload(libraryPath);
    } finally {
      timer?.cancel();
    }
    if (last < 100) onProgress?.call(100);
  }

  @override
  void updateApplyRestart() => _c.check(_b.updateApplyRestart(), 'ms_update_apply_restart');
}
