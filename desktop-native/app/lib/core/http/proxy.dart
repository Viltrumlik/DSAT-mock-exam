// System proxy for the process-wide HttpClient (architecture §4.2): HttpClient.findProxy asks
// the native library's WinHTTP lookup (`ms_proxy_for`, which understands PAC and WPAD) and the
// answer is kept for 5 minutes per scheme://host:port. Loopback never goes through a proxy.
// Any failure means DIRECT — a broken proxy lookup must never stop the app from connecting.
import '../clock/clock.dart';

typedef ProxyLookup = String Function(String url);

class ProxyResolver {
  ProxyResolver(this._lookup, {this._clock = const SystemClock(), this.ttl = const Duration(minutes: 5)});

  final ProxyLookup _lookup;
  final Clock _clock;
  final Duration ttl;
  final Map<String, _Entry> _cache = {};

  /// Number of native lookups made (tests).
  int lookups = 0;

  /// For `HttpClient.findProxy`: "DIRECT" or "PROXY host:port; …; DIRECT".
  String findProxy(Uri url) {
    if (_isLoopback(url.host)) return 'DIRECT';
    final key = '${url.scheme}://${url.host}:${url.port}';
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
