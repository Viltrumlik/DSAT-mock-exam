"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, ClipboardCheck, ListChecks, Lock } from "lucide-react";
import { Card, CardHeader, EmptyState, ErrorState, LoadingState } from "@/features/classroom/ui";
import { normalizeApiError } from "@/lib/apiError";
import { questionAnalysisApi, questionAnalysisKeys } from "./api";
import { buildAssessmentCaveats, buildPastpaperCaveats, type SiblingSurface } from "./caveats";
import {
  DEFAULT_THRESHOLD,
  HELD_OUT_RATE_TITLE,
  SUSPECT_KEY_THRESHOLD,
  agree,
  analysedTotalsLine,
  flaggedHeading,
  formatCount,
  formatDeadline,
  paperLabel,
  plural,
  timeUntilDeadline,
} from "./format";
import {
  isAssessmentHomeworkAnalysis,
  isPastpaperHomeworkAnalysis,
  type AssessmentAssignmentAnalysis,
  type AssessmentGroupRow,
  type AssessmentHomeworkAnalysis,
  type HomeworkBlock,
  type PapersTruncated,
  type PastpaperAssignmentAnalysis,
  type PastpaperBreakdown,
  type PastpaperItemAnalysis,
} from "./types";
import {
  BREAKDOWN_GRID_STYLE,
  BreakdownList,
  type BreakdownRow,
} from "./components/BreakdownList";
import { AssessmentQuestionTable } from "./components/AssessmentQuestionTable";
import { Caveats } from "./components/Caveats";
import { Collapsible } from "./components/Collapsible";
import { FlaggedAssessmentCard } from "./components/FlaggedAssessmentCard";
import { FlaggedPastpaperCard } from "./components/FlaggedPastpaperCard";
import { PastpaperQuestionTable } from "./components/PastpaperQuestionTable";
import { RateValue } from "./components/Rate";

/**
 * The question statistics, inside the homework they belong to.
 *
 * The school owner's requirement in his own words: *"assessment va pastpaper statisticslar har
 * homework deadline tugaganda o'sha homeworkning ichida ko'rinib turishi kerak"* — the
 * assessment and past-paper statistics must be visible inside each homework, once that
 * homework's deadline has passed. The standalone console page still exists for looking across
 * a whole paper or class; this is the same work list where a teacher already is.
 *
 * Four states, and they are four different things:
 *
 *   - **Locked.** The deadline has not passed. No numbers, no prompts, no answer keys — the
 *     server sends the deadline and nothing else, and a teacher is told when it opens in
 *     words rather than a timestamp to subtract from today. This is not an empty state and it
 *     is emphatically not an error: the request succeeded, and "not yet" is an answer.
 *   - **Loading**, and
 *   - **Error**, which carries a retry and says outright that nothing was analysed. A failed
 *     fetch rendering as "nothing to go over" is the exact inversion this codebase has been
 *     bitten by: it tells a teacher their class got everything right.
 *   - **Data**, which leads with the work — the flagged questions, worst first — and folds the
 *     full list and the breakdowns underneath.
 *
 * Teacher-only. It is mounted from `AssignmentDetail`'s `TeacherView` and never from the
 * student branch: the flagged cards carry question prompts, recorded answer keys and which
 * questions the class fell over.
 */
