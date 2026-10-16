// ONE dart:io HttpClient for the whole process (architecture §4.2, design §4):
//  * keep-alive, idle connections closed after 90 s; connect timeout 10 s;
//  * a per-request deadline (25 s writes / 60 s open+result / 120 s refresh), enforced here;
//  * gzip: autoUncompress on, so `Accept-Encoding: gzip` goes out and bodies come back plain;
//  * at most 6 connections per host (image downloads in parallel);
//  * NO cookie jar — dart:io never stores or replays cookies, and nothing here copies a
//    Set-Cookie into a later request (a stored cookie would make `is_native_client` false);
//  * the system proxy through [ProxyResolver] (WinHTTP via the native library).
//
// Failures with no usable answer become [NetworkError]; every HTTP status is returned as a
// [TransportResponse] (mapping statuses to typed errors is HttpV1Api's job).
import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import '../api/v1_api.dart';
import 'api_config.dart';
import 'proxy.dart';

/// One request. [headers] are set verbatim (case-insensitive on the wire).
class TransportRequest {
  const TransportRequest({
    required this.method,
    required this.url,
    this.headers = const {},
    this.body,
    required this.timeout,
  });

  final String method;
  final Uri url;
  final Map<String, String> headers;
  final List<int>? body;

  /// The whole exchange (connect + send + full body) must finish within this.
  final Duration timeout;
}

/// A complete response: status, lower-cased headers, the whole (decompressed) body.
class TransportResponse {
  const TransportResponse({required this.status, required this.headers, required this.body});

  final int status;
  final Map<String, String> headers;
  final Uint8List body;

  String? header(String name) => headers[name.toLowerCase()];
}

/// Something that can send a [TransportRequest] (the real one, or a test double).
abstract class Transport {
  Future<TransportResponse> send(TransportRequest request);
  void close({bool force = false});
}

class HttpTransport implements Transport {
  HttpTransport({required this.config, this._proxy, this._clientFactory});

  final ApiConfig config;
  final ProxyResolver? _proxy;
  final HttpClient Function()? _clientFactory;
  HttpClient? _client;
  bool _closed = false;

  /// The single client, created on first use.
  HttpClient get client => _client ??= _create();

  HttpClient _create() {
    final c = (_clientFactory ?? HttpClient.new)()
      ..idleTimeout = config.idleTimeout
      ..connectionTimeout = config.connectTimeout
      ..maxConnectionsPerHost = config.maxConnectionsPerHost
      ..autoUncompress = true
      ..userAgent = 'MasterSAT-${Platform.isMacOS ? 'macOS' : 'Windows'}/${config.appVersion}';
    final proxy = _proxy;
    if (proxy != null) c.findProxy = proxy.findProxy;
    return c;
  }

  @override
  Future<TransportResponse> send(TransportRequest r) {
    if (_closed) return Future.error(const NetworkError('The connection was closed.'));
    final done = Completer<TransportResponse>();
    HttpClientRequest? open;
    var timedOut = false;

    final timer = Timer(r.timeout, () {
      timedOut = true;
      open?.abort(TimeoutException('request deadline', r.timeout));
      if (!done.isCompleted) {
        done.completeError(NetworkError('The server took too long to answer.', timedOut: true, cause: r.url.path));
      }
    });

    () async {
      // The first proxy lookup for a host runs off the UI isolate (see ProxyResolver.prepare).
      await _proxy?.prepare(r.url);
      if (timedOut) return;
      final req = await client.openUrl(r.method, r.url);
      open = req;
      if (timedOut) {
        req.abort();
        return;
      }
      req.persistentConnection = true;
      req.followRedirects = r.method == 'GET';
      r.headers.forEach(req.headers.set);
      final body = r.body;
      if (body != null) {
        req.contentLength = body.length;
        req.add(body);
      } else if (r.method != 'GET' && r.method != 'HEAD') {
        req.contentLength = 0;
      }
      final resp = await req.close();
      final builder = BytesBuilder(copy: false);
      await for (final chunk in resp) {
        builder.add(chunk);
      }
      final headers = <String, String>{};
      resp.headers.forEach((name, values) => headers[name.toLowerCase()] = values.join(', '));
      if (!done.isCompleted) {
        done.complete(TransportResponse(status: resp.statusCode, headers: headers, body: builder.takeBytes()));
      }
    }()
        .catchError((Object e, StackTrace st) {
      if (!done.isCompleted) done.completeError(_networkError(e), st);
    }).whenComplete(timer.cancel);

    return done.future;
  }

  static NetworkError _networkError(Object e) {
    if (e is NetworkError) return e;
    if (e is SocketException) {
      return NetworkError('No connection to the server.', cause: e);
    }
    if (e is HandshakeException || e is TlsException) {
      return NetworkError('A secure connection could not be made.', cause: e);
    }
    if (e is TimeoutException) return NetworkError('The server took too long to answer.', timedOut: true, cause: e);
    if (e is HttpException) return NetworkError('The connection dropped.', cause: e);
    return NetworkError('The request failed.', cause: e);
  }

  @override
  void close({bool force = false}) {
    _closed = true;
    _client?.close(force: force);
    _client = null;
  }
}
