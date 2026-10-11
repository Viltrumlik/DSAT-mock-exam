// MasterSAT for Windows — the native client's entry point.
//
//   flutter run -d windows                                  in-process fixtures (debug default)
//   flutter run -d macos --dart-define=MASTERSAT_API_BASE=http://127.0.0.1:8765
//                                                           the local fixture server
//                                                           (dart run tool/fixture_server)
//   flutter build windows --release                         https://mastersat.uz
//
// Start-up order (architecture §2.3 "no splash screen"): read auth.bin → open the student's
// database and read the cached Home → runApp (the first frame already shows Home) → one
// conditional `GET home`. The Windows runner shows the window only after that first frame.
//
// The integrator wires the real native library and the exam runner through [runMasterSat]:
//   runMasterSat(native: FfiNativeBridge.open(), examLauncher: openRunner)
import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:url_launcher/url_launcher.dart';

import 'app.dart';
import 'core/api/fixture_v1_api.dart';
import 'core/api/http_v1_api.dart';
import 'core/api/v1_api.dart';
import 'core/auth/auth_controller.dart';
import 'core/auth/dev_sign_in.dart';
import 'core/auth/launch_links.dart';
import 'core/auth/token_store.dart';
import 'core/clock/clock.dart';
import 'core/diagnostics/diagnostics.dart';
import 'core/http/api_config.dart';
import 'core/http/http_transport.dart';
import 'core/http/proxy.dart';
import 'core/store/app_paths.dart';
import 'core/store/settings_store.dart';
import 'core/store/unsent_work.dart';
import 'core/store/user_store.dart';
import 'core/store/window_placement_sync.dart';
import 'core/theme/toast.dart';
import 'features/home/home_controller.dart';
import 'features/home/update_controller.dart';
import 'features/library/library_controller.dart';
import 'features/results/results_controller.dart';
import 'native/fake_native_bridge.dart';
import 'native/native_bridge.dart';

/// `--dart-define=MASTERSAT_API_BASE=…` (see [ApiConfig.fromDefine]).
const String apiBaseDefine = String.fromEnvironment('MASTERSAT_API_BASE');

Future<void> main() => runMasterSat();

/// Builds every service, draws Home from the cache, and runs the app.
///
/// [native] is the `mastersat_native.dll` binding (rust: FfiNativeBridge). Without one a
/// debug/profile build uses [FakeNativeBridge] (base64 instead of DPAPI, no lockdown) — a
/// release build refuses to start, so a shipped app can never store tokens unprotected.
Future<void> runMasterSat({NativeBridge? native, ExamLauncher? examLauncher}) async {
  WidgetsFlutterBinding.ensureInitialized();
  final config = ApiConfig.fromDefine(apiBaseDefine, appVersion: appVersion);
  final paths = await AppPaths.resolve();
  final services = await buildAppServices(
    config: config,
    paths: paths,
    native: native ?? _devNativeBridge(),
    examLauncher: examLauncher,
    links: LaunchLinks(),
    windowPlacement: WindowPlacementSync(),
  );
  _captureErrors(services.log);
  await services.auth.restore();
  if (services.auth.isSignedIn) await services.home.loadCached();
  runApp(MasterSatApp(services: services));
  final links = services.links;
  if (links != null) unawaited(services.auth.attachLinks(links));
  unawaited(_windowsHousekeeping(services));
}

NativeBridge _devNativeBridge() {
  if (kReleaseMode) {
    throw StateError('Release builds need the mastersat_native.dll binding: runMasterSat(native: …).');
  }
  return FakeNativeBridge(appVersion: appVersion);
}

