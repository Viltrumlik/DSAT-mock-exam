// FfiNativeBridge against the REAL library (libmastersat_native.dylib on a developer's Mac,
// mastersat_native.dll on Windows CI), through dart:ffi exactly as the app calls it.
//
//   cargo build --manifest-path desktop-native/native/Cargo.toml   # debug: embeds the dev key
//   cd desktop-native/app && flutter test test/native/ffi_native_bridge_test.dart
//
// Without a built library the library-backed tests are SKIPPED (reported as skipped, with the
// command to build it); set MASTERSAT_NATIVE_REQUIRE=1 (CI) to make a missing library a failure.
// The proof vector is the server's: backend/desktop/proof.py sign(...) over the pre-check this
// library captures on a development host.
@TestOn('vm')
library;

import 'dart:convert';
import 'dart:ffi';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:ffi/ffi.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';
import 'package:mastersat_app/native/ffi_native_bridge.dart';
import 'package:mastersat_app/native/native_bridge.dart';

/// The proof crate's / server's test key (DEV_KEY in the crate; ProofVectorTests on the server).
const keyHex = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

/// lockdown.rs's non-Windows pre-check, serialised — what ms_lock_enter captures on a dev host.
const stubPrecheck = '{"ok":true,"displays":1,"remote":false,"vm":false,"apps":[]}';

/// backend/desktop/proof.py sign(secret_hex=keyHex, attempt_id=42, nonce="nonce-abc",
/// app_version="0.1.0", precheck=stubPrecheck) — the same value tests/c_abi.rs pins.
const stubPrecheckMac = 'cecfe068104a80099c84ae7b2263772237603a08f672fc69337534b0899b5813';

/// The shared vector 52b83084… (proof crate, proof.py, FakeNativeBridge): precheck {"displays":1}.
const sharedVectorMac = '52b830843519923e56ce8086c59a9c20fe78e41d659bcb2d7bcf6dbd6a3ce18c';

/// The app version this process signs with: the first ms_init wins, and [FfiNativeBridge.open]
/// makes it on a development host.
const appVersion = '0.1.0';

Matcher throwsNative(int code, [String? messageStart]) => throwsA(
  isA<NativeBridgeException>()
      .having((e) => e.code, 'code', code)
      .having((e) => e.message ?? '', 'message', messageStart == null ? anything : startsWith(messageStart)),
);

String hmacHex(String message) {
  final key = [for (var i = 0; i < keyHex.length; i += 2) int.parse(keyHex.substring(i, i + 2), radix: 16)];
  return Hmac(sha256, key).convert(utf8.encode(message)).toString();
}

/// Set an environment variable in THIS process (Rust reads it with getenv /
/// GetEnvironmentVariableW), so the data key lands in a temporary folder, never the developer's.
void setProcessEnv(String name, String value) {
  if (Platform.isWindows) {
    final set = DynamicLibrary.open('kernel32.dll')
        .lookupFunction<Int32 Function(Pointer<Utf16>, Pointer<Utf16>), int Function(Pointer<Utf16>, Pointer<Utf16>)>(
          'SetEnvironmentVariableW',
        );
    final ok = using((a) => set(name.toNativeUtf16(allocator: a), value.toNativeUtf16(allocator: a)));
    if (ok == 0) throw StateError('SetEnvironmentVariableW($name) failed');
  } else {
    final set = DynamicLibrary.process()
        .lookupFunction<
          Int32 Function(Pointer<Utf8>, Pointer<Utf8>, Int32),
          int Function(Pointer<Utf8>, Pointer<Utf8>, int)
        >('setenv');
    final rc = using((a) => set(name.toNativeUtf8(allocator: a), value.toNativeUtf8(allocator: a), 1));
    if (rc != 0) throw StateError('setenv($name) failed');
  }
}