export function HomeworkQuestionStatistics({
  assignmentId,
  hasAssessments,
  hasPastPapers,
  pastPaperCount,
  fullAnalysisHref,
  threshold = DEFAULT_THRESHOLD,
}: {
  assignmentId: number;
  hasAssessments: boolean;
  hasPastPapers: boolean;
  /** What the homework payload says it carries, when it can say. Used only to disclose a gap. */
  pastPaperCount?: number | null;
  /** The standalone console page, when this render can reach it. */
  fullAnalysisHref?: string | null;
  threshold?: number;
}) {
  const assessments = useQuery({
    queryKey: questionAnalysisKeys.assignmentAssessments(assignmentId, threshold),
    queryFn: () =>
      questionAnalysisApi.assessmentsForAssignment({ assignment: assignmentId, threshold }),
    enabled: hasAssessments && assignmentId > 0,
  });
  const pastpapers = useQuery({
    queryKey: questionAnalysisKeys.assignmentPastpapers(assignmentId, threshold),
    queryFn: () =>
      questionAnalysisApi.pastpapersForAssignment({ assignment: assignmentId, threshold }),
    enabled: hasPastPapers && assignmentId > 0,
  });

  // Both endpoints answer the same question about the same homework, so either one can say
  // whether the deadline has passed — but the verdict is only ever the server's.
  const homework: HomeworkBlock | null =
    assessments.data?.homework ?? pastpapers.data?.homework ?? null;

  const live: UseQueryResult<unknown>[] = [];
  if (hasAssessments) live.push(assessments as UseQueryResult<unknown>);
  if (hasPastPapers) live.push(pastpapers as UseQueryResult<unknown>);
  const everythingFailed = live.length > 0 && live.every((q) => q.isError);
  const firstError = live.find((q) => q.isError)?.error;

  // Only one of the two is on screen when the homework carries only one kind, and the note
  // about the other cohort would then point at a card that is not there.
  const sibling: SiblingSurface = hasAssessments && hasPastPapers ? "section" : null;

  return (
    <section className="space-y-4" aria-labelledby={`hw-stats-${assignmentId}`}>
      <div>
        <h2
          id={`hw-stats-${assignmentId}`}
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          Question statistics
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          What this class missed on the work in this homework. A question{" "}
          {formatCount(threshold)}% or more of them got wrong is one the school&apos;s rule says
          to go back over.
        </p>
      </div>

      {homework == null && everythingFailed ? (
        <Card className="cr-card">
          <ErrorState
            title="We could not load this homework's statistics."
            message={`${normalizeApiError(firstError).message} Nothing was analysed — this is not a homework with nothing to go over.`}
            onRetry={() => {
              if (hasAssessments) void assessments.refetch();
              if (hasPastPapers) void pastpapers.refetch();
            }}
          />
        </Card>
      ) : homework == null ? (
        <Card className="cr-card">
          <LoadingState label="Counting this homework across the class…" />
        </Card>
      ) : homework.locked ? (
        <LockedPanel homework={homework} />
      ) : (
        <>
          <DeadlineLine homework={homework} />

          {hasAssessments && (
            <AssessmentSection
              query={assessments}
              threshold={threshold}
              sibling={sibling}
              onRetry={() => void assessments.refetch()}
            />
          )}

          {hasPastPapers && (
            <PastPaperSection
              query={pastpapers}
              threshold={threshold}
              sibling={sibling}
              declaredPapers={pastPaperCount ?? null}
              onRetry={() => void pastpapers.refetch()}
            />
          )}

          {fullAnalysisHref ? (
            <p className="px-1 text-xs text-muted-foreground">
              <Link
                href={fullAnalysisHref}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                Open the full question analysis
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>{" "}
              to look across a whole paper or the whole class, or to move the{" "}
              {formatCount(threshold)}% cut-off.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * The locked state: a deadline, in words, and nothing whatsoever from the analysis.
 *
 * Its own surface rather than an `EmptyState` or an `ErrorState`, because it is neither. Grey
 * "nothing here" would say the homework has no questions worth going over; a rose error panel
 * would say something broke. What is true is narrower and better news than both: the work
 * exists, it is being done right now, and the numbers arrive on a date this panel names.
 */
function LockedPanel({ homework }: { homework: HomeworkBlock }) {
  const deadline = formatDeadline(homework.due_at);
  const soon = timeUntilDeadline(homework.due_at);
  return (
    <Card className="cr-card border-primary/25 bg-primary/5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p data-locked-title className="text-sm font-semibold text-foreground">
            The statistics open when this homework&apos;s deadline passes
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {deadline ? (
              <>
                The deadline is{" "}
                <span className="font-semibold text-foreground">{deadline}</span>
                {soon ? ` — ${soon}` : ""}. Every question in this homework shows up here right
                after that, with how the class did on it.
              </>
            ) : (
              <>
                Every question in this homework shows up here once the deadline passes, with how
                the class did on it.
              </>
            )}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Nothing is counted or shown before then — the questions, the answer keys and the
            wrong answers all stay out of sight while students are still working.
          </p>
        </div>
      </div>
    </Card>
  );
}

/** The one line of deadline context over the numbers. Never arithmetic for the reader to do. */
function DeadlineLine({ homework }: { homework: HomeworkBlock }) {
  if (homework.state === "no_deadline") {
    return (
      <p data-deadline-line className="px-1 text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">This homework has no deadline.</span> The
        figures cover whoever has handed in so far, and they will keep moving as more students
        do.
      </p>
    );
  }
  const deadline = formatDeadline(homework.due_at);
  if (!deadline) return null;
  return (
    <p data-deadline-line className="px-1 text-xs leading-relaxed text-muted-foreground">
      <span className="font-semibold text-foreground">Deadline passed:</span> {deadline}. Anything
      handed in after it is counted here too, so these figures can still move.
    </p>
  );
}

/** Label + value, in one wrapping row. The compact stand-in for a row of stat cards. */
function MetaRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {item.label}
          </dt>
          <dd className="text-sm font-semibold tabular-nums text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function toAssessmentRows(groups: AssessmentGroupRow[]): BreakdownRow[] {
  return groups.map((group) => ({
    id: String(group.key ?? "untagged"),
    label: group.label,
    questions: group.questions,
    wrong: group.students_wrong,
    // Graded, not answered: it is what the rate on the same row divides by.
    denominator: group.students_graded,
    errorRate: group.error_rate,
    flagged: group.needs_analysis_count,
    isUntagged: group.key === "untagged",
  }));
}

function toPastpaperRows(breakdown: PastpaperBreakdown | undefined): BreakdownRow[] {
  return (breakdown?.groups ?? []).map((group) => ({
    id: String(group.key ?? "untagged"),
    label: group.label,
    questions: group.questions,
    wrong: group.wrong,
    denominator: group.answered,
    errorRate: group.error_rate,
    flagged: group.needs_analysis_count,
    heldOut: group.suspect_key_count,
    analysedQuestions: group.analysed_questions,
    isUntagged: group.key === null,
  }));
}

/** The assessment half, labelled so no number on screen is ambiguous about where it came from. */
function AssessmentSection({
  query,
  threshold,
  sibling,
  onRetry,
}: {
  query: UseQueryResult<AssessmentAssignmentAnalysis>;
  threshold: number;
  sibling: SiblingSurface;
  onRetry: () => void;
}) {
  // A locked payload is caught by the caller, which renders the lock instead of this section.
  // The guard is what lets the rest of the function read the analysis fields at all — and it
  // is the reason no cast is needed to do it.
  const data =
    query.data && isAssessmentHomeworkAnalysis(query.data) ? query.data : null;

  return (
    <Card className="cr-card space-y-4">
      <CardHeader
        title="Assessments in this homework"
        description={
          data
            ? `${plural(data.summary.sets, "set")} · every rate is a share of the answers that came back graded.`
            : undefined
        }
      />
      {query.isError ? (
        // Error first and alone. Falling through to the "nothing here" branch would tell a
        // teacher this class had nothing to re-teach.
        <ErrorState
          title="We could not load the assessment statistics."
          message={`${normalizeApiError(query.error).message} Nothing was analysed — this is not an assessment with nothing to go over.`}
          onRetry={onRetry}
        />
      ) : !data ? (
        <LoadingState label="Working out which questions were missed…" />
      ) : data.summary.questions_total === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No assessment questions to count yet"
          description="The set attached to this homework has no questions the analysis can read. Once it does, every one of them shows up here with how the class did on it."
        />
      ) : (
        <AssessmentBody data={data} threshold={threshold} sibling={sibling} />
      )}
    </Card>
  );
}

function AssessmentBody({
  data,
  threshold,
  sibling,
}: {
  data: AssessmentHomeworkAnalysis;
  threshold: number;
  sibling: SiblingSurface;
}) {
  const typeRows = useMemo(() => toAssessmentRows(data.by_question_type), [data]);
  const skillRows = useMemo(() => toAssessmentRows(data.by_skill), [data]);
  const domainRows = useMemo(() => toAssessmentRows(data.by_domain), [data]);
  const caveats = useMemo(() => buildAssessmentCaveats(data, sibling), [data, sibling]);

  return (
    <div className="space-y-4">
      <MetaRow
        items={[
          { label: "To go over", value: formatCount(data.summary.questions_flagged) },
          {
            label: "Questions analysed",
            value: `${formatCount(data.summary.questions_analysed)}/${formatCount(data.summary.questions_total)}`,
          },
          { label: "Students counted", value: formatCount(data.summary.students_counted) },
          {
            label: "Awaiting grading",
            value: formatCount(data.summary.questions_awaiting_grading),
          },
        ]}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Who is counted:</span>{" "}
        {plural(data.summary.students_counted, "student")} — everyone given{" "}
        {agree(data.summary.sets, "this set", "these sets")}, including any who have since left
        the class.
      </p>

      <Caveats items={caveats} />

      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {flaggedHeading(data.needs_analysis.length)}
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Ranked worst first, from the assessment work in this homework.
        </p>
        {data.needs_analysis.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={`Nothing is over ${formatCount(threshold)}% here`}
            description="No single assessment question tripped the threshold on the work that has been graded so far. The full list below shows how the class did on every question."
          />
        ) : (
          <ul data-flagged-list className="mt-3 space-y-3">
            {data.needs_analysis.map((row) => (
              <FlaggedAssessmentCard key={row.question_id} row={row} />
            ))}
          </ul>
        )}
      </div>

      <Collapsible
        summary="Statistics by question type"
        hint="type · skill · domain"
        className="bg-transparent"
      >
        {data.taxonomy_coverage.note ? (
          <p className="mb-3 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {data.taxonomy_coverage.note}
          </p>
        ) : null}
        <div className="gap-4" style={BREAKDOWN_GRID_STYLE}>
          <BreakdownList
            title="By question type"
            description="Pooled across the questions in each type — never an average of their percentages."
            rows={typeRows}
            denominatorNoun="graded answers"
            emptyMessage="No graded answers to break down yet."
          />
          <BreakdownList
            title="By SAT skill"
            description="Only questions linked to the question bank carry a skill."
            rows={skillRows}
            denominatorNoun="graded answers"
            emptyMessage="There is no skill breakdown for this homework — see the note above."
          />
          <BreakdownList
            title="By domain"
            description="The skill's parent domain, where one is recorded."
            rows={domainRows}
            denominatorNoun="graded answers"
            emptyMessage="There is no domain breakdown for this homework — see the note above."
          />
        </div>
      </Collapsible>

      <Collapsible
        summary="Every assessment question in this homework"
        hint={`${plural(data.questions.length, "question")}, worst first`}
        className="bg-transparent"
      >
        <AssessmentQuestionTable rows={data.questions} />
      </Collapsible>
    </div>
  );
}

/** The past-paper half. One homework can carry several papers, and each keeps its own card. */
function PastPaperSection({
  query,
  threshold,
  sibling,
  declaredPapers,
  onRetry,
}: {
  query: UseQueryResult<PastpaperAssignmentAnalysis>;
  threshold: number;
  sibling: SiblingSurface;
  declaredPapers: number | null;
  onRetry: () => void;
}) {
  const data = query.data && isPastpaperHomeworkAnalysis(query.data) ? query.data : null;
  const papers = data?.papers ?? [];

  // Two ways this can be short, and both have to be said out loud. The server discloses a cap
  // it applied; and where the homework payload resolved its own papers, a shorter list than
  // that is a gap the reader would otherwise never see.
  const truncated: PapersTruncated | null =
    data?.papers_truncated ??
    (declaredPapers != null && papers.length > 0 && declaredPapers > papers.length
      ? { analysed: papers.length, total: declaredPapers, note: null }
      : null);

  return (
    <Card className="cr-card space-y-4">
      <CardHeader
        title="Past papers in this homework"
        description={
          papers.length > 1
            ? `${plural(papers.length, "paper")} · each one counted on its own.`
            : "Wrong answers over the students who answered; blanks are counted separately."
        }
      />
      {query.isError ? (
        <ErrorState
          title="We could not load the past-paper statistics."
          message={`${normalizeApiError(query.error).message} Nothing was analysed — this is not a paper with nothing to go over.`}
          onRetry={onRetry}
        />
      ) : !data ? (
        <LoadingState label="Counting this homework's papers across the class…" />
      ) : papers.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No past paper here could be analysed"
          description="This homework carries past-paper work, but none of it came back as an analysable paper. Open the full question analysis to pick the paper by hand."
        />
      ) : (
        <div className="space-y-6">
          {truncated ? (
            <p
              data-papers-truncated
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium leading-relaxed text-amber-900 dark:text-amber-100"
            >
              {/* The server words this itself — it knows the cap it applied and where the
                  rest can be read. The sentence below is the fallback for a gap this page
                  worked out on its own, from what the homework said it carried. */}
              {truncated.note ??
                (truncated.total > truncated.analysed
                  ? `This homework carries ${plural(truncated.total, "past paper")}; ${formatCount(
                      truncated.analysed,
                    )} of them ${agree(
                      truncated.analysed,
                      "is",
                      "are",
                    )} analysed here. The rest are not counted in anything below — open the full question analysis to read them.`
                  : "Not every past paper on this homework is analysed here. Open the full question analysis to read the rest.")}
            </p>
          ) : null}
          {papers.map((paper) => (
            <PaperBlock
              key={paper.practice_test.id}
              paper={paper}
              threshold={threshold}
              sibling={sibling}
              showTitle={papers.length > 1}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function PaperBlock({
  paper,
  threshold,
  sibling,
  showTitle,
}: {
  paper: PastpaperItemAnalysis;
  threshold: number;
  sibling: SiblingSurface;
  showTitle: boolean;
}) {
  const breakdowns = paper.groups;
  const typeRows = useMemo(() => toPastpaperRows(breakdowns?.question_type), [breakdowns]);
  const formatRows = useMemo(() => toPastpaperRows(breakdowns?.format), [breakdowns]);
  const skillRows = useMemo(() => toPastpaperRows(breakdowns?.skill), [breakdowns]);
  const domainRows = useMemo(() => toPastpaperRows(breakdowns?.domain), [breakdowns]);
  const difficultyRows = useMemo(() => toPastpaperRows(breakdowns?.difficulty), [breakdowns]);
  const caveats = useMemo(() => buildPastpaperCaveats(paper, sibling), [paper, sibling]);
  const title = paperLabel(paper.practice_test);

  // "Nobody sat it" and "every sitting was set aside as corrupt" are different facts, and only
  // the notes can tell them apart — so the notes stay even when there is nothing to report.
  if (paper.data_quality.students_counted === 0) {
    return (
      <div className="space-y-3">
        {showTitle ? <PaperTitle title={title} /> : null}
        <EmptyState
          icon={BookOpen}
          title="Nobody in this class has a counted sitting of this paper"
          description={
            paper.data_quality.attempts_considered > 0
              ? `${plural(paper.data_quality.attempts_considered, "sitting")} of this paper ${agree(paper.data_quality.attempts_considered, "exists", "exist")} for this class, but none could be counted. The notes below say which were set aside, and why.`
              : "Once a student on the roster finishes this paper, every question on it shows up here."
          }
        />
        <Caveats items={caveats} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showTitle ? <PaperTitle title={title} /> : null}
      <MetaRow
        items={[
          { label: "To go over", value: formatCount(paper.totals.needs_analysis) },
          { label: "Check the key", value: formatCount(paper.totals.suspect_key) },
          {
            label: "Students counted",
            value: `${formatCount(paper.data_quality.students_counted)}/${formatCount(paper.data_quality.roster)}`,
          },
          { label: "Left blank", value: formatCount(paper.totals.omitted) },
        ]}
      />

      {/* The rate and the raw tallies describe different populations whenever a key is
          suspect, so the page prints the rate beside the counts that actually produced it. */}
      <p data-paper-rate className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Error rate for this paper:</span>{" "}
        <RateValue
          value={paper.totals.error_rate}
          emptyTitle={
            paper.totals.analysed.questions === 0 && paper.totals.questions > 0
              ? HELD_OUT_RATE_TITLE
              : undefined
          }
          className="font-semibold"
        />{" "}
        — {analysedTotalsLine(paper.totals)}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Who is counted:</span> the{" "}
        {plural(paper.data_quality.roster, "student")} on this class&apos;s roster today —{" "}
        {formatCount(paper.data_quality.students_counted)} have a counted sitting. Students who
        have left the class are not here.
      </p>

      <Caveats items={caveats} />

      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {flaggedHeading(paper.needs_analysis.length)}
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Ranked worst first{showTitle ? `, on ${title}` : ""}. A question at{" "}
          {formatCount(SUSPECT_KEY_THRESHOLD)}% or above is flagged as a likely broken answer
          key, not a hard topic.
        </p>
        {paper.needs_analysis.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={`Nothing is over ${formatCount(threshold)}% on this paper`}
            description="No single question tripped the threshold for this class. The full list below still shows how they did on every question, blanks included."
          />
        ) : (
          <ul data-flagged-list className="mt-3 space-y-3">
            {paper.needs_analysis.map((row) => (
              <FlaggedPastpaperCard key={row.question_id} row={row} />
            ))}
          </ul>
        )}
      </div>

      <Collapsible
        summary="Statistics by question type"
        hint="type · format · difficulty · skill · domain"
        className="bg-transparent"
      >
        <div className="gap-4" style={BREAKDOWN_GRID_STYLE}>
          <BreakdownList
            title="Question type"
            description="Math, Reading or Writing. Every question carries one."
            rows={typeRows}
            denominatorNoun="answers"
            emptyMessage="No answers to break down yet."
          />
          <BreakdownList
            title="Format"
            description="Grid-in versus multiple choice — a pacing tell as much as a topic one."
            rows={formatRows}
            denominatorNoun="answers"
            emptyMessage="No answers to break down yet."
          />
          <BreakdownList
            title="Difficulty"
            description="From the question bank, where the paper is linked to it."
            rows={difficultyRows}
            denominatorNoun="answers"
            note={coverageNote("difficulty", breakdowns?.difficulty)}
            emptyMessage="No difficulty breakdown for this paper."
          />
          <BreakdownList
            title="SAT skill"
            description="The finest grain the paper carries — this is the topic question."
            rows={skillRows}
            denominatorNoun="answers"
            note={coverageNote("skill", breakdowns?.skill)}
            emptyMessage="No skill breakdown for this paper."
          />
          <BreakdownList
            title="Domain"
            description="The skill's parent domain."
            rows={domainRows}
            denominatorNoun="answers"
            note={coverageNote("domain", breakdowns?.domain)}
            emptyMessage="No domain breakdown for this paper."
          />
        </div>
      </Collapsible>

      <Collapsible
        summary="Every question on this paper"
        hint={`${plural(paper.questions.length, "question")}, in paper order`}
        className="bg-transparent"
      >
        <PastpaperQuestionTable rows={paper.questions} />
      </Collapsible>
    </div>
  );
}

function PaperTitle({ title }: { title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
      <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">{title}</span>
    </h3>
  );
}

/**
 * How much of the paper carries this tag, in words. An empty breakdown with no explanation
 * reads as a broken page; ~2000 legacy questions genuinely carry no skill.
 */
function coverageNote(noun: string, breakdown: PastpaperBreakdown | undefined): string | null {
  const coverage = breakdown?.coverage;
  if (!coverage || coverage.total === 0) return null;
  if (coverage.tagged === coverage.total) return null;
  if (coverage.tagged === 0) {
    return `No question on this paper carries a ${noun}, so every one of them sits in the Untagged row below.`;
  }
  return `${formatCount(coverage.total - coverage.tagged)} of ${plural(
    coverage.total,
    "question",
  )} carry no ${noun}; they are kept in their own Untagged row rather than folded into a real one.`;
}
