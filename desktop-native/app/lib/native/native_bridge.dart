// NativeBridge — mastersat_native.dll in Dart terms (native/include/mastersat_native.h).
//
// Implementations:
//  * FfiNativeBridge  (rust workstream, lib/native/ffi_native_bridge.dart) — dart:ffi over the
//                     header; on Windows it opens the DLL the runner already loaded.
//  * FakeNativeBridge (this folder) — deterministic, for tests and macOS fixture mode.
//
// ms_startup / ms_init are called by the Windows runner in C++; on macOS (no runner) the FFI
// bridge calls them when it opens the library.
// Every method throws [NativeBridgeException] on a non-OK status. Calls are synchronous
// (FFI); the few slow ones are Futures and run off the UI isolate.
import 'dart:convert';
import 'dart:typed_data';

import '../core/models/misc.dart';

/// Status codes (MS_* in the header).
abstract final class NativeStatus {
  static const ok = 0;
  static const errArg = -1;
  static const errNotInit = -2;
  static const errNotLocked = -3;
  static const errPrecheck = -4;
  static const errCrypto = -5;
  static const errOs = -6;
  static const errUnsupported = -7;
  static const errNoKey = -8;
  static const errNotFound = -9;
  static const errBusy = -10;
  static const errPanic = -99;
}

class NativeBridgeException implements Exception {
  const NativeBridgeException(this.code, this.function, [this.message]);

  /// One of [NativeStatus].
  final int code;
  final String function;

  /// `ms_last_error()` text, when available.
  final String? message;

  @override
  String toString() => 'NativeBridgeException($function: $code${message == null ? '' : ', $message'})';
}

/// A program the pre-check says must be closed.
class BlockedApp {
  const BlockedApp({required this.exe, required this.name, required this.closable});

  factory BlockedApp.fromJson(Map<String, Object?> j) =>
      BlockedApp(exe: j['exe']! as String, name: j['name']! as String, closable: j['closable']! as bool);

  final String exe;
  final String name;
  final bool closable;

  Map<String, Object?> toJson() => {'exe': exe, 'name': name, 'closable': closable};
}

/// `lockdown::precheck()`. [raw] is the exact JSON string (signed byte-for-byte — never
/// re-serialise it).
class PrecheckReport {
  const PrecheckReport({
    required this.ok,
    required this.displays,
    required this.remote,
    required this.vm,
    required this.apps,
    required this.raw,
  });

  factory PrecheckReport.parse(String raw) {
    final j = (jsonDecode(raw) as Map).cast<String, Object?>();
    return PrecheckReport(
      ok: j['ok']! as bool,
      displays: (j['displays']! as num).toInt(),
      remote: j['remote']! as bool,
      vm: j['vm']! as bool,
      apps: [for (final a in j['apps']! as List) BlockedApp.fromJson((a as Map).cast<String, Object?>())],
      raw: raw,
    );
  }

  final bool ok;
  final int displays;
  final bool remote;
  final bool vm;
  final List<BlockedApp> apps;
  final String raw;
}

/// `lockdown::battery()`.
class BatteryStatus {
  const BatteryStatus({this.percent, required this.charging, required this.hasBattery});

  /// Null when Windows does not know; returns null for the JSON literal `null`.
  static BatteryStatus? parse(String raw) {
    final j = jsonDecode(raw);
    if (j == null) return null;
    final m = (j as Map).cast<String, Object?>();
    return BatteryStatus(
      percent: (m['percent'] as num?)?.toInt(),
      charging: m['charging']! as bool,
      hasBattery: m['has_battery']! as bool,
    );
  }

  final int? percent;
  final bool charging;
  final bool hasBattery;

  /// The website's low-battery rule is the runner's business; this is just the reading.
  bool get onBattery => hasBattery && !charging;
}

/// `ms_prove` output — the desktop_session body minus the nonce.
class LockdownProof {
  const LockdownProof({required this.keyId, required this.mac, required this.appVersion, required this.precheck});

  factory LockdownProof.parse(String raw) {
    final j = (jsonDecode(raw) as Map).cast<String, Object?>();
    return LockdownProof(
      keyId: j['key_id']! as String,
      mac: j['mac']! as String,
      appVersion: j['app_version']! as String,
      precheck: j['precheck']! as String,
    );
  }

  final String keyId;
  final String mac;
  final String appVersion;

  /// The precheck captured at lock time, verbatim.
  final String precheck;