void main() {
  group('NativeLibraryLocation', () {
    test('Windows: the module the runner loaded comes first, even before an override', () {
      final c = NativeLibraryLocation.candidates(
        operatingSystem: 'windows',
        environment: {'MASTERSAT_NATIVE_LIB': r'C:\dev\other.dll'},
        executable: r'C:\Users\s\AppData\Local\MasterSAT\current\MasterSAT.exe',
        currentDirectory: r'C:\src\desktop-native\app',
      );
      expect(c.first, 'mastersat_native.dll');
      expect(c[1], r'C:\dev\other.dll');
      expect(c, contains(r'C:\src\desktop-native\app\..\native\target\debug\mastersat_native.dll'));
    });

    test('macOS: the override, then the bundle Frameworks, then cargo debug before release', () {
      final c = NativeLibraryLocation.candidates(
        operatingSystem: 'macos',
        environment: {'MASTERSAT_NATIVE_LIB': '/x/libmastersat_native.dylib'},
        executable: '/Apps/MasterSAT.app/Contents/MacOS/mastersat_app',
        currentDirectory: '/src/desktop-native/app',
      );
      expect(c.take(4), [
        '/x/libmastersat_native.dylib',
        '/Apps/MasterSAT.app/Contents/Frameworks/libmastersat_native.dylib',
        '/src/desktop-native/app/../native/target/debug/libmastersat_native.dylib',
        '/src/desktop-native/app/../native/target/release/libmastersat_native.dylib',
      ]);
      final noOverride = NativeLibraryLocation.candidates(
        operatingSystem: 'macos',
        environment: const {},
        executable: '/a/b/c',
        currentDirectory: '/w',
      );
      expect(noOverride.first, '/a/Frameworks/libmastersat_native.dylib');
    });

    test('a missing library is a typed error listing every path tried', () {
      expect(
        () => FfiNativeBridge.open(libraryPath: '/nonexistent/libmastersat_native.dylib'),
        throwsA(
          isA<NativeLibraryUnavailable>().having((e) => e.attempts.single, 'attempt', startsWith('/nonexistent/')),
        ),
      );
    });
  });

  // ── the real library ─────────────────────────────────────────────────────────────────────

  final dataDir = Directory.systemTemp.createTempSync('mastersat-ffi-');
  setProcessEnv('MASTERSAT_DATA_DIR', dataDir.path);

  FfiNativeBridge? opened;
  String? skip;
  try {
    opened = FfiNativeBridge.open(devAppVersion: appVersion);
  } on NativeLibraryUnavailable catch (e) {
    if (Platform.environment['MASTERSAT_NATIVE_REQUIRE'] == '1') rethrow;
    skip =
        'mastersat_native is not built — run `cargo build --manifest-path desktop-native/native/Cargo.toml` '
        '(tried ${e.attempts.length} paths)';
  }

  tearDownAll(() {
    try {
      dataDir.deleteSync(recursive: true);
    } on FileSystemException {
      // best effort
    }
  });

  group('FfiNativeBridge (real library)', skip: skip, () {
    late final FfiNativeBridge b = opened!;

    test('every function of the header is exported, and the version is the crate\'s', () {
      final header = File('../native/include/mastersat_native.h').readAsStringSync();
      final names = RegExp(r'MS_API[^;]*?\b(ms_\w+)\s*\(').allMatches(header).map((m) => m.group(1)!).toList();
      expect(names, hasLength(27));
      final lib = DynamicLibrary.open(b.libraryPath);
      for (final n in names) {
        expect(lib.providesSymbol(n), isTrue, reason: n);
      }
      final cargo = File('../native/crates/mastersat-native/Cargo.toml').readAsStringSync();
      final version = RegExp(r'^version = "([^"]+)"', multiLine: true).firstMatch(cargo)!.group(1);
      expect(b.libraryVersion, version);
    });

    test('PKCE: fresh 32-byte verifiers with their RFC 7636 S256 challenge', () {
      final p1 = b.pkceNew();
      final p2 = b.pkceNew();
      expect(p1.verifier, hasLength(43));
      expect(p1.verifier, matches(RegExp(r'^[A-Za-z0-9_-]{43}$')));
      expect(p1.verifier, isNot(p2.verifier));
      // Independent S256 (package:crypto) and the fake's (checked against the RFC vector).
      final s256 = base64Url.encode(sha256.convert(ascii.encode(p1.verifier)).bytes).replaceAll('=', '');
      expect(p1.challenge, s256);
      expect(p2.challenge, FakeNativeBridge.pkceChallenge(p2.verifier));
      expect(
        FakeNativeBridge.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
        'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      );
    });

    test('proof: refused unlocked; signs the captured pre-check with the server\'s vector', () {
      expect(() => b.prove(attemptId: 42, nonce: 'nonce-abc'), throwsNative(NativeStatus.errNotLocked, 'ms_prove: '));

      final PrecheckReport captured;
      try {
        captured = b.lockEnter();
      } on NativeBridgeException catch (e) {
        if (Platform.isWindows && e.code == NativeStatus.errNotInit) {
          markTestSkipped('Windows without the runner: ms_init is the runner\'s call');
          return;
        }
        if (Platform.isWindows && e.code == NativeStatus.errPrecheck) {
          expect(PrecheckReport.parse(e.message!).ok, isFalse, reason: 'the refusal carries the failing report');
          markTestSkipped('this Windows machine fails the pre-check; the locked path is not exercised');
          return;
        }
        rethrow;
      }
      addTearDown(b.lockExit);
      if (!Platform.isWindows) expect(captured.raw, stubPrecheck);
      expect(captured.ok, isTrue);
      expect(b.heartbeat(), isTrue);

      final proof = b.prove(attemptId: 42, nonce: 'nonce-abc');
      expect(proof.keyId, 'dev1', reason: 'debug builds embed the development key');
      expect(proof.appVersion, appVersion);
      expect(proof.precheck, captured.raw, reason: 'the captured string, verbatim');
      if (captured.raw == stubPrecheck) expect(proof.mac, stubPrecheckMac, reason: 'backend/desktop/proof.py');
      // Independent HMAC, and the fake bridge's signer, agree with the library byte for byte.
      expect(proof.mac, hmacHex('mastersat-lockdown-v1\n42\nnonce-abc\n$appVersion\n${captured.raw}'));
      expect(proof.mac, FakeNativeBridge.sign(keyHex, 42, 'nonce-abc', appVersion, captured.raw));
      expect(FakeNativeBridge.sign(keyHex, 42, 'nonce-abc', '0.1.0', '{"displays":1}'), sharedVectorMac);
      expect(
        proof.toSessionRequest('nonce-abc').toJson().keys,
        containsAll(['nonce', 'key_id', 'mac', 'app_version', 'precheck']),
      );

      b.lockExit();
      expect(b.heartbeat(), isFalse);
      expect(() => b.prove(attemptId: 42, nonce: 'nonce-abc'), throwsNative(NativeStatus.errNotLocked));
      b.lockExit(); // safe when not locked
    });

    test('seal/open: AES-256-GCM round trips; any altered byte is refused', () {
      for (final plain in [
        Uint8List(0),
        Uint8List.fromList([7]),
        Uint8List.fromList(utf8.encode('{"answers":{"101":"B"},"name":"Maşa"}')),
        Uint8List(70000)..fillRange(0, 70000, 9),
      ]) {
        final sealed = b.seal(plain);
        expect(sealed.length, 12 + plain.length + 16, reason: 'nonce || ciphertext || tag');
        expect(b.open(sealed), plain);
        final bad = Uint8List.fromList(sealed)..[sealed.length - 1] ^= 0x80;
        expect(() => b.open(bad), throwsNative(NativeStatus.errCrypto, 'ms_open: '));
      }
      expect(b.seal(Uint8List.fromList([1, 2])), isNot(b.seal(Uint8List.fromList([1, 2]))), reason: 'fresh nonces');
      expect(() => b.open(Uint8List.fromList([1, 2, 3])), throwsNative(NativeStatus.errCrypto));
      final key = File('${dataDir.path}${Platform.pathSeparator}key.bin');
      expect(key.existsSync(), isTrue, reason: 'the data key lives in MASTERSAT_DATA_DIR');
      if (!Platform.isWindows) expect(key.lengthSync(), 32, reason: 'dev hosts: raw key (Windows: a DPAPI blob)');
    });

    test('protect/unprotect: DPAPI on Windows, unsupported elsewhere', () {
      final token = Uint8List.fromList(utf8.encode('refresh-token-abc'));
      if (Platform.isWindows) {
        final blob = b.protect(token);
        expect(blob, isNot(token));
        expect(b.unprotect(blob), token);
        expect(() => b.unprotect(Uint8List.fromList([1, 2, 3])), throwsNative(NativeStatus.errCrypto));
      } else {
        expect(() => b.protect(token), throwsNative(NativeStatus.errUnsupported, 'ms_protect: '));
        expect(() => b.unprotect(token), throwsNative(NativeStatus.errUnsupported));
      }
    });

    test('pre-check, battery, away, keep-awake, proxy, close-app, protocol', () {
      final report = b.precheck();
      expect(jsonDecode(report.raw), isA<Map<String, Object?>>());
      expect(() => b.proxyFor('not a url'), throwsNative(NativeStatus.errArg, 'ms_proxy_for: '));
      b.keepAwake(true);
      b.keepAwake(false);
      if (Platform.isWindows) return; // the rest are the development host's documented stubs
      expect(report.raw, stubPrecheck);
      expect(b.battery(), isNull);
      expect(b.awayNow(), isFalse);
      expect(b.proxyFor('https://mastersat.uz/api/desktop/v1/home'), 'DIRECT');
      expect(() => b.closeApp('telegram.exe'), throwsNative(NativeStatus.errNotFound));
      expect(() => b.registerProtocol('/Applications/MasterSAT.app'), throwsNative(NativeStatus.errUnsupported));
    });

    test('slow calls run on a background isolate against the same module', () async {
      if (!Platform.isWindows) {
        final legacy = await b.uninstallLegacy();
        expect((legacy.found, legacy.ran, legacy.exitCode), (false, false, null));
      }
      // Not a Velopack-installed copy: the check is unsupported — and the error crosses the isolate.
      await expectLater(
        b.updateCheck(feedUrl: 'http://127.0.0.1:9/downloads/desktop/', channel: 'stable'),
        throwsNative(NativeStatus.errUnsupported, 'ms_update_check: '),
      );
      await expectLater(
        b.updateCheck(feedUrl: 'http://127.0.0.1:9/downloads/desktop/', channel: '../x'),
        throwsNative(NativeStatus.errArg),
      );
      final seen = <int>[];
      await expectLater(
        b.updateDownload(onProgress: seen.add),
        throwsA(
          isA<NativeBridgeException>().having(
            (e) => e.code,
            'code',
            anyOf(NativeStatus.errNotFound, NativeStatus.errUnsupported),
          ),
        ),
      );
      expect(seen, isEmpty, reason: 'no progress for a download that never started');
      expect(
        b.updateApplyRestart,
        throwsA(
          isA<NativeBridgeException>().having(
            (e) => e.code,
            'code',
            anyOf(NativeStatus.errNotFound, NativeStatus.errUnsupported),
          ),
        ),
      );
    });
  });
}
