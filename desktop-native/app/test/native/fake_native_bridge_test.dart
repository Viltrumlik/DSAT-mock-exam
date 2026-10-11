import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';
import 'package:mastersat_app/native/native_bridge.dart';

void main() {
  test('precheck JSON is deterministic and parses', () {
    final b = FakeNativeBridge();
    final r = b.precheck();
    expect(r.raw, '{"ok":true,"displays":1,"remote":false,"vm":false,"apps":[]}');
    expect(r.ok, isTrue);
  });

  test('lock: refuses a dirty machine; prove only while locked; signs the captured precheck', () {
    final b = FakeNativeBridge(apps: const [BlockedApp(exe: 'telegram.exe', name: 'Telegram', closable: true)]);
    expect(() => b.lockEnter(), throwsA(isA<NativeBridgeException>().having((e) => e.code, 'code', NativeStatus.errPrecheck)));
    expect(() => b.prove(attemptId: 5521, nonce: 'n'),
        throwsA(isA<NativeBridgeException>().having((e) => e.code, 'code', NativeStatus.errNotLocked)));
    b.closeApp('telegram.exe');
    final captured = b.lockEnter();
    expect(b.heartbeat(), isTrue);
    final proof = b.prove(attemptId: 5521, nonce: 'n0nce');
    expect(proof.precheck, captured.raw);
    // The MAC is HMAC-SHA256(key, proof message) — the proof crate's exact format.
    final expected = Hmac(sha256, List.generate(32, (i) => int.parse(b.secretHex.substring(i * 2, i * 2 + 2), radix: 16)))
        .convert(utf8.encode('mastersat-lockdown-v1\n5521\nn0nce\n0.2.0\n${captured.raw}'));
    expect(proof.mac, expected.toString());
    final body = proof.toSessionRequest('n0nce').toJson();
    expect(body.keys, containsAll(['nonce', 'key_id', 'mac', 'app_version', 'precheck']));
    b.watchdogReleased = true;
    expect(b.heartbeat(), isFalse);
    expect(() => b.prove(attemptId: 5521, nonce: 'n'), throwsA(isA<NativeBridgeException>()));
  });

  test('sign matches the proof crate / server shared vector', () {
    // desktop/src-tauri/crates/proof/src/lib.rs hmac_matches_the_shared_vector.
    expect(
      FakeNativeBridge.sign('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 42, 'nonce-abc', '0.1.0',
          '{"displays":1}'),
      '52b830843519923e56ce8086c59a9c20fe78e41d659bcb2d7bcf6dbd6a3ce18c',
    );
  });

  test('pkce challenge is S256 of the verifier', () {
    final p = FakeNativeBridge().pkceNew();
    // RFC 7636 appendix B vector.
    expect(FakeNativeBridge.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
        'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(p.challenge, FakeNativeBridge.pkceChallenge(p.verifier));
  });

  test('seal/open identity, protect/unprotect base64, proxy DIRECT, battery, away', () {
    final b = FakeNativeBridge();
    final data = Uint8List.fromList([1, 2, 3, 250]);
    expect(b.open(b.seal(data)), data);
    expect(utf8.decode(b.protect(data)), base64.encode(data));
    expect(b.unprotect(b.protect(data)), data);
    expect(b.proxyFor('https://mastersat.uz/api/desktop/v1/home'), 'DIRECT');
    expect(b.battery()!.percent, 87);
    expect(BatteryStatus.parse('null'), isNull);
    expect(b.awayNow(), isFalse);
    b.away = true;
    expect(b.awayNow(), isTrue);
  });

  test('update flow reports progress', () async {
    final b = FakeNativeBridge()..update = const UpdateInfo(available: true, version: '0.3.0');
    final info = await b.updateCheck(feedUrl: 'https://mastersat.uz/downloads/desktop/', channel: 'beta');
    expect(info.version, '0.3.0');
    final seen = <int>[];
    await b.updateDownload(onProgress: seen.add);
    expect(seen.last, 100);
    b.updateApplyRestart();
    expect(b.applied, isTrue);
  });

  test('parsers match the header JSON shapes', () {
    expect(UpdateInfo.parse('{"available":true,"version":"0.3.0","is_delta":true,"bytes":1234}').isDelta, isTrue);
    expect(LegacyUninstall.parse('{"found":true,"ran":true,"exit_code":0}').exitCode, 0);
    expect(LockdownProof.parse('{"key_id":"k","mac":"ab","app_version":"0.2.0","precheck":"{}"}').precheck, '{}');
    expect(PrecheckReport.parse('{"ok":false,"displays":2,"remote":false,"vm":true,"apps":[{"exe":"zoom.exe","name":"Zoom","closable":true}]}')
        .apps.single.name, 'Zoom');
  });
}
