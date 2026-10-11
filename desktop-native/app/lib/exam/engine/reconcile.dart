// Crash/reopen reconciliation (design_data_server.md §1.10):
//   final = server_saved ⊕ local journal entries with seq > acked_seq[module]
// The device is the single writer, so a local change the server has not acknowledged wins.
import 'exam_store.dart';

/// One module's answers and flags.
class ModuleWork {
  ModuleWork({Map<int, String>? answers, Set<int>? flagged})
      : answers = answers ?? {},
        flagged = flagged ?? {};

  final Map<int, String> answers;
  final Set<int> flagged;

  ModuleWork copy() => ModuleWork(answers: Map.of(answers), flagged: Set.of(flagged));

  /// Applies one journal row (answer / clear / flag / unflag; other ops are markers).
  void apply(JournalEntry e) {
    final q = e.qid;
    if (q == null) return;
    switch (e.op) {
      case JournalOp.answer:
        final v = e.value ?? '';
        if (v.isEmpty) {
          answers.remove(q);
        } else {
          answers[q] = v;
        }
      case JournalOp.clear:
        answers.remove(q);
      case JournalOp.flag:
        flagged.add(q);
      case JournalOp.unflag:
        flagged.remove(q);
      case JournalOp.submit:
      case JournalOp.deadline:
      case JournalOp.offscreen:
        break;
    }
  }

  bool sameAs(ModuleWork other) {
    if (answers.length != other.answers.length || flagged.length != other.flagged.length) return false;
    for (final e in answers.entries) {
      if (other.answers[e.key] != e.value) return false;
    }
    return flagged.containsAll(other.flagged);
  }

  @override
  String toString() => 'ModuleWork($answers, flagged: $flagged)';
}

/// `server ⊕ newer` — the server's saved answers with every unacknowledged local change on top.
ModuleWork reconcileModule({
  required Map<int, String> serverAnswers,
  required Iterable<int> serverFlags,
  required List<JournalEntry> newer,
}) {
  final out = ModuleWork(
    answers: {
      for (final e in serverAnswers.entries)
        if (e.value.isNotEmpty) e.key: e.value,
    },
    flagged: serverFlags.toSet(),
  );
  for (final e in newer) {
    out.apply(e);
  }
  return out;
}
