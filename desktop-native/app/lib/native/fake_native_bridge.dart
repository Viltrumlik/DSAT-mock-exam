// FakeNativeBridge — deterministic NativeBridge for tests and macOS fixture mode.
//  * precheck: a clean machine (configurable apps/displays/vm);
//  * prove: a REAL HMAC-SHA256 over the proof crate's message format with a fixed test key,
//    so a fake server can verify it (still refuses when not locked, like the DLL);
//  * heartbeat true while locked (counted), away false (settable);
//  * battery 87 % charging; PKCE: fixed verifier with a correct S256 challenge;
//  * seal/open: identity; protect/unprotect: base64 (visible, reversible, never secret).
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import 'native_bridge.dart';

class FakeNativeBridge implements NativeBridge {
  FakeNativeBridge({
    this.appVersion = '0.2.0',
    this.keyId = 'k-test',
    this.secretHex = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    List<BlockedApp> apps = const [],
    this.displays = 1,
    this.vm = false,
    this.remote = false,
  }) : apps = List.of(apps);

  final String appVersion;
  final String keyId;
  final String secretHex;
  List<BlockedApp> apps;
  int displays;
  bool vm;
  bool remote;

  /// What [awayNow] answers (tests flip it).
  bool away = false;

  /// What [battery] answers.
  BatteryStatus? batteryStatus = const BatteryStatus(percent: 87, charging: true, hasBattery: true);

  /// Simulate the watchdog releasing the lock (heartbeat then reports false).
  bool watchdogReleased = false;

  bool locked = false;

  /// How often [heartbeat] was called (the lockdown's liveness ping).
  int heartbeats = 0;
  bool keptAwake = false;
  String? registeredExe;
  String? _captured;
  final List<String> calls = [];

  static const proofVersion = 'mastersat-lockdown-v1';
  static const fixedVerifier = 'fake-verifier-0123456789abcdefghijklmnopqrstuvwxyzABCD';

  /// The exact message proof::sign MACs (proof/lib.rs proof_message).
  static String proofMessage(int attemptId, String nonce, String appVersion, String precheck) =>
      '$proofVersion\n$attemptId\n$nonce\n$appVersion\n$precheck';

  /// HMAC-SHA256 hex of [proofMessage] under [secretHex] — proof::sign, byte for byte.
  static String sign(String secretHex, int attemptId, String nonce, String appVersion, String precheck) =>
      Hmac(sha256, _hex(secretHex)).convert(utf8.encode(proofMessage(attemptId, nonce, appVersion, precheck))).toString();

  /// RFC 7636 S256, as proof::pkce_challenge.
  static String pkceChallenge(String verifier) =>
      base64Url.encode(sha256.convert(ascii.encode(verifier)).bytes).replaceAll('=', '');

  String _precheckJson() => jsonEncode({
        'ok': apps.isEmpty && displays == 1 && !vm && !remote,
        'displays': displays,
        'remote': remote,
        'vm': vm,
        'apps': [for (final a in apps) a.toJson()],
      });

  @override
  String get libraryVersion => 'fake-$appVersion';

  @override
  void registerProtocol(String exePath) {
    calls.add('registerProtocol');
    registeredExe = exePath;
  }

  @override
  Future<LegacyUninstall> uninstallLegacy() async {
    calls.add('uninstallLegacy');
    return const LegacyUninstall(found: false, ran: false);
  }

  @override
  PrecheckReport precheck() {
    calls.add('precheck');
    return PrecheckReport.parse(_precheckJson());
  }

  @override
  void closeApp(String exe) {
    calls.add('closeApp $exe');
    final i = apps.indexWhere((a) => a.exe.toLowerCase() == exe.toLowerCase());
    if (i < 0) throw NativeBridgeException(NativeStatus.errNotFound, 'ms_close_app', '$exe is not running');
    if (!apps[i].closable) throw NativeBridgeException(NativeStatus.errArg, 'ms_close_app', '$exe cannot be closed');
    apps.removeAt(i);
  }

  @override
  PrecheckReport lockEnter() {
    calls.add('lockEnter');
    final raw = _precheckJson();
    final report = PrecheckReport.parse(raw);
    if (!report.ok) throw NativeBridgeException(NativeStatus.errPrecheck, 'ms_lock_enter', raw);
    locked = true;
    watchdogReleased = false;
    _captured = raw;
    return report;
  }

  @override
  void lockExit() {
    calls.add('lockExit');
    locked = false;
    _captured = null;
  }

  @override
  bool heartbeat() {
    heartbeats++;
    if (watchdogReleased) {
      locked = false;
      _captured = null;
    }
    return locked;
  }

  @override
  bool awayNow() => away;

  @override
  BatteryStatus? battery() => batteryStatus;

  @override
  LockdownProof prove({required int attemptId, required String nonce}) {
    calls.add('prove $attemptId');
    final precheck = _captured;
    if (!locked || precheck == null) {
      throw const NativeBridgeException(NativeStatus.errNotLocked, 'ms_prove', 'The app is not locked down.');
    }
    final mac = sign(secretHex, attemptId, nonce, appVersion, precheck);
    return LockdownProof(keyId: keyId, mac: mac, appVersion: appVersion, precheck: precheck);
  }

  @override
  PkcePair pkceNew() => PkcePair(verifier: fixedVerifier, challenge: pkceChallenge(fixedVerifier));

  @override
  Uint8List seal(Uint8List plain) => Uint8List.fromList(plain);

  @override
  Uint8List open(Uint8List sealed) => Uint8List.fromList(sealed);

  @override
  Uint8List protect(Uint8List plain) => Uint8List.fromList(utf8.encode(base64.encode(plain)));

  @override
  Uint8List unprotect(Uint8List blob) {
    try {
      return base64.decode(utf8.decode(blob));
    } on FormatException catch (e) {
      throw NativeBridgeException(NativeStatus.errCrypto, 'ms_unprotect', e.message);
    }
  }

  @override
  String proxyFor(String url) => 'DIRECT';

  @override
  void keepAwake(bool on) {
    calls.add('keepAwake $on');
    keptAwake = on;
  }

  /// What [updateCheck] answers.
  UpdateInfo update = const UpdateInfo(available: false);
  bool applied = false;

  @override
  Future<UpdateInfo> updateCheck({required String feedUrl, required String channel}) async {
    calls.add('updateCheck $channel');
    return update;
  }

  @override
  Future<void> updateDownload({void Function(int percent)? onProgress}) async {
    calls.add('updateDownload');
    for (final p in const [0, 25, 50, 75, 100]) {
      onProgress?.call(p);
      await Future<void>.value();
    }
  }

  @override
  void updateApplyRestart() {
    calls.add('updateApplyRestart');
    applied = true;
  }

  static Uint8List _hex(String hex) {
    final out = Uint8List(hex.length ~/ 2);
    for (var i = 0; i < out.length; i++) {
      out[i] = int.parse(hex.substring(i * 2, i * 2 + 2), radix: 16);
    }
    return out;
  }
}
