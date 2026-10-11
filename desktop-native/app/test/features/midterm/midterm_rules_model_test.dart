// The prepare reply's `rules` block as the rules screen reads it: the pass-mark and retake
// lines (scoring_scale, pass_mark, is_retake — 2026-10-11) and the calculator rule.
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';

Map<String, Object?> _rulesJson() =>
    Map<String, Object?>.of(FixtureV1Api.fixture('midterm_prepare.response.json')['rules']! as Map<String, Object?>);

void main() {
  test('the contract carries the scale, the pass mark and the retake flag', () {
    final r = MidtermRules.fromJson(JsonReader.of(_rulesJson()));
    expect((r.scoringScale, r.passMark, r.isRetake), ('SCALE_800', 500, false));
    expect(r.calculator, CalculatorMode.graphing);
    expect(r.isMath, isTrue);
  });

  test('a pre-midterm has no pass mark; a retake says so; Foundation Math has no calculator', () {
    final json = _rulesJson()
      ..['pass_mark'] = null
      ..['is_retake'] = true
      ..['calculator'] = null;
    final r = MidtermRules.fromJson(JsonReader.of(json));
    expect((r.scoringScale, r.passMark, r.isRetake, r.calculator), ('SCALE_800', null, true, null));
    expect(r.toJson(), json, reason: 'round-trips with the nulls kept');
  });

  test('a reply without the new keys still parses: no pass mark, no retake line', () {
    final json = _rulesJson()
      ..remove('scoring_scale')
      ..remove('pass_mark')
      ..remove('is_retake');
    final r = MidtermRules.fromJson(JsonReader.of(json));
    expect((r.scoringScale, r.passMark, r.isRetake), (null, null, false));
  });

  test('Reading and Writing is not Math', () {
    final r = MidtermRules.fromJson(JsonReader.of(_rulesJson()..['subject'] = 'READING_WRITING'));
    expect(r.isMath, isFalse);
  });
}
