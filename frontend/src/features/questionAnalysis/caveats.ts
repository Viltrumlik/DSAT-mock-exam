/**
 * The footnotes that make the numbers mean something, built once for both surfaces.
 *
 * The standalone console page and the section inside a homework show the same figures from
 * the same two endpoints, so they owe a reader the same disclosures: what the denominator is,
 * which sitting counts, what was excluded and why, and which questions were held out as
 * likely broken answer keys. Building them here rather than inside each panel is the only way
 * a disclosure cannot exist on one surface and quietly not on the other.
 *
 * Only one sentence differs between the surfaces, and it is the cohort one: the two endpoints
 * genuinely scope their cohort differently for the same class (everyone who was *given* a set,
 * versus the roster as it stands *today*), so a reader comparing them sees two class sizes.
 * The sentence has to name where the other number is, and on the console that is a tab while
 * inside a homework it is a card further down the same page.
 */
import {
  SUSPECT_KEY_THRESHOLD,
  agree,
  formatCount,
  plural,
} from "./format";
import type { Caveat } from "./components/Caveats";
import type { AssessmentItemAnalysis, PastpaperItemAnalysis } from "./types";

/**
 * Where the *other* cohort's numbers are, from the reader's point of view.
 *
 * `null` when the homework carries only one of the two kinds — there is no second class size
 * on screen, so the comparison would send a teacher looking for a card that is not there.
 */
export type SiblingSurface = "tab" | "section" | null;

function siblingPhrase(sibling: SiblingSurface, other: "assessment" | "past-paper"): string {
  if (sibling === "tab") {
    return other === "past-paper" ? "The Past papers tab" : "The Assessments tab";
  }
  return other === "past-paper"
    ? "The past-paper figures in this homework"
    : "The assessment figures in this homework";
}

/** The assessments cohort: everyone who was given the set, leavers included. */
export function assessmentCohortNote(sibling: SiblingSurface): string {
  const base =
    "These figures count every student who was given a set, including students who have since left the class.";
  if (sibling === null) return base;
  return `${base} ${siblingPhrase(
    sibling,
    "past-paper",
  )} filters to the class roster as it stands today, so the two can report different class sizes for the same class.`;
}

/** The past-paper cohort: the roster as it stands today, leavers dropped. */
export function pastpaperCohortNote(sibling: SiblingSurface): string {
  const base = "These figures count only students on the class roster as it stands today.";
  if (sibling === null) return base;
  return `${base} ${siblingPhrase(
    sibling,
    "assessment",
  )} counts everyone who was given a set, including students who have since left the class, so the two can report different class sizes for the same class.`;
}

/** Everything a reader needs to know about how the assessment numbers were counted. */
export function buildAssessmentCaveats(
  data: AssessmentItemAnalysis,
  sibling: SiblingSurface,
): Caveat[] {
  const caveats: Caveat[] = [
    {
      id: "denominator",
      tone: "info",
      text:
        `Every rate here is a share of answers that came back graded (denominator: ${data.denominator}). ` +
        "A skipped question leaves no answer at all, so a student who never reached one is in no denominator.",
    },
    {
      id: "counting",
      tone: "info",
      text: `Each student is counted once — ${data.counting_rule}. A retry serves back exactly the questions they got wrong, so later attempts would bias this list.`,
    },
    {
      id: "cohort",
      tone: "info",
      text: assessmentCohortNote(sibling),
    },
  ];
  if (data.summary.questions_awaiting_grading > 0) {
    caveats.push({
      id: "awaiting",
      tone: "warning",
      text: `${plural(data.summary.questions_awaiting_grading, "question")} ${agree(data.summary.questions_awaiting_grading, "has", "have")} answers but no verdict yet, so ${agree(data.summary.questions_awaiting_grading, "it carries", "they carry")} no rate and cannot be flagged either way.`,
    });
  }
  if (data.excluded.retired_questions > 0) {
    caveats.push({
      id: "retired",
      tone: "warning",
      text: `${plural(data.excluded.retired_questions, "answer")} ${agree(data.excluded.retired_questions, "belongs", "belong")} to questions since retired in the builder, and ${agree(data.excluded.retired_questions, "is", "are")} excluded from every number here.`,
    });
  }
  return caveats;
}

/** Everything a reader needs to know about how one past paper's numbers were counted. */
export function buildPastpaperCaveats(
  data: PastpaperItemAnalysis,
  sibling: SiblingSurface,
): Caveat[] {
  const dq = data.data_quality;
  const caveats: Caveat[] = [
    {
      id: "denominator",
      tone: "info",
      text:
        `The headline rate is wrong answers over the students who answered (denominator: ${data.denominator}). ` +
        "Blank answers are counted separately as “left it blank”, because running out of time is a pacing problem and a wrong answer is a teaching one.",
    },
    {
      id: "selection",
      tone: "info",
      // The rule is "first *countable*", not "first recorded", and the difference is a real
      // population: a student whose first sitting carried the copy bug used to be dropped
      // from the paper entirely. Now only that sitting is discarded and their clean re-sit
      // counts — which is the whole reason they sat it again.
      text: `Each student's first completed sitting is the one that counts, so a student who sat this paper three times does not carry triple weight. If that first sitting was corrupted by the July 2026 submit bug it is discarded and their next clean sitting counts instead — the bug is exactly why a student would have sat the paper again. ${formatCount(
        dq.students_counted,
      )} of ${plural(dq.roster, "student")} on the roster have a counted sitting.`,
    },
  ];
  if (dq.excluded.copied > 0) {
    caveats.push({
      id: "copied",
      tone: "warning",
      text: `${plural(
        dq.excluded.copied,
        "sitting",
      )} ${agree(dq.excluded.copied, "was", "were")} excluded as corrupt: the Module 2 answers were recorded under Module 1's question ids by a submit bug fixed in July 2026. That work is in none of the numbers here — but it is the sitting that was discarded, not the student. Anyone who sat this paper again cleanly is counted on that sitting.`,
    });
  }
  if (dq.excluded.repeat_sitting > 0) {
    caveats.push({
      id: "repeat",
      tone: "info",
      text: `${plural(
        dq.excluded.repeat_sitting,
        "repeat sitting",
      )} of this paper ${agree(dq.excluded.repeat_sitting, "was", "were")} set aside — once a student has one counted sitting, their later ones do not count again.`,
    });
  }
  if (dq.suspect_key_questions > 0) {
    caveats.push({
      id: "suspect",
      tone: "warning",
      text: `${plural(
        dq.suspect_key_questions,
        "question",
      )} ${agree(dq.suspect_key_questions, "is", "are")} at ${SUSPECT_KEY_THRESHOLD}% or above. That is far more often a wrong answer key than a hard question — check the key before putting it on a lesson plan. ${agree(
        dq.suspect_key_questions,
        "It is",
        "They are",
      )} held out of the paper's rate and of every statistic below, so one broken key cannot make a topic look worse than the class is; ${agree(
        dq.suspect_key_questions,
        "it stays",
        "they stay",
      )} on the list to go over, because that is where a person has to look.`,
    });
  }
  caveats.push({
    id: "cohort",
    tone: "info",
    text: pastpaperCohortNote(sibling),
  });
  if (data.unclassified_total > 0) {
    caveats.push({
      id: "untagged",
      tone: "info",
      text: `${plural(
        data.unclassified_total,
        "question",
      )} on this paper ${agree(data.unclassified_total, "carries", "carry")} no SAT skill, and ${formatCount(
        data.unclassified_wrong,
      )} wrong answers landed on them. They are reported in their own Untagged row, never folded into a skill.`,
    });
  }
  return caveats;
}
