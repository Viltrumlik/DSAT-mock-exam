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
  Pill,
  Select,
  StatCard,
} from "@/features/classroom/ui";
import { normalizeApiError } from "@/lib/apiError";
import { questionAnalysisApi, questionAnalysisKeys } from "./api";
import { agree, assessmentWrongLine, flaggedHeading, formatCount, plural } from "./format";
import type { AssessmentGroupRow, AssessmentItemRow, AssessmentSetRef } from "./types";
import { BreakdownList, type BreakdownRow } from "./components/BreakdownList";
import { Caveats, type Caveat } from "./components/Caveats";
import { Collapsible } from "./components/Collapsible";
import { RateValue } from "./components/Rate";
import { useQueryErrorToast } from "./useQueryErrorToast";

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

function FlaggedCard({ row }: { row: AssessmentItemRow }) {
  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-lg bg-surface-2 px-2 py-0.5 text-xs font-bold tabular-nums text-foreground">
              Q{row.position}
            </span>
            <span className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
              {row.set.title}
            </span>
            <Pill tone="neutral">{row.question_type_label}</Pill>
            {row.ungraded > 0 && (
              <Pill tone="warning">{plural(row.ungraded, "answer")} not graded yet</Pill>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            {row.prompt || (
              <span className="text-muted-foreground">
                This question has no text prompt — open it in the builder to see it.
              </span>
            )}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{assessmentWrongLine(row)}</p>
          {(row.skill || row.domain) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {row.skill && <Pill tone="info">{row.skill}</Pill>}
              {row.domain && <Pill tone="neutral">{row.domain}</Pill>}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <RateValue value={row.error_rate} flagged className="text-2xl font-black leading-none" />
          <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            got it wrong
          </p>
        </div>
      </div>
    </li>
  );
}

function FullTable({ rows }: { rows: AssessmentItemRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-semibold">#</th>
            <th className="py-1.5 pr-3 font-semibold">Question</th>
            <th className="py-1.5 pr-3 font-semibold">Set</th>
            <th className="py-1.5 pr-3 font-semibold">Type</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Wrong</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Graded</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Not graded</th>
            <th className="py-1.5 text-right font-semibold">Error rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.question_id} className="border-t border-border align-top">
              <td className="py-2 pr-3 tabular-nums text-muted-foreground">{row.position}</td>
              <td className="max-w-md py-2 pr-3 text-foreground">
                <span className="line-clamp-2">{row.prompt || "—"}</span>
              </td>
              <td className="py-2 pr-3 text-muted-foreground">{row.set.title}</td>
              <td className="py-2 pr-3 text-muted-foreground">{row.question_type_label}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                {formatCount(row.students_wrong)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {formatCount(row.students_graded)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {row.ungraded > 0 ? formatCount(row.ungraded) : "—"}
              </td>
              <td className="py-2 text-right font-semibold">
                <RateValue value={row.error_rate} flagged={row.needs_analysis} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

  const caveats: Caveat[] = [];
  if (data) {
    caveats.push({
      id: "denominator",
      tone: "info",
      text:
        `Every rate here is a share of answers that came back graded (denominator: ${data.denominator}). ` +
        "A skipped question leaves no answer at all, so a student who never reached one is in no denominator.",
    });
    caveats.push({
      id: "counting",
      tone: "info",
      text: `Each student is counted once — ${data.counting_rule}. A retry serves back exactly the questions they got wrong, so later attempts would bias this list.`,
    });
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
        text: `${plural(data.excluded.retired_questions, "answer")} ${agree(data.excluded.retired_questions, "belongs", "belong")} to questions since retired in the builder, and ${agree(data.excluded.retired_questions, "is", "are")} excluded from every number on this tab.`,
      });
    }
  }

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
              sub={`across ${plural(data.summary.sets, "set")}`}
            />
            <StatCard
              label="Awaiting grading"
              value={data.summary.questions_awaiting_grading}
              sub="no verdict back yet"
            />
          </div>

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
              <ul className="space-y-3">
                {data.needs_analysis.map((row) => (
                  <FlaggedCard key={row.question_id} row={row} />
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
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
              note={data.taxonomy_coverage.note || null}
              emptyMessage="There is no skill breakdown for this class — see the note above."
            />
            <BreakdownList
              title="By domain"
              description="The skill's parent domain, where one is recorded."
              rows={domainRows}
              denominatorNoun="graded answers"
              note={data.taxonomy_coverage.note || null}
              emptyMessage="There is no domain breakdown for this class — see the note above."
            />
          </div>

          <Collapsible
            summary="Every question in this class"
            hint={`${plural(data.questions.length, "question")}, worst first`}
          >
            <FullTable rows={data.questions} />
          </Collapsible>
        </>
      )}
    </div>
  );
}
