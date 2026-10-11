// `ms_proxy_for` on a worker isolate (the rust workstream's request: the first WinHTTP lookup
// for a host can take seconds when "Automatically detect settings" is on, so it must never run
// on the UI thread). The worker opens the module by the SAME path the bridge used — on Windows
// the bare `mastersat_native.dll`, i.e. the module the runner already loaded — so the native
// library's own 5-minute cache is shared with the UI isolate's later calls.
import 'dart:ffi';
import 'dart:isolate';

import 'package:ffi/ffi.dart';

import '../../native/ffi_native_bridge.dart';
import '../../native/native_bridge.dart';
import 'proxy.dart';

/// The off-thread lookup for [native], or null when [native] is not the real library (the fake
/// bridge answers DIRECT at once).
BackgroundProxyLookup? backgroundProxyLookupFor(NativeBridge native) {
  if (native is! FfiNativeBridge) return null;
  final path = native.libraryPath;
  return (url) => _runProxyFor(path, url);
}

// Top level, capturing only strings: an isolate entry must not capture the bridge (its FFI
// function pointers cannot be sent to another isolate).
Future<String> _runProxyFor(String libraryPath, String url) =>
    Isolate.run(() => _proxyFor(libraryPath, url), debugName: 'ms_proxy_for');

String _proxyFor(String libraryPath, String url) {
  final b = MsBindings(DynamicLibrary.open(libraryPath));
  final u = url.toNativeUtf8();
  final out = calloc<Pointer<Utf8>>();
  try {
    final code = b.proxyFor(u, out);
    final value = out.value;
    if (code != NativeStatus.ok) {
      if (value != nullptr) b.free(value);
      return 'DIRECT';
    }
    try {
      return value.toDartString();
    } finally {
      b.free(value);
    }
  } finally {
    calloc
      ..free(u)
      ..free(out);
  }
}
