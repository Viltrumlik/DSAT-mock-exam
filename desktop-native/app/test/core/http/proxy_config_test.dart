// ProxyResolver (WinHTTP answers cached 5 min, loopback DIRECT, failures DIRECT) and
// ApiConfig (where the app talks to, the client header, the sign-in link, the version).
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/clock/clock.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/http/proxy.dart';

void main() {
  group('ProxyResolver', () {
    test('caches each scheme://host:port for five minutes', () {
      final clock = ManualClock(DateTime.utc(2026, 10, 11, 9));
      var answer = 'PROXY corp:8080';
      final r = ProxyResolver((_) => answer, clock: clock);
      final u = Uri.parse('https://mastersat.uz/api/desktop/v1/home');
      expect(r.findProxy(u), 'PROXY corp:8080; DIRECT');
      answer = 'DIRECT';
      expect(r.findProxy(Uri.parse('https://mastersat.uz/other')), 'PROXY corp:8080; DIRECT');
      expect(r.lookups, 1);
      clock.advance(const Duration(minutes: 5, seconds: 1));
      expect(r.findProxy(u), 'DIRECT');
      expect(r.lookups, 2);
    });

    test('loopback never goes through a proxy', () {
      final r = ProxyResolver((_) => 'PROXY corp:8080');
      for (final h in ['127.0.0.1', 'localhost', '[::1]', '127.0.0.2']) {
        expect(r.findProxy(Uri.parse('http://$h:8765/')), 'DIRECT', reason: h);
      }
      expect(r.lookups, 0);
    });

    test('a broken or odd answer means DIRECT; a proxy list keeps DIRECT last', () {
      expect(ProxyResolver((_) => throw StateError('winhttp')).findProxy(Uri.parse('https://a.b/')), 'DIRECT');
      expect(ProxyResolver((_) => '').findProxy(Uri.parse('https://a.b/')), 'DIRECT');
      expect(ProxyResolver((_) => 'SOCKS5 x:1').findProxy(Uri.parse('https://a.b/')), 'DIRECT');
      expect(ProxyResolver((_) => 'PROXY a:1;PROXY b:2').findProxy(Uri.parse('https://a.b/')), 'PROXY a:1; PROXY b:2; DIRECT');
      expect(ProxyResolver((_) => 'PROXY a:1; DIRECT').findProxy(Uri.parse('https://a.b/')), 'PROXY a:1; DIRECT');
    });
  });

  group('ApiConfig', () {
    test('release builds default to mastersat.uz; debug builds to in-process fixtures', () {
      final rel = ApiConfig.fromDefine('', appVersion: '0.2.0', releaseMode: true);
      expect(rel.origin.toString(), 'https://mastersat.uz');
      expect(rel.target, ApiTarget.http);
      final dev = ApiConfig.fromDefine('', appVersion: '0.2.0', releaseMode: false);
      expect(dev.target, ApiTarget.inProcessFixtures);
      expect(ApiConfig.fromDefine('fixture:', appVersion: '0.2.0').target, ApiTarget.inProcessFixtures);
    });

    test('a local fixture server origin is loopback; a path or junk is refused', () {
      final local = ApiConfig.fromDefine(' http://127.0.0.1:8765/ignored/path ', appVersion: '0.2.0');
      expect(local.origin.toString(), 'http://127.0.0.1:8765');
      expect(local.isLoopback, isTrue);
      expect(ApiConfig.fromDefine('https://mastersat.uz', appVersion: '0.2.0').isLoopback, isFalse);
      expect(() => ApiConfig.fromDefine('mastersat.uz', appVersion: '0.2.0'), throwsArgumentError);
      expect(() => ApiConfig.fromDefine('ftp://x', appVersion: '0.2.0'), throwsArgumentError);
    });

    test('client header, sign-in link and update feed', () {
      final c = ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0');
      expect(c.clientHeader, 'windows/0.2.0');
      expect(c.signInLink('abc_DEF-123').toString(), 'https://mastersat.uz/desktop/link?challenge=abc_DEF-123');
      expect(c.updateFeed.toString(), 'https://mastersat.uz/downloads/desktop/');
      expect(c.resolve('/api/desktop/v1/home').toString(), 'https://mastersat.uz/api/desktop/v1/home');
    });

    test('the timeouts the design names', () {
      final c = ApiConfig(origin: Uri.parse('https://mastersat.uz'), appVersion: '0.2.0');
      expect(c.connectTimeout, const Duration(seconds: 10));
      expect(c.idleTimeout, const Duration(seconds: 90));
      expect(c.writeTimeout, const Duration(seconds: 25));
      expect(c.longTimeout, const Duration(seconds: 60));
      expect(c.refreshTimeout, const Duration(seconds: 120));
      expect(c.maxConnectionsPerHost, 6);
    });

    test('the default app version is desktop-native/VERSION', () {
      var dir = Directory.current;
      File? version;
      for (var i = 0; i < 4 && version == null; i++) {
        final f = File('${dir.path}/VERSION');
        if (f.existsSync() && Directory('${dir.path}/app').existsSync()) version = f;
        dir = dir.parent;
      }
      expect(version, isNotNull, reason: 'desktop-native/VERSION not found from ${Directory.current.path}');
      expect(appVersion, version!.readAsStringSync().trim());
    });
  });
}
