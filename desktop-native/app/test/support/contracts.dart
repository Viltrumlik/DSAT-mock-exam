// Locates desktop-native/contracts/v1 from any test working directory.
import 'dart:convert';
import 'dart:io';

Directory contractsDir() {
  var dir = Directory.current.absolute;
  for (var i = 0; i < 6; i++) {
    final candidate = Directory('${dir.path}/contracts/v1');
    if (candidate.existsSync()) return candidate;
    final nested = Directory('${dir.path}/desktop-native/contracts/v1');
    if (nested.existsSync()) return nested;
    dir = dir.parent;
  }
  throw StateError('contracts/v1 not found above ${Directory.current.path}');
}

Object? readContract(String file) => jsonDecode(File('${contractsDir().path}/$file').readAsStringSync());

Map<String, Object?> manifest() => (readContract('manifest.json')! as Map).cast<String, Object?>();

List<Map<String, Object?>> manifestFixtures() =>
    [for (final f in manifest()['fixtures']! as List) (f as Map).cast<String, Object?>()];
