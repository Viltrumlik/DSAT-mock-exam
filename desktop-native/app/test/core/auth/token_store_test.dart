// Tokens at rest: sealed through NativeBridge.protect (DPAPI on Windows) into auth.bin, never
// plain JSON on disk; anything unreadable means "sign in again".
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/auth/session.dart';
import 'package:mastersat_app/core/auth/token_store.dart';
import 'package:mastersat_app/core/store/app_paths.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';

import '../harness/app_harness.dart' show fakeJwt;

void main() {
  late Directory dir;
  late AppPaths paths;
  late TokenStore store;
  final now = DateTime.utc(2026, 10, 11, 9);
  final s = AuthSession(
    access: fakeJwt(expires: now.add(const Duration(hours: 3))),
    refresh: 'refresh-token-value',
    obtainedAt: now,
    userId: 77,
    displayName: 'Aziza Karimova',
  );

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('ms-auth-');
    paths = AppPaths(dir.path);
    store = TokenStore.at(paths, FakeNativeBridge());
  });
  tearDown(() => dir.delete(recursive: true));

  test('auth.bin round-trips the session and is not plain JSON', () async {
    expect(await store.read(), isNull);
    await store.write(s);
    final raw = await paths.authFile.readAsBytes();
    expect(utf8.decode(raw, allowMalformed: true), isNot(contains('refresh-token-value')));
    final back = (await store.read())!;
    expect(back.toJson(), s.toJson());
    expect(back.accessExpiresAt, now.add(const Duration(hours: 3)));
    await store.clear();
    expect(await store.read(), isNull);
    expect(paths.authFile.existsSync(), isFalse);
  });

  test('a file that cannot be opened (corrupt, another user, old format) reads as signed out', () async {
    await paths.authFile.writeAsString('not sealed at all');
    expect(await store.read(), isNull);
    await paths.authFile.writeAsBytes(utf8.encode(base64.encode(utf8.encode(jsonEncode({'v': 99, ...s.toJson()})))));
    expect(await store.read(), isNull, reason: 'unknown version');
    await paths.authFile.writeAsBytes(utf8.encode(base64.encode(utf8.encode('{"v":1}'))));
    expect(await store.read(), isNull, reason: 'missing fields');
  });

  test('the pending browser sign-in is kept the same way in signin.bin', () async {
    final p = PendingSignIn(verifier: FakeNativeBridge.fixedVerifier, challenge: 'ch', startedAt: now);
    await store.writePending(p);
    expect(paths.pendingSignInFile.readAsStringSync(), isNot(contains(FakeNativeBridge.fixedVerifier)));
    final back = (await store.readPending())!;
    expect(back.verifier, p.verifier);
    expect(back.isExpired(now.add(const Duration(minutes: 9))), isFalse);
    expect(back.isExpired(now.add(const Duration(minutes: 11))), isTrue);
    await store.clearPending();
    expect(await store.readPending(), isNull);
  });

  group('Jwt / AuthSession', () {
    test('reads exp and user_id; anything else is null', () {
      final t = fakeJwt(expires: DateTime.utc(2026, 10, 11, 12), userId: 5);
      expect(Jwt.expiry(t), DateTime.utc(2026, 10, 11, 12));
      expect(Jwt.userId(t), 5);
      expect(Jwt.payload('opaque'), isNull);
      expect(Jwt.payload('a.b.c'), isNull);
      expect(Jwt.expiry('a.b.c'), isNull);
    });

    test('a token without a readable exp is assumed to live 3 h from when it was issued', () {
      final opaque = AuthSession(access: 'opaque', refresh: 'r', obtainedAt: now);
      expect(opaque.accessExpiresAt, now.add(const Duration(hours: 3)));
    });
  });
}
