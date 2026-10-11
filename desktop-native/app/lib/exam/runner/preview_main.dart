// Fixture-mode preview of the runner for development on macOS/Windows without the engine or
// a real island: `flutter run -d macos -t lib/exam/runner/preview_main.dart`.
// It mounts ExamRunnerScreen over a FakeExamSession and FakeIslandHosts (the question card is
// a placeholder). `--dart-define=PAPER=math|rw|midterm` picks the fixture.
import 'package:flutter/material.dart';

import '../../island/fake_island_host.dart';
import '../fake_exam_session.dart';
import 'runner.dart';

void main() => runApp(const RunnerPreviewApp());

class RunnerPreviewApp extends StatefulWidget {
  const RunnerPreviewApp({super.key, this.paper = const String.fromEnvironment('PAPER', defaultValue: 'rw')});

  final String paper;

  @override
  State<RunnerPreviewApp> createState() => _RunnerPreviewAppState();
}

class _RunnerPreviewAppState extends State<RunnerPreviewApp> {
  late FakeExamSession _session = _make();
  final FakeRunnerWindowControls _window = FakeRunnerWindowControls();
  RunnerExit? _exit;

  FakeExamSession _make() => switch (widget.paper) {
    'math' => FakeExamSession.math(),
    'midterm' => FakeExamSession.midterm(),
    _ => FakeExamSession.readingWriting(),
  };

  @override
  void dispose() {
    _session.dispose();
    _window.dispose();
    super.dispose();
  }

  void _restart() => setState(() {
    _session.dispose();
    _session = _make();
    _exit = null;
  });

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    home: _exit == null
        ? ExamRunnerScreen(
            key: ObjectKey(_session),
            session: _session,
            islandFactory: (kind) => FakeIslandHost(kind),
            window: _window,
            onExit: (e) => setState(() => _exit = e),
          )
        : ColoredBox(
            color: Colors.white,
            child: Center(
              child: TextButton(
                onPressed: _restart,
                child: Text('Left the runner: ${_exit!.reason.name} — start again'),
              ),
            ),
          ),
  );
}
