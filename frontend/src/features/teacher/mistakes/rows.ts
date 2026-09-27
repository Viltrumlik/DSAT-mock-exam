/**
 * The two item-analysis payloads, flattened into one ranked list of "what the class missed".
 *
 * Pure — no JSX, no react-query — so the ranking rule can be tested on its own. It does three
 * things and nothing else: pick the miss count out of each payload's own vocabulary, keep the
 * denominator that count belongs to, and sort.
 *
 * **Two denominators, deliberately kept apart.** An assessment question is missed by
 * `students_wrong` of `students_graded` — of the answers a verdict came back for. A past-paper
 * question is missed by `wrong + omitted` of `seen` — a blank is a miss too when a student was
 * shown the question and left it. These are different populations and there is no honest way
 * to fold them into one; so each row carries its own `of`, and the list says so in words next
 * to the number. Dividing a past paper's misses by `answered` instead would hide exactly the
 * pacing problem that makes a class run out of time on Module 2.
 *
 * **Missed count first, rate second.** The owner asked for "the students' most common
 * mistakes", which is a count of students, not a percentage: a question 14 of 21 missed is a
 * lesson, a question 1 of 1 missed is a coincidence. The rate breaks ties and is shown beside
 * the count, never instead of it — and an unknown rate stays `null` rather than becoming 0%,
 * because "nobody answered this yet" and "everybody got it right" are opposite facts.
 */

import { assessmentWrongLine } from "@/features/questionAnalysis/format";
import type {
  AssessmentHomeworkAnalysis,
  PastpaperItemAnalysis,
  PastpaperPapersAnalysis,
} from "@/features/questionAnalysis/types";

/** Where a row's full question can be read from, and what to call the place it sits in. */
export type MissedSource =
  | { kind: "assessment"; setId: number; setTitle: string }
  | { kind: "pastpaper"; paperId: number; paperTitle: string };

export interface MissedRow {
  /** Stable across both kinds — a set and a paper could share a question number, not a key. */
  key: string;
  /** The database id of the question, which is what finds its body on the authoring endpoint. */
  questionId: number;
  /** What a human counts this as: "Question 4" or "Module 2 · Question 17". */
  place: string;
  /** The question in one line, as the analysis sent it. The server truncates; this does not. */
  preview: string;
  /** How many of the class missed it. */
  missed: number;
  /** Out of how many — the population `missed` was counted against. */
  of: number;
  /**
   * The row's whole claim in one sentence, denominator named. Built here rather than in the
   * component because the two kinds count different populations and the sentence is the only
   * place that difference is visible to a reader.
   */
  line: string;
  /** The rate, or `null` when there was nothing to divide by. Never invent a 0%. */
  rate: number | null;
  /**
   * Past papers only: at 90%+ wrong the backend says the answer key is likelier broken than
   * the topic is hard. Such a row still belongs at the top of a "most missed" list — a broken
   * key is the first thing to go and look at — but it must not be read as a topic to reteach.
   */
  suspectKey: boolean;
  /** The set or paper this came off, for grouping equals in the tie-break. Not rendered. */
  group: string;
  /**
   * Where the question sits in its own set or paper, as a number. `place` is the label a
   * human reads and sorts wrong — `Question 10` precedes `Question 9` alphabetically — so the
   * tie-break carries the real order beside it. A paper's modules are decades apart so that
   * Module 2's first question follows Module 1's last.
   */
  seq: number;
  source: MissedSource;
}

/**
 * Worst first: most students missed it, then the highest rate, then — among rows that are
 * genuinely equal — the set or paper's own order, by number rather than by label.
 */
function byWorstFirst(a: MissedRow, b: MissedRow): number {
  if (b.missed !== a.missed) return b.missed - a.missed;
  // A rate we do not have sorts last among equals rather than counting as zero.
  const ra = a.rate ?? -1;
  const rb = b.rate ?? -1;
  if (rb !== ra) return rb - ra;
  const group = a.group.localeCompare(b.group, "en");
  if (group !== 0) return group;
  return a.seq - b.seq;
}

function assessmentRows(data: AssessmentHomeworkAnalysis): MissedRow[] {
  return data.questions.map((row) => ({
    key: `a-${row.question_id}`,
    questionId: row.question_id,
    place: `Question ${row.position}`,
    preview: row.prompt,
    missed: row.students_wrong,
    of: row.students_graded,
    // The page's own sentence for this row, not a second copy of it: it spells the
    // denominator out, agrees its verbs with the count, and carries the "still waiting on a
    // score" clause that a hand-rolled version here kept dropping.
    line: assessmentWrongLine(row),
    rate: row.error_rate,
    suspectKey: false,
    group: row.set.title,
    seq: row.position,
    source: { kind: "assessment", setId: row.set.id, setTitle: row.set.title },
  }));
}

function paperRows(paper: PastpaperItemAnalysis): MissedRow[] {
  const paperTitle = (paper.practice_test.title || paper.practice_test.collection_name || "").trim();
  return paper.questions.map((row) => ({
    key: `p-${row.question_id}`,
    questionId: row.question_id,
    place: `${row.module_label} · Question ${row.number}`,
    preview: row.stem,
    // A blank counts as a miss here: the student was shown the question and wrote nothing,
    // which is the pacing half of the same problem. `miss_rate` is the backend's own reading
    // of that pair, so the count and the rate below it describe one fact, not two.
    missed: row.wrong + row.omitted,
    of: row.seen,
    line:
      row.seen > 0
        ? `${row.wrong + row.omitted} of ${row.seen} who saw it missed it` +
          (row.omitted > 0 ? ` · ${row.omitted} left it blank` : "")
        : `${row.wrong + row.omitted} missed it`,
    rate: row.miss_rate,
    suspectKey: row.suspect_key,
    group: paperTitle,
    seq: row.module * 1000 + row.number,
    source: { kind: "pastpaper", paperId: paper.practice_test.id, paperTitle },
  }));
}

/**
 * Every question anyone missed, worst first. Questions nobody missed are left out — this list
 * is the class's mistakes, and a question the whole class got right is not one of them. That
 * is also what makes the empty state mean something: an empty list here is genuinely "nobody
 * missed anything", never "the request failed" (which never reaches this function).
 */
export function missedRows(
  assessments: AssessmentHomeworkAnalysis | null,
  pastpapers: PastpaperPapersAnalysis | null,
): MissedRow[] {
  const rows: MissedRow[] = [];
  if (assessments) rows.push(...assessmentRows(assessments));
  if (pastpapers) for (const paper of pastpapers.papers) rows.push(...paperRows(paper));
  return rows.filter((row) => row.missed > 0).sort(byWorstFirst);
}
