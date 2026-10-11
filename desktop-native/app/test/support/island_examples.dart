// Locates desktop-native/island/protocol from any test working directory.
import 'dart:io';

Directory islandProtocolDir() {
  var dir = Directory.current.absolute;
  for (var i = 0; i < 6; i++) {
    for (final rel in ['island/protocol', 'desktop-native/island/protocol']) {
      final candidate = Directory('${dir.path}/$rel');
      if (File('${candidate.path}/schema.json').existsSync()) return candidate;
    }
    dir = dir.parent;
  }
  throw StateError('island/protocol not found above ${Directory.current.path}');
}