  LockdownSessionRequest toSessionRequest(String nonce) =>
      LockdownSessionRequest(nonce: nonce, keyId: keyId, mac: mac, appVersion: appVersion, precheck: precheck);
}

/// `ms_pkce_new`.
class PkcePair {
  const PkcePair({required this.verifier, required this.challenge});
  final String verifier;

  /// base64url(sha256(verifier)), no padding (S256).
  final String challenge;
}

/// `ms_update_check`.
class UpdateInfo {
  const UpdateInfo({required this.available, this.version, this.isDelta = false, this.bytes});

  factory UpdateInfo.parse(String raw) {
    final j = (jsonDecode(raw) as Map).cast<String, Object?>();
    return UpdateInfo(
      available: j['available']! as bool,
      version: j['version'] as String?,
      isDelta: (j['is_delta'] as bool?) ?? false,
      bytes: (j['bytes'] as num?)?.toInt(),
    );
  }

  final bool available;
  final String? version;
  final bool isDelta;
  final int? bytes;
}

/// `ms_uninstall_legacy`.
class LegacyUninstall {
  const LegacyUninstall({required this.found, required this.ran, this.exitCode});

  factory LegacyUninstall.parse(String raw) {
    final j = (jsonDecode(raw) as Map).cast<String, Object?>();
    return LegacyUninstall(
      found: j['found']! as bool,
      ran: j['ran']! as bool,
      exitCode: (j['exit_code'] as num?)?.toInt(),
    );
  }

  final bool found;
  final bool ran;
  final int? exitCode;
}

/// The native library, in Dart terms. One method per `ms_*` call Dart makes.
abstract class NativeBridge {
  /// `ms_version`.
  String get libraryVersion;

  /// `ms_register_protocol` — rewrite `mastersat://` → this exe (every launch).
  void registerProtocol(String exePath);

  /// `ms_uninstall_legacy` — remove the 0.1.x Tauri install (first run). Slow.
  Future<LegacyUninstall> uninstallLegacy();

  // ---- lockdown ---------------------------------------------------------------------------

  /// `ms_precheck_json_ex` (pre-check screen). [strict] = a midterm's pre-check (one window,
  /// one app): every other program with a window a student could switch to is listed too.
  PrecheckReport precheck({bool strict = false});

  /// `ms_close_app` — close one listed program.
  void closeApp(String exe);

  /// `ms_lock_enter` — throws [NativeBridgeException] with [NativeStatus.errPrecheck] (and the
  /// failing report in the message) when the machine is not ready. Returns the captured
  /// precheck that [prove] will sign. [strict] = a midterm's lock (`MS_LOCK_STRICT`): the strict
  /// pre-check, plus the foreground guard and the extra keys while locked.
  PrecheckReport lockEnter({bool strict = false});

  /// `ms_lock_exit` (safe when not locked).
  void lockExit();

  /// `ms_heartbeat` — true while locked; false once released (watchdog or exit).
  bool heartbeat();

  /// `ms_away_now` — foreground is not ours, or more than one monitor.
  bool awayNow();

  /// `ms_battery_json` (null when unknown).
  BatteryStatus? battery();

  /// `ms_prove` — only while locked.
  LockdownProof prove({required int attemptId, required String nonce});

  // ---- sign-in ----------------------------------------------------------------------------

  /// `ms_pkce_new`.
  PkcePair pkceNew();

  // ---- data at rest -----------------------------------------------------------------------

  /// `ms_seal` / `ms_open` — AES-256-GCM with the DPAPI-wrapped data key.
  Uint8List seal(Uint8List plain);
  Uint8List open(Uint8List sealed);

  /// `ms_protect` / `ms_unprotect` — DPAPI current user (tokens).
  Uint8List protect(Uint8List plain);
  Uint8List unprotect(Uint8List blob);

  // ---- network and power ------------------------------------------------------------------

  /// `ms_proxy_for` — HttpClient.findProxy format ("DIRECT" / "PROXY host:port; …").
  /// Synchronous on purpose (findProxy is synchronous); cached per host in the DLL.
  String proxyFor(String url);

  /// `ms_keep_awake`.
  void keepAwake(bool on);

  // ---- updates ----------------------------------------------------------------------------

  /// `ms_update_check`.
  Future<UpdateInfo> updateCheck({required String feedUrl, required String channel});

  /// `ms_update_download`, reporting `ms_update_progress` (0–100) while it runs.
  Future<void> updateDownload({void Function(int percent)? onProgress});

  /// `ms_update_apply_restart` (does not return on success; Home only).
  void updateApplyRestart();
}
