// HttpTransport against a real local HttpServer: one keep-alive client, gzip, no cookie jar,
// the per-request deadline, the proxy hook, and failures as NetworkError.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/http/api_config.dart';
import 'package:mastersat_app/core/http/http_transport.dart';
import 'package:mastersat_app/core/http/proxy.dart';

class _Seen {
  _Seen(this.method, this.path, this.headers, this.body, this.remotePort);
  final String method;
  final String path;
  final HttpHeaders headers;
  final String body;
  final int remotePort;
}

void main() {
  late HttpServer server;
  late List<_Seen> seen;
  late Future<void> Function(HttpRequest r) respond;

  setUp(() async {
    seen = [];
    respond = (r) async {
      r.response.write('{"ok":true}');
      await r.response.close();
    };
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.autoCompress = true;
    server.listen((r) async {
      final body = await utf8.decodeStream(r);
      seen.add(_Seen(r.method, r.uri.path, r.headers, body, r.connectionInfo!.remotePort));
      await respond(r);
    });
  });

  tearDown(() => server.close(force: true));

  ApiConfig config({Duration? timeout}) => ApiConfig(
        origin: Uri.parse('http://127.0.0.1:${server.port}'),
        appVersion: '0.2.0',
        readTimeout: timeout ?? const Duration(seconds: 25),
      );

  TransportRequest get(String path, {Duration timeout = const Duration(seconds: 5), Map<String, String> headers = const {}}) =>
      TransportRequest(method: 'GET', url: Uri.parse('http://127.0.0.1:${server.port}$path'), headers: headers, timeout: timeout);

  test('the one client is configured as the design says', () {
    final t = HttpTransport(config: config());
    addTearDown(() => t.close(force: true));
    final c = t.client;
    expect(identical(c, t.client), isTrue, reason: 'one HttpClient for the process');
    expect(c.idleTimeout, const Duration(seconds: 90));
    expect(c.connectionTimeout, const Duration(seconds: 10));
    expect(c.maxConnectionsPerHost, 6);
    expect(c.autoUncompress, isTrue);
  });

  test('sends headers verbatim, asks for gzip and hands back the plain body', () async {
    respond = (r) async {
      r.response.headers.contentType = ContentType.json;
      r.response.write(jsonEncode({'pad': 'x' * 4000}));
      await r.response.close();
    };
    final t = HttpTransport(config: config());
    addTearDown(() => t.close(force: true));
    final resp = await t.send(get('/a', headers: {'X-MasterSAT-Client': 'windows/0.2.0', 'Authorization': 'Bearer abc'}));
    expect(resp.status, 200);
    expect(seen.single.headers.value('x-mastersat-client'), 'windows/0.2.0');
    expect(seen.single.headers.value('authorization'), 'Bearer abc');
    expect(seen.single.headers.value('accept-encoding'), contains('gzip'));
    expect(resp.header('content-encoding'), 'gzip', reason: 'the server really compressed it');
    expect((jsonDecode(utf8.decode(resp.body)) as Map)['pad'], 'x' * 4000);
  });

  test('keeps the connection alive between requests', () async {
    final t = HttpTransport(config: config());
    addTearDown(() => t.close(force: true));
    await t.send(get('/1'));
    await t.send(get('/2'));
    expect(seen.map((s) => s.remotePort).toSet(), hasLength(1));
  });

  test('never stores or replays a cookie (no cookie jar)', () async {
    respond = (r) async {
      r.response.headers.add('Set-Cookie', 'access_token=SECRET; Path=/; HttpOnly');
      r.response.write('{}');
      await r.response.close();
    };
    final t = HttpTransport(config: config());
    addTearDown(() => t.close(force: true));
    await t.send(get('/login'));
    await t.send(get('/after'));
    expect(seen.last.headers.value(HttpHeaders.cookieHeader), isNull);
  });

  test('POST bodies carry their length; empty POSTs send Content-Length: 0', () async {
    final t = HttpTransport(config: config());
    addTearDown(() => t.close(force: true));
    final url = Uri.parse('http://127.0.0.1:${server.port}/p');
    await t.send(TransportRequest(method: 'POST', url: url, body: utf8.encode('{"a":1}'), timeout: const Duration(seconds: 5)));
    await t.send(TransportRequest(method: 'POST', url: url, timeout: const Duration(seconds: 5)));
    expect(seen[0].headers.contentLength, 7);
    expect(seen[0].body, '{"a":1}');
    expect(seen[1].headers.contentLength, 0);
  });

  test('every status comes back as a response (mapping is the API layer\'s job)', () async {
    respond = (r) async {
      r.response.statusCode = 503;
      r.response.headers.set('Retry-After', '30');
      r.response.write('{"detail":"busy"}');
      await r.response.close();
    };
    final t = HttpTransport(config: config());
    addTearDown(() => t.close(force: true));
    final resp = await t.send(get('/x'));
    expect(resp.status, 503);
    expect(resp.header('Retry-After'), '30');
  });

  test('a request that outlives its deadline fails as a timed-out NetworkError', () async {
    final release = Completer<void>();
    respond = (r) async {
      await release.future;
      try {
        r.response.write('{}');
        await r.response.close();
      } catch (_) {}
    };
    final t = HttpTransport(config: config());
    addTearDown(() => t.close(force: true));
    await expectLater(
      t.send(get('/slow', timeout: const Duration(milliseconds: 200))),
      throwsA(isA<NetworkError>().having((e) => e.timedOut, 'timedOut', isTrue)),
    );
    release.complete();
  });

  test('a dropped connection and a refused connection are NetworkErrors', () async {
    respond = (r) async {
      final s = await r.response.detachSocket(writeHeaders: false);
      s.destroy();
    };
    final t = HttpTransport(config: config());
    addTearDown(() => t.close(force: true));
    await expectLater(t.send(get('/drop')), throwsA(isA<NetworkError>()));

    final dead = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final port = dead.port;
    await dead.close();
    await expectLater(
      t.send(TransportRequest(method: 'GET', url: Uri.parse('http://127.0.0.1:$port/'), timeout: const Duration(seconds: 5))),
      throwsA(isA<NetworkError>()),
    );
  });

  test('a closed transport refuses new requests', () async {
    final t = HttpTransport(config: config());
    t.close();
    await expectLater(t.send(get('/x')), throwsA(isA<NetworkError>()));
  });

  test('requests go through the proxy the ProxyResolver names (loopback stays DIRECT)', () async {
    final proxySeen = <String>[];
    final proxy = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => proxy.close(force: true));
    proxy.listen((r) async {
      proxySeen.add('${r.method} ${r.uri} host=${r.headers.host}');
      r.response.write('{"via":"proxy"}');
      await r.response.close();
    });
    final asked = <String>[];
    final resolver = ProxyResolver((url) {
      asked.add(url);
      return 'PROXY 127.0.0.1:${proxy.port}';
    });
    final t = HttpTransport(config: config(), proxy: resolver);
    addTearDown(() => t.close(force: true));

    final viaProxy = await t.send(TransportRequest(
        method: 'GET', url: Uri.parse('http://mastersat.test/api/x'), timeout: const Duration(seconds: 5)));
    expect(utf8.decode(viaProxy.body), '{"via":"proxy"}');
    expect(proxySeen.single, startsWith('GET http://mastersat.test/api/x'));
    expect(asked, ['http://mastersat.test/api/x']);

    await t.send(get('/direct'));
    expect(seen.single.path, '/direct', reason: 'loopback never asks the resolver');
    expect(asked, hasLength(1));
  });
}
