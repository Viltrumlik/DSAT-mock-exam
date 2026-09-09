"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, ListChecks } from "lucide-react";
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
import { buildAssessmentCaveats } from "./caveats";
import { agree, flaggedHeading, plural } from "./format";
import type { AssessmentGroupRow, AssessmentSetRef } from "./types";
import {
  BREAKDOWN_GRID_STYLE,
  BreakdownList,
  type BreakdownRow,
} from "./components/BreakdownList";
import { AssessmentQuestionTable } from "./components/AssessmentQuestionTable";
import { Caveats } from "./components/Caveats";
import { Collapsible } from "./components/Collapsible";
import { FlaggedAssessmentCard } from "./components/FlaggedAssessmentCard";
import { useQueryErrorToast } from "./useQueryErrorToast";

/** Re-exported from where the flagged card now lives, so both surfaces share one route. */
export { setPracticeHref } from "./components/FlaggedAssessmentCard";

/** The same set can be assigned twice; the picker should offer it once. */
function dedupeSets(sets: AssessmentSetRef[]): AssessmentSetRef[] {
  const seen = new Map<number, AssessmentSetRef>();
  for (const set of sets) if (!seen.has(set.id)) seen.set(set.id, set);
  return [...seen.values()];
}

function toBreakdownRows(groups: AssessmentGroupRow[]): BreakdownRow[] {
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

/**
 * "Which assessment questions do I need to go back over?" for one classroom.
 *
 * Mounted with a `key` of the classroom id by the page above, so switching class resets the
 * set filter instead of carrying a set that belongs to somebody else's classroom.
 */
export function AssessmentsPanel({
  classroomId,
  threshold,
}: {
  classroomId: number;
  threshold: number;
}) {
  const [setId, setSetId] = useState<number | null>(null);
  // The set list arrives inside the analysis payload. Held here so that a filter which comes
  // back 404 ("that set is not assigned to this classroom") still leaves the teacher a picker
  // to get out of, instead of a dead end with no way back to "All sets".
  const [knownSets, setKnownSets] = useState<AssessmentSetRef[]>([]);
  const selectId = useId();

  const query = useQuery({
    queryKey: questionAnalysisKeys.assessments(classroomId, setId, threshold),
    queryFn: () => questionAnalysisApi.assessments({ classroom: classroomId, set: setId, threshold }),
    enabled: classroomId > 0,
  });
  useQueryErrorToast(query.error, "Assessment analysis");

  const data = query.data;
  useEffect(() => {
    if (data && data.sets.length > 0) setKnownSets(dedupeSets(data.sets));
  }, [data]);

  const typeRows = useMemo(() => toBreakdownRows(data?.by_question_type ?? []), [data]);
  const skillRows = useMemo(() => toBreakdownRows(data?.by_skill ?? []), [data]);
  const domainRows = useMemo(() => toBreakdownRows(data?.by_domain ?? []), [data]);

  // The two endpoints scope their cohort differently for the same class, and this page
  // shows the other one in a sibling tab — the note has to say where that number is.
  const caveats = data ? buildAssessmentCaveats(data, "tab") : [];

  return (
    <div className="space-y-5">
      {knownSets.length > 1 && (
        <Card>
          <Field
            label="Assessment set"
            htmlFor={selectId}
            hint="Narrow the analysis to one set, or leave it on every set this class has been given."
          >
            <Select
              id={selectId}
              value={setId == null ? "" : String(setId)}
              onChange={(e) => setSetId(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">All sets ({knownSets.length})</option>
              {knownSets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.title}
                </option>
              ))}
            </Select>
          </Field>
        </Card>
      )}

      {/* Error is checked FIRST and on its own. A failed fetch that fell through to the
          "no questions" branch would tell a teacher their class has nothing to go over. */}
      {query.isError ? (
        <ErrorState
          title="We could not load the assessment analysis."
          message={`${normalizeApiError(query.error).message} Nothing below was analysed — this is not an empty class.`}
          onRetry={() => {
            if (setId != null) setSetId(null);
            else void query.refetch();
          }}
        />
      ) : !data ? (
        <LoadingState label="Working out which questions were missed…" />
      ) : data.summary.questions_total === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardCheck}
            title="No assessment questions here yet"
            description="Once this class has been given an assessment set, every question in it shows up here with how the class did on it."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="To go over"
              value={data.summary.questions_flagged}
              sub={`missed by ${threshold}% or more`}
              icon={ListChecks}
            />
            <StatCard
              label="Questions analysed"
              value={`${data.summary.questions_analysed}/${data.summary.questions_total}`}
              sub="have at least one graded answer"
            />
            <StatCard
              label="Students counted"
              value={data.summary.students_counted}
              sub={`given ${plural(data.summary.sets, "set")}, roster or not`}
            />
            <StatCard
              label="Awaiting grading"
              value={data.summary.questions_awaiting_grading}
              sub="no verdict back yet"
            />
          </div>

          {/* The two tabs scope their cohort differently for the same class, and a teacher
              comparing them sees two class sizes with no explanation. One line names this tab's
              cohort; the full cross-tab difference is the "cohort" note in the fold below. */}
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Who is counted:</span>{" "}
            {plural(data.summary.students_counted, "student")} — everyone given{" "}
            {agree(data.summary.sets, "this set", "these sets")}, including any who have since left
            the class.
          </p>

          <Caveats items={caveats} />

          <Card className="space-y-4">
            <CardHeader
              title={flaggedHeading(data.needs_analysis.length)}
              description={`Ranked worst first. A question at or above ${threshold}% is one the school's rule says to re-teach.`}
            />
            {data.needs_analysis.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title={`Nothing is over ${threshold}% right now`}
                description="No single question tripped the threshold on the work that has been graded so far. The full list below shows how the class did on every question."
              />
            ) : (
              <ul data-flagged-list className="space-y-3">
                {data.needs_analysis.map((row) => (
                  <FlaggedAssessmentCard key={row.question_id} row={row} />
                ))}
              </ul>
            )}
          </Card>

          <div>
            <h3 className="mb-3 text-sm font-bold text-foreground">Statistics by question type</h3>
            {/* One coverage note for the whole section. Skill and domain share the same
                disclosure — it is the same sentence about the same question-bank linkage —
                and printing it inside both cards printed it verbatim twice. */}
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
                emptyMessage="There is no skill breakdown for this class — see the note above."
              />
              <BreakdownList
                title="By domain"
                description="The skill's parent domain, where one is recorded."
                rows={domainRows}
                denominatorNoun="graded answers"
                emptyMessage="There is no domain breakdown for this class — see the note above."
              />
            </div>
          </div>

          <Collapsible
            summary="Every question in this class"
            hint={`${plural(data.questions.length, "question")}, worst first`}
          >
            <AssessmentQuestionTable rows={data.questions} />
          </Collapsible>
        </>
      )}
    </div>
  );
}
