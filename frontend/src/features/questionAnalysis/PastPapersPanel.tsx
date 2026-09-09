"use client";

import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, KeyRound, ListChecks } from "lucide-react";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Select,
  StatCard,
} from "@/features/classroom/ui";
import { normalizeApiError } from "@/lib/apiError";
import { questionAnalysisApi, questionAnalysisKeys } from "./api";
import { buildPastpaperCaveats } from "./caveats";
import {
  HELD_OUT_RATE_TITLE,
  SUSPECT_KEY_THRESHOLD,
  agree,
  analysedTotalsLine,
  flaggedHeading,
  formatCount,
  paperLabel,
  plural,
} from "./format";
import type { PastPaperOption, PastpaperBreakdown } from "./types";
import {
  BREAKDOWN_GRID_STYLE,
  BreakdownList,
  type BreakdownRow,
} from "./components/BreakdownList";
import { Caveats } from "./components/Caveats";
import { Collapsible } from "./components/Collapsible";
import { FlaggedPastpaperCard } from "./components/FlaggedPastpaperCard";
import { PastpaperQuestionTable } from "./components/PastpaperQuestionTable";
import { RateValue } from "./components/Rate";
import { useQueryErrorToast } from "./useQueryErrorToast";

/** `key === null` is the untagged bucket on every past-paper breakdown. */
function toBreakdownRows(breakdown: PastpaperBreakdown | undefined): BreakdownRow[] {
  return (breakdown?.groups ?? []).map((group) => ({
    id: String(group.key ?? "untagged"),
    label: group.label,
    questions: group.questions,
    wrong: group.wrong,
    denominator: group.answered,
    errorRate: group.error_rate,
    flagged: group.needs_analysis_count,
    // The rate, the counts beside it and the bar all describe `analysed_questions`, not
    // `questions`. Carrying both across is what lets the row say so out loud.
    heldOut: group.suspect_key_count,
    analysedQuestions: group.analysed_questions,
    isUntagged: group.key === null,
  }));
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

/** Papers grouped by their collection, so a long library is navigable in one select. */
function groupPapers(papers: PastPaperOption[]): { name: string; papers: PastPaperOption[] }[] {
  const groups = new Map<string, PastPaperOption[]>();
  for (const paper of papers) {
    const name = (paper.collection_name ?? "").trim() || "Ungrouped";
    const bucket = groups.get(name);
    if (bucket) bucket.push(paper);
    else groups.set(name, [paper]);
  }
  return [...groups.entries()]
    .map(([name, list]) => ({ name, papers: list }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * "Which past-paper questions do I need to go back over?" plus the by-type statistics the
 * school owner asked for alongside them.
 *
 * Mounted with a `key` of the classroom id, so the chosen paper resets when the class does.
 */
export function PastPapersPanel({
  classroomId,
  threshold,
}: {
  classroomId: number;
  threshold: number;
}) {
  const [practiceTestId, setPracticeTestId] = useState<number | null>(null);
  const selectId = useId();

  const papersQuery = useQuery({
    queryKey: questionAnalysisKeys.pastPapers(),
    queryFn: () => questionAnalysisApi.pastPapers(),
    staleTime: 5 * 60_000,
  });
  useQueryErrorToast(papersQuery.error, "Past-paper library");

  const analysisQuery = useQuery({
    queryKey: questionAnalysisKeys.pastpaper(classroomId, practiceTestId ?? 0, threshold),
    queryFn: () => {
      // A guard, not a `!`: the query is disabled without a paper, and if that ever stops
      // being true this throws into the error branch instead of asking the server about
      // practice test 0 and rendering the 404 as an empty paper.
      if (practiceTestId == null) throw new Error("No past paper is selected.");
      return questionAnalysisApi.pastpaper({
        classroom: classroomId,
        practiceTest: practiceTestId,
        threshold,
      });
    },
    enabled: classroomId > 0 && practiceTestId != null,
  });
  useQueryErrorToast(analysisQuery.error, "Past-paper analysis");

  const papers = papersQuery.data;
  const grouped = useMemo(() => groupPapers(papers ?? []), [papers]);
  const data = analysisQuery.data;

  const breakdowns = data?.groups;
  const typeRows = useMemo(() => toBreakdownRows(breakdowns?.question_type), [breakdowns]);
  const formatRows = useMemo(() => toBreakdownRows(breakdowns?.format), [breakdowns]);
  const skillRows = useMemo(() => toBreakdownRows(breakdowns?.skill), [breakdowns]);
  const domainRows = useMemo(() => toBreakdownRows(breakdowns?.domain), [breakdowns]);
  const difficultyRows = useMemo(() => toBreakdownRows(breakdowns?.difficulty), [breakdowns]);

  // The two endpoints scope their cohort differently for the same class, and this page
  // shows the other one in a sibling tab — the note has to say where that number is.
  const caveats = data ? buildPastpaperCaveats(data, "tab") : [];

  return (
    <div className="space-y-5">
      <Card>
        {papersQuery.isError ? (
          <ErrorState
            title="We could not load the past-paper library."
            message={`${normalizeApiError(papersQuery.error).message} No paper could be listed — this is not an empty library.`}
            onRetry={() => void papersQuery.refetch()}
          />
        ) : !papers ? (
          <LoadingState label="Loading past papers…" />
        ) : papers.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No past papers in the library yet"
            description="Once past papers are published, pick one here to see which of its questions your class missed."
          />
        ) : (
          <Field
            label="Past paper"
            htmlFor={selectId}
            hint="Pick the paper you want to go over. Only papers your class has actually sat will have numbers behind them."
          >
            <Select
              id={selectId}
              value={practiceTestId == null ? "" : String(practiceTestId)}
              onChange={(e) =>
                setPracticeTestId(e.target.value === "" ? null : Number(e.target.value))
              }
            >
              <option value="">Choose a past paper…</option>
              {grouped.map((group) => (
                <optgroup key={group.name} label={group.name}>
                  {group.papers.map((paper) => (
                    <option key={paper.id} value={paper.id}>
                      {paperLabel(paper)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
        )}
      </Card>

      {practiceTestId == null ? (
        papers && papers.length > 0 ? (
          <Card>
            <EmptyState
              icon={BookOpen}
              title="Pick a past paper to analyse"
              description="Every question on it is counted across the class, and the ones a quarter or more of them got wrong come out on top."
            />
          </Card>
        ) : null
      ) : analysisQuery.isError ? (
        // Error first and alone: a failed fetch must never render as "nothing to go over".
        <ErrorState
          title="We could not load this paper's analysis."
          message={`${normalizeApiError(analysisQuery.error).message} Nothing below was analysed — this is not a clean paper.`}
          onRetry={() => void analysisQuery.refetch()}
        />
      ) : !data ? (
        <LoadingState label="Counting this paper across the class…" />
      ) : data.data_quality.students_counted === 0 ? (
        // Still shows the caveats: "nobody sat it" and "every sitting was excluded as
        // corrupt" are different facts, and only the notes can tell them apart.
        <div className="space-y-4">
          <Card>
            <EmptyState
              icon={BookOpen}
              title="Nobody in this class has a counted sitting of this paper"
              description={
                data.data_quality.attempts_considered > 0
                  ? `${plural(data.data_quality.attempts_considered, "sitting")} of this paper ${agree(data.data_quality.attempts_considered, "exists", "exist")} for this class, but none could be counted. The notes below say which were set aside, and why.`
                  : "Once a student on the roster finishes this paper, every question on it shows up here."
              }
            />
          </Card>
          <Caveats items={caveats} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="To go over"
              value={data.totals.needs_analysis}
              sub={`missed by ${threshold}% or more`}
              icon={ListChecks}
            />
            <StatCard
              label="Check the key"
              value={data.totals.suspect_key}
              sub={`at ${SUSPECT_KEY_THRESHOLD}% or above`}
              icon={KeyRound}
            />
            <StatCard
              label="Students counted"
              value={data.data_quality.students_counted}
              sub={`of ${formatCount(data.data_quality.roster)} on the roster today`}
            />
            <StatCard
              label="Questions"
              value={data.totals.questions}
              sub={`${formatCount(data.totals.omitted)} answers left blank`}
            />
          </div>

          {/* The paper's own rate, and the population it divided.
              `totals.error_rate` holds the suspect answer keys out; `totals.wrong` /
              `totals.answered` / the "answers left blank" card above do not, because they
              describe the sitting as recorded. Both readings are right and they are not the
              same number, so the page prints the rate next to the counts that produced it
              rather than leaving a teacher to reconcile a percentage against tallies it never
              divided. */}
          <p data-paper-rate className="px-1 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Error rate for this paper:</span>{" "}
            <RateValue
              value={data.totals.error_rate}
              emptyTitle={
                data.totals.analysed.questions === 0 && data.totals.questions > 0
                  ? HELD_OUT_RATE_TITLE
                  : undefined
              }
              className="font-semibold"
            />{" "}
            — {analysedTotalsLine(data.totals)}
          </p>

          {/* The two tabs scope their cohort differently for the same class, and a teacher
              comparing them sees two class sizes with no explanation. One line names this tab's
              cohort; the full cross-tab difference is the "cohort" note in the fold below. */}
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Who is counted:</span> the{" "}
            {plural(data.data_quality.roster, "student")} on this class&apos;s roster today —{" "}
            {formatCount(data.data_quality.students_counted)} have a counted sitting. Students who
            have left the class are not here.
          </p>

          <Caveats items={caveats} />

          <Card className="space-y-4">
            <CardHeader
              title={flaggedHeading(data.needs_analysis.length)}
              description={`${paperLabel(data.practice_test)} · ranked worst first · flagged at ${threshold}% or above.`}
            />
            {data.needs_analysis.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title={`Nothing is over ${threshold}% on this paper`}
                description="No single question tripped the threshold for this class. The full list below still shows how they did on every question, blanks included."
              />
            ) : (
              <ul data-flagged-list className="space-y-3">
                {data.needs_analysis.map((row) => (
                  <FlaggedPastpaperCard key={row.question_id} row={row} />
                ))}
              </ul>
            )}
          </Card>

          <div>
            <h3 className="mb-3 text-sm font-bold text-foreground">
              Statistics by question type
            </h3>
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
              {/* No column span. It used to take two, which drew a 63% bar wider than a 65%
                  one in the card beside it — see BAR_TRACK_CLASS. */}
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
          </div>

          <Collapsible
            summary="Every question on this paper"
            hint={`${plural(data.questions.length, "question")}, in paper order`}
          >
            <PastpaperQuestionTable rows={data.questions} />
          </Collapsible>
        </>
      )}
    </div>
  );
}
