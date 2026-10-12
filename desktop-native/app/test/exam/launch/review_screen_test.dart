// "Review questions" must show the question at once, whatever the network does with the images:
// the island points each <img> at its bytes when they arrive (island/src/content/media.ts).
// 2026-10-12: on a real connection the review stayed blank, because the screen waited for the
// whole module's images before sending the first question.
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixtures/v1_fixtures.g.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/launch/review_screen.dart';
import 'package:mastersat_app/island/fake_island_host.dart';
import 'package:mastersat_app/island/protocol.dart';

PastpaperResult completedResult() => PastpaperResult.fromJson(
      JsonReader.of(jsonDecode(v1FixtureFiles['pastpaper_result.response.completed.json']!) as Map<String, Object?>),
    );

void main() {
  testWidgets('the question shows while its images are still downloading; they follow', (tester) async {
    final result = completedResult();
    expect(result.media, isNotEmpty, reason: 'the fixture must carry images for this test to mean anything');
    final pending = <String, Completer<Uint8List>>{};
    FakeIslandHost? content;
    final diag = <String>[];

    await tester.pumpWidget(MaterialApp(
      home: PastpaperReviewScreen(
        result: result,
        islandFactory: (kind) {
          final host = FakeIslandHost(kind);
          if (kind == IslandKind.content) content = host;
          return host;
        },
        fetchMedia: (url) => (pending[url.toString()] = Completer<Uint8List>()).future,
        onClose: () {},
        // Module 1 (301) holds the fixture's figures (m1-q4-graph, m1-q6-a … d).
        questionId: result.questions.firstWhere((q) => q.moduleId == 301).id,
        onDiagnostic: (w, m) => diag.add('$w: $m'),
      ),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final island = content!;
    expect(island.postedOf<InitMessage>().single.mode, 'review');
    final shown = island.postedOf<QuestionShowMessage>();
    expect(shown, isNotEmpty, reason: 'the clicked question is on screen before any image arrived');
    expect(shown.last.qid, result.questions.firstWhere((q) => q.moduleId == 301).id);
    expect(pending, isNotEmpty, reason: 'the images were asked for, and are still on their way');
    expect(island.postedOf<MediaPutMessage>(), isEmpty, reason: 'no image bytes yet');

    // The images arrive later and are handed to the island then.
    final png = base64Decode(v1FixtureMediaBase64.values.first);
    for (final c in pending.values) {
      if (!c.isCompleted) c.complete(png);
    }
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 50));
    expect(island.postedOf<MediaPutMessage>(), isNotEmpty, reason: 'the images follow the question ($diag)');
  });
}