/// Every long-lived object, wired together (tests build theirs with fakes the same way).
Future<AppServices> buildAppServices({
  required ApiConfig config,
  required AppPaths paths,
  required NativeBridge native,
  Clock clock = const SystemClock(),
  V1Api? api,
  Transport? transport,
  ExamLauncher? examLauncher,
  LaunchLinks? links,
  WindowPlacementSync? windowPlacement,
  StoreOpener? openStore,
  TokenStore? tokenStore,
  DocumentSaver? documents,
  UrlOpener? openUrl,
  Future<void> Function(String text)? copyToClipboard,
}) async {
  final log = EventLog(clock: clock);
  final unsent = UnsentWork();
  final serverClock = ServerClock(clock);

  final Transport? http;
  final V1Api v1;
  if (api != null) {
    v1 = api;
    http = transport;
  } else if (config.target == ApiTarget.inProcessFixtures) {
    v1 = FixtureV1Api(latency: const Duration(milliseconds: 120));
    http = null;
  } else {
    http = transport ?? HttpTransport(config: config, proxy: ProxyResolver(native.proxyFor, clock: clock));
    v1 = HttpV1Api(transport: http, config: config);
  }

  final auth = AuthController(
    api: v1,
    native: native,
    store: tokenStore ?? TokenStore.at(paths, native),
    config: config,
    unsentWork: unsent,
    clock: clock,
    openUrl: openUrl,
    devMintCode: _devMinter(config, http),
  );

  final home = HomeController(
    api: v1,
    auth: auth,
    openStore: openStore ?? (userId) => UserStore.open(paths, userId),
    clock: clock,
    serverClock: serverClock,
    log: log,
  );
  final updates = UpdateController(
    native: native,
    config: config,
    channel: () => home.store?.settings.updateChannel ?? UpdateChannel.stable,
    log: log,
  );

  if (v1 is HttpV1Api) {
    v1.tokens = auth;
    v1.onUpdateRequired = (e) => updates.required.value = e;
    v1.onServerNow = (t) => serverClock.observe(t);
  }

  return AppServices(
    config: config,
    paths: paths,
    native: native,
    api: v1,
    auth: auth,
    home: home,
    library: LibraryController(),
    updates: updates,
    unsentWork: unsent,
    clock: clock,
    serverClock: serverClock,
    log: log,
    toasts: ToastController(),
    documents: documents ?? DocumentSaver(write: (path, bytes) => writeFileAtomically(File(path), bytes)),
    links: links,
    windowPlacement: windowPlacement,
    examLauncher: examLauncher,
    copyToClipboard: copyToClipboard,
    openExternal: openUrl ?? (url) => launchUrl(url, mode: LaunchMode.externalApplication),
  );
}

/// Debug builds sign in without a browser trip: against the local fixture server it asks the
/// server for a code (as the website's /desktop/link page would); with in-process fixtures any
/// code works. Never in a release build, never against a non-loopback origin.
DevCodeMinter? _devMinter(ApiConfig config, Transport? http) {
  if (kReleaseMode) return null;
  if (config.target == ApiTarget.inProcessFixtures) return (challenge) async => 'fixture-code';
  if (http == null) return null;
  return devCodeMinterFor(config, http);
}

void _captureErrors(EventLog log) {
  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    log.add('error', details.exceptionAsString());
    previous?.call(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    log.add('error', error.toString());
    return false;
  };
}

/// Windows only, after the first frame: remove the 0.1.0 (Tauri) install if it is still there,
/// THEN (re-)register `mastersat://` — the old uninstaller deletes that key (architecture §6).
Future<void> _windowsHousekeeping(AppServices services) async {
  if (!isWindowsHost) return;
  try {
    final legacy = await services.native.uninstallLegacy();
    if (legacy.found) services.log.add('install', 'legacy 0.1.0 uninstall ran=${legacy.ran}');
  } on NativeBridgeException catch (e) {
    services.log.add('install', 'legacy uninstall failed: ${e.code}');
  }
  try {
    services.native.registerProtocol(Platform.resolvedExecutable);
  } on NativeBridgeException catch (e) {
    services.log.add('install', 'protocol registration failed: ${e.code}');
  }
}
