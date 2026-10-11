// The exam engine's image downloader (`MediaFetcher`): one signed R2 URL → its bytes, through
// the app's single HTTP client (core/http HttpTransport: keep-alive, 6 per host, the system
// proxy, no cookie jar).
//
// The URLs are absolute and point at the storage host, never at the API. The transport adds no
// header by itself — HttpV1Api is the only place the Bearer token is attached — so nothing here
// can send the token to a non-API host; [mediaFetcherFor] also refuses plain-http URLs outside
// development and any URL on the API origin itself.
//
// Development: the fixtures' signed URLs point at `r2.fixtures.invalid`, which does not exist;
// non-release builds answer those from the embedded fixture images (in-process fixtures and the
// local fixture server alike). A release build never does.
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../../core/api/fixture_v1_api.dart';
import '../../core/http/api_config.dart';
import '../../core/http/http_transport.dart';
import '../engine/media_cache.dart';

/// The host the v1 fixtures sign their image URLs for.
const String fixtureMediaHost = 'r2.fixtures.invalid';

/// The embedded fixture image for a fixture URL (`/mastersat-media/<key>`), or null.
Uint8List? fixtureMediaFor(Uri url) {
  if (url.host != fixtureMediaHost) return null;
  final key = Uri.decodeComponent(url.path.replaceFirst('/mastersat-media/', ''));
  return FixtureV1Api.fixtureMedia(key);
}

/// Builds the engine's [MediaFetcher]. [transport] is null in in-process fixture mode.
MediaFetcher mediaFetcherFor({
  required ApiConfig config,
  required Transport? transport,
  bool releaseMode = kReleaseMode,
}) {
  return (Uri url) async {
    if (!releaseMode && url.host == fixtureMediaHost) {
      final bytes = fixtureMediaFor(url);
      if (bytes == null) throw HttpException('no fixture image for ${url.path}', uri: url);
      return bytes;
    }
    final t = transport;
    if (t == null) throw HttpException('images need a network connection here', uri: url);
    final loopback = url.host == '127.0.0.1' || url.host == 'localhost';
    if (url.scheme != 'https' && !(loopback && !releaseMode)) {
      throw HttpException('refusing a non-https image URL', uri: url);
    }
    if (url.host == config.origin.host && url.path.startsWith('/api/')) {
      throw HttpException('refusing an API URL as an image', uri: url);
    }
    final r = await t.send(TransportRequest(method: 'GET', url: url, timeout: config.longTimeout));
    if (r.status != 200) throw HttpException('image download answered ${r.status}', uri: url);
    return r.body;
  };
}
