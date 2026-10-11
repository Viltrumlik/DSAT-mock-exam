// The same example messages the TS test checks (island/protocol/examples) validate in Dart,
// parse into typed messages and re-serialise to the same JSON; invalid ones are rejected.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/island/protocol.dart';

import '../support/island_examples.dart';

void main() {
  final dir = islandProtocolDir();
  final valid = Directory('${dir.path}/examples').listSync().whereType<File>().where((f) => f.path.endsWith('.json')).toList()
    ..sort((a, b) => a.path.compareTo(b.path));
  final invalid = Directory('${dir.path}/examples/invalid').listSync().whereType<File>().toList();
  final schema = (jsonDecode(File('${dir.path}/schema.json').readAsStringSync()) as Map).cast<String, Object?>();
  final messages = (schema['messages']! as Map).cast<String, Object?>();

  test('embedded schema equals schema.json', () {
    expect(islandProtocolSchemaJson, File('${dir.path}/schema.json').readAsStringSync());
    expect(islandMessageTypes, messages.keys.toSet());
  });

  test('every message type has at least one example', () {
    final covered = valid.map((f) => (jsonDecode(f.readAsStringSync()) as Map)['t']).toSet();
    expect(messages.keys.toSet().difference(covered), isEmpty);
  });

  for (final f in valid) {
    final name = f.uri.pathSegments.last;
    test('valid: $name', () {
      final json = jsonDecode(f.readAsStringSync());
      expect(validateIslandMessage(json), isNull);
      final msg = IslandMessage.parse(json);
      final spec = (messages[msg.t]! as Map).cast<String, Object?>();
      final dir = spec['direction'] == 'to_web' ? MessageDirection.toWeb : MessageDirection.toNative;
      expect(msg.direction, dir);
      expect(IslandMessage.tryParse(json, direction: dir), isNotNull);
      final wrong = dir == MessageDirection.toWeb ? MessageDirection.toNative : MessageDirection.toWeb;
      expect(IslandMessage.tryParse(json, direction: wrong), isNull, reason: 'direction is enforced');
      for (final island in (spec['islands']! as List).cast<String>()) {
        expect(validateIslandMessage(json, island: IslandKind.values.byName(island)), isNull);
      }
      // Typed round trip: identical JSON, and survives the real wire encoding.
      expect(msg.toJson(), equals(json));
      expect(jsonDecode(msg.encode()), equals(json));
    });
  }

  for (final f in invalid) {
    test('invalid: ${f.uri.pathSegments.last}', () {
      final json = jsonDecode(f.readAsStringSync());
      expect(validateIslandMessage(json), isNotNull);
      expect(IslandMessage.tryParse(json), isNull);
      expect(() => IslandMessage.parse(json), throwsFormatException);
    });
  }

  test('tryDecode drops non-JSON and desmos may not send content messages', () {
    expect(IslandMessage.tryDecode('{not json'), isNull);
    expect(IslandMessage.tryDecode('{"v":1,"t":"key","key":"Escape"}', island: IslandKind.desmos), isA<KeyMessage>());
    expect(IslandMessage.tryDecode('{"v":1,"t":"answer.choose","qid":1,"key":"A"}', island: IslandKind.desmos), isNull);
  });

  test('typed construction encodes to a valid message', () {
    const m = QuestionShowMessage(
      qid: 2001,
      index: 0,
      total: 27,
      answer: null,
      eliminated: [],
      flagged: false,
      annotations: IslandAnnotationSet(passage: [], question: [], choices: []),
    );
    final wire = jsonDecode(m.encode());
    expect(validateIslandMessage(wire, direction: MessageDirection.toWeb, island: IslandKind.content), isNull);
    expect((wire as Map).containsKey('scrollTop'), isFalse, reason: 'optional fields are omitted');
  });
}
