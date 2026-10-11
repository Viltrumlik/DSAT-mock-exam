// The off-thread proxy lookup over the REAL native library (the cargo-built dylib on this Mac;
// mastersat_native.dll on Windows CI): a worker isolate opens the same module by the bridge's
// path and answers exactly what the UI-isolate call answers. Skipped when the library is not
// built (cargo build --manifest-path desktop-native/native/Cargo.toml), like
// test/native/ffi_native_bridge_test.dart.
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/http/native_proxy_lookup.dart';
import 'package:mastersat_app/core/http/proxy.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';
import 'package:mastersat_app/native/ffi_native_bridge.dart';

void main() {
  FfiNativeBridge? bridge;
  String? why;
  try {
    bridge = FfiNativeBridge.open(devAppVersion: '0.2.0');
  } on NativeLibraryUnavailable catch (e) {
    why = 'mastersat_native is not built here ($e)';
  }

  test('the fake bridge has no background lookup (it answers DIRECT at once)', () {
    expect(backgroundProxyLookupFor(FakeNativeBridge()), isNull);
  });

  test('ms_proxy_for on a worker isolate answers what the UI isolate would', () async {
    final b = bridge!;
    final lookup = backgroundProxyLookupFor(b)!;
    const url = 'https://mastersat.uz/api/desktop/v1/home';
    final off = await lookup(url);
    expect(off, b.proxyFor(url));
    final resolver = ProxyResolver(b.proxyFor, backgroundLookup: lookup);
    await resolver.prepare(Uri.parse(url));
    expect(resolver.backgroundLookups, 1);
    expect(resolver.findProxy(Uri.parse(url)), anyOf('DIRECT', startsWith('PROXY ')));
    expect(resolver.lookups, 0, reason: 'findProxy was a cache hit');
  }, skip: why);
}
