// Every fixture in contracts/v1 parses into its Dart model and re-serialises to the SAME
// JSON. This is what keeps the Dart client, the Django server and the fixtures in lockstep.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixtures/v1_fixtures.g.dart';
import 'package:mastersat_app/core/models/models.dart';

import '../../support/contracts.dart';

void main() {
  final fixtures = manifestFixtures();

  test('the manifest lists every fixture file and nothing else', () {
    final onDisk = contractsDir()
        .listSync()
        .whereType<File>()
        .map((f) => f.uri.pathSegments.last)
        .where((n) => n.endsWith('.json') && n != 'manifest.json')
        .toSet();
    final listed = fixtures.map((f) => f['file']! as String).toSet();
    expect(listed, onDisk);
    expect(fixtures.length, greaterThanOrEqualTo(60));
  });

  test('every manifest model is registered', () {
    final models = fixtures.map((f) => f['model']).whereType<String>().toSet();
    expect(models.difference(contractModels.keys.toSet()), isEmpty);
  });

  for (final f in fixtures) {
    final file = f['file']! as String;
    final model = f['model'] as String?;
    if (model == null) continue;
    test('$file round-trips through $model', () {
      final json = readContract(file);
      final again = contractModels[model]!.roundTrip(json);
      expect(again, equals(json), reason: 'toJson(fromJson(x)) must equal x for $file');
      // And survives a real encode/decode cycle (no non-JSON values leak out of toJson).
      expect(jsonDecode(jsonEncode(again)), equals(json));
    });
  }

  test('the embedded Dart fixtures are byte-identical to the JSON files', () {
    final dir = contractsDir();
    for (final f in fixtures) {
      final file = f['file']! as String;
      expect(v1FixtureFiles[file], File('${dir.path}/$file').readAsStringSync(), reason: file);
    }
    expect(v1FixtureFiles['manifest.json'], File('${dir.path}/manifest.json').readAsStringSync());
    for (final m in manifest()['media']! as List) {
      final row = (m as Map).cast<String, Object?>();
      final bytes = File('${dir.path}/${row['file']}').readAsBytesSync();
      expect(base64Decode(v1FixtureMediaBase64[row['key']]!), bytes, reason: row['key'] as String);
    }
  });

  test('content_hash in every module equals the Dart canonical hash of its questions', () {
    var checked = 0;
    for (final f in fixtures.where((f) => f['model'] == 'ExamBundle')) {
      final bundle = ExamBundle.fromJson(JsonReader.of(readContract(f['file']! as String)));
      for (final m in bundle.modules) {
        if (m.questions == null) continue;
        expect(contentHashOf(m.questions!), m.contentHash, reason: '${f['file']} module ${m.id}');
        checked++;
      }
    }
    expect(checked, greaterThanOrEqualTo(5));
  });

  test('a missing required key is a FormatException naming its path', () {
    final json = (readContract('pastpaper_sync.response.json')! as Map).cast<String, Object?>();
    final attempt = Map<String, Object?>.from(json['attempt']! as Map)..remove('timing');
    expect(
      () => WriteOutcome.fromJson(JsonReader.of({...json, 'attempt': attempt})),
      throwsA(isA<FormatException>().having((e) => e.message, 'message', contains(r'$.attempt.timing'))),
    );
  });

  test('unknown keys are ignored (v1 evolves additively)', () {
    final json = (readContract('home.response.json')! as Map).cast<String, Object?>();
    final home = HomeResponse.fromJson(JsonReader.of({...json, 'future_field': 1}));
    expect(home.student.fullName, 'Aziza Karimova');
  });

  test('timestamps keep millisecond precision and UTC', () {
    final dt = parseTimestamp('2026-10-11T14:00:00.123+05:00');
    expect(formatTimestamp(dt), '2026-10-11T09:00:00.123Z');
  });
}
