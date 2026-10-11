// System proxy for the process-wide HttpClient (architecture §4.2): HttpClient.findProxy asks
// the native library's WinHTTP lookup (`ms_proxy_for`, which understands PAC and WPAD) and the
// answer is kept for 5 minutes per scheme://host:port. Loopback never goes through a proxy.
// Any failure means DIRECT — a broken proxy lookup must never stop the app from connecting.
//
// The FIRST lookup for a host can take seconds (Windows' "Automatically detect settings" runs
// WPAD), and HttpClient.findProxy is synchronous on the UI isolate. So the transport calls
// [ProxyResolver.prepare] before it opens a request: with a [backgroundLookup] (the native
// library on a worker isolate) a cache miss is answered off the UI thread, and the synchronous
// findProxy that follows is a cache hit.
import 'dart:async';

import '../clock/clock.dart';

typedef ProxyLookup = String Function(String url);

/// The same lookup, run off the UI isolate.
typedef BackgroundProxyLookup = Future<String> Function(String url);

class ProxyResolver {
  ProxyResolver(
    this._lookup, {
    this._clock = const SystemClock(),
    this.ttl = const Duration(minutes: 5),
    this.backgroundLookup,
    this.backgroundTimeout = const Duration(seconds: 20),
  });

  final ProxyLookup _lookup;
  final Clock _clock;
  final Duration ttl;

  /// Off-thread lookups for [prepare] (null: [prepare] does nothing and findProxy looks up).
  final BackgroundProxyLookup? backgroundLookup;

  /// A background lookup that takes longer than this counts as DIRECT (cached like any answer).
  final Duration backgroundTimeout;
  final Map<String, _Entry> _cache = {};
  final Map<String, Future<void>> _preparing = {};

  /// Number of background lookups made (tests).
  int backgroundLookups = 0;

  static String _key(Uri url) => '${url.scheme}://${url.host}:${url.port}';

  /// Makes sure [url]'s host has a fresh answer in the cache, looking it up OFF the UI isolate
  /// (joins a lookup already running for that host). Never throws.
  Future<void> prepare(Uri url) {
    final background = backgroundLookup;
    if (background == null || _isLoopback(url.host)) return Future.value();
    final key = _key(url);
    final hit = _cache[key];
    if (hit != null && _clock.now().difference(hit.at) < ttl) return Future.value();
    final running = _preparing[key];
    if (running != null) return running;
    Future<void> run() async {
      String value;
      try {
        backgroundLookups++;
        value = _normalise(await background(url.toString()).timeout(backgroundTimeout));
      } catch (_) {
        value = 'DIRECT';
      }
      _cache[key] = _Entry(value, _clock.now());
    }

    return _preparing[key] = run().whenComplete(() => _preparing.remove(key));
  }

  /// Number of native lookups made (tests).
  int lookups = 0;

  /// For `HttpClient.findProxy`: "DIRECT" or "PROXY host:port; …; DIRECT".
  String findProxy(Uri url) {
    if (_isLoopback(url.host)) return 'DIRECT';
    final key = _key(url);
    final now = _clock.now();
    final hit = _cache[key];
    if (hit != null && now.difference(hit.at) < ttl) return hit.value;
    String value;
    try {
      lookups++;
      value = _normalise(_lookup(url.toString()));
    } catch (_) {
      value = 'DIRECT';
    }
    _cache[key] = _Entry(value, now);
    return value;
  }

  void clear() => _cache.clear();

  static bool _isLoopback(String host) =>
      host == 'localhost' || host == '127.0.0.1' || host == '::1' || host.startsWith('127.');

  static String _normalise(String raw) {
    final v = raw.trim();
    if (v.isEmpty) return 'DIRECT';
    final parts = v.split(';').map((p) => p.trim()).where((p) => p.isNotEmpty).toList();
    final ok = parts.every((p) => p == 'DIRECT' || RegExp(r'^PROXY [^\s;]+:\d+$').hasMatch(p));
    if (!ok) return 'DIRECT';
    // Always keep a DIRECT fallback last, so a dead proxy degrades instead of failing.
    if (parts.last != 'DIRECT') parts.add('DIRECT');
    return parts.join('; ');
  }
}

class _Entry {
  const _Entry(this.value, this.at);
  final String value;
  final DateTime at;
}
