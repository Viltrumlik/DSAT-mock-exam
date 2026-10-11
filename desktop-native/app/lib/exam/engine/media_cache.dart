// Question images (design §2.e, architecture §4.1 "Images").
//
//  * Cached by STORAGE KEY, never by URL: `file_overwrite=False` means a key never gets new
//    bytes, and signed URLs differ on every response.
//  * Past papers: sealed files `media/<sha256(key)>` through [NativeBridge.seal], indexed in
//    the `media` table, fetched once ever.
//  * Midterms: memory only ([MemoryMediaStore]) — nothing about a midterm paper touches disk.
//  * Six downloads in parallel through an injected [MediaFetcher] (app-core's one HttpClient;
//    tests use the fixture bytes). An expired URL is re-signed once through `GET …/media`.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import '../../core/models/models.dart';
import '../../native/native_bridge.dart';
import '../session_contract.dart';
import 'exam_store.dart';

/// Downloads one signed image URL. Throws on any failure.
typedef MediaFetcher = Future<Uint8List> Function(Uri url);

/// Fresh signed URLs for an attempt (`GET attempts/{kind}/{id}/media`).
typedef MediaResigner = Future<List<MediaRef>> Function();

/// `image/png` etc. from the storage key's extension.
String mimeForKey(String key) {
  final dot = key.lastIndexOf('.');
  final ext = dot < 0 ? '' : key.substring(dot + 1).toLowerCase();
  return switch (ext) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'gif' => 'image/gif',
    'webp' => 'image/webp',
    'svg' => 'image/svg+xml',
    'bmp' => 'image/bmp',
    _ => 'image/png',
  };
}

/// Download progress for the loading screen (real figure counts).
class MediaProgress {
  const MediaProgress({required this.done, required this.total, required this.failed});
  final int done;
  final int total;
  final int failed;
  bool get complete => done + failed >= total;
}

/// Where images live while a sitting is open.
abstract class MediaStore {
  Future<bool> has(String key);
  Future<void> put(String key, Uint8List bytes);
  Future<MediaBlob?> read(String key);
}

/// Midterms: images in memory only.
class MemoryMediaStore implements MediaStore {
  final Map<String, Uint8List> _bytes = {};

  @override
  Future<bool> has(String key) async => _bytes.containsKey(key);

  @override
  Future<void> put(String key, Uint8List bytes) async => _bytes[key] = bytes;

  @override
  Future<MediaBlob?> read(String key) async {
    final b = _bytes[key];
    return b == null ? null : MediaBlob(key: key, mime: mimeForKey(key), bytes: b);
  }

  void clear() => _bytes.clear();
}

/// Past papers: sealed files indexed in the store.
class SealedFileMediaStore implements MediaStore {
  SealedFileMediaStore({required this.store, required this.native, required this.wallMs});

  final ExamStore store;
  final NativeBridge native;
  final int Function() wallMs;

  static String fileNameFor(String key) => sha256.convert(utf8.encode(key)).toString();

  @override
  Future<bool> has(String key) async {
    final row = await store.media(key);
    return row != null && File(row.path).existsSync();
  }

  @override
  Future<void> put(String key, Uint8List bytes) async {
    final file = File('${store.mediaDir.path}${Platform.pathSeparator}${fileNameFor(key)}');
    // Synchronous on purpose: images are small, and sync I/O keeps the engine deterministic
    // under fake_async (an async file write would complete outside the fake zone).
    final tmp = File('${file.path}.part');
    tmp.writeAsBytesSync(native.seal(bytes), flush: true);
    tmp.renameSync(file.path);
    await store.putMedia(
        MediaRow(key: key, path: file.path, bytes: bytes.length, contentType: mimeForKey(key)), wallMs());
  }

  @override
  Future<MediaBlob?> read(String key) async {
    final row = await store.media(key);
    if (row == null) return null;
    final file = File(row.path);
    if (!file.existsSync()) return null;
    final bytes = native.open(file.readAsBytesSync());
    unawaited(store.touchMedia(key, wallMs()));
    return MediaBlob(key: key, mime: row.contentType, bytes: bytes);
  }

  /// LRU eviction above [maxBytes] (about 300 MB), never touching [keep].
  Future<int> evict({int maxBytes = 300 * 1024 * 1024, Set<String> keep = const {}}) async {
    final victims = await store.mediaToEvict(maxBytes, keep);
    for (final m in victims) {
      final f = File(m.path);
      if (f.existsSync()) f.deleteSync();
      await store.deleteMedia(m.key);
    }
    return victims.length;
  }
}

/// Fetches a media list into a [MediaStore].
class MediaDownloader {
  MediaDownloader({required this.target, required this.fetch, this.resign, this.parallel = 6});

  final MediaStore target;
  final MediaFetcher fetch;
  final MediaResigner? resign;
  final int parallel;

  /// Downloads every missing key in [refs], [first] keys before the rest. Completes when all
  /// are present or have failed twice (once with the given URL, once re-signed). Returns the
  /// keys that could not be fetched.
  Future<Set<String>> ensure(
    List<MediaRef> refs, {
    Set<String> first = const {},
    void Function(MediaProgress)? onProgress,
  }) async {
    final unique = <String, MediaRef>{for (final r in refs) r.key: r};
    final missing = <MediaRef>[];
    for (final r in unique.values) {
      if (!await target.has(r.key)) missing.add(r);
    }
    missing.sort((a, b) => (first.contains(a.key) ? 0 : 1).compareTo(first.contains(b.key) ? 0 : 1));
    final total = missing.length;
    var done = 0;
    final failed = <String>{};
    void report() => onProgress?.call(MediaProgress(done: done, total: total, failed: failed.length));
    report();

    Future<bool> tryFetch(MediaRef r) async {
      try {
        final bytes = await fetch(Uri.parse(r.url));
        await target.put(r.key, bytes);
        return true;
      } catch (_) {
        return false;
      }
    }

    final retry = <MediaRef>[];
    Future<void> run(List<MediaRef> queue, bool lastChance) async {
      var next = 0;
      Future<void> worker() async {
        while (next < queue.length) {
          final r = queue[next++];
          if (await tryFetch(r)) {
            done++;
          } else if (lastChance) {
            failed.add(r.key);
          } else {
            retry.add(r);
          }
          report();
        }
      }

      await Future.wait([for (var i = 0; i < parallel && i < queue.length; i++) worker()]);
    }

    await run(missing, resign == null);
    if (retry.isNotEmpty && resign != null) {
      List<MediaRef> fresh;
      try {
        fresh = await resign!();
      } catch (_) {
        fresh = const [];
      }
      final byKey = {for (final f in fresh) f.key: f};
      final again = [for (final r in retry) byKey[r.key] ?? r];
      await run(again, true);
    }
    return failed;
  }
}
