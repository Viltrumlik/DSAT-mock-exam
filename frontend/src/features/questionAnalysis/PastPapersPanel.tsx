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
import {
  SUSPECT_KEY_THRESHOLD,
  agree,
  flaggedHeading,
  formatCount,
  paperLabel,
  pastpaperWrongLine,
  plural,
} from "./format";
import type {
  PastPaperOption,
  PastpaperBreakdown,
  PastpaperItemRow,
} from "./types";
import {
  BREAKDOWN_GRID_STYLE,
  BreakdownList,
  type BreakdownRow,
} from "./components/BreakdownList";
import { Caveats, type Caveat } from "./components/Caveats";
import { Collapsible } from "./components/Collapsible";
import { RateValue } from "./components/Rate";
import { Tag } from "./components/Tag";
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

function FlaggedCard({ row }: { row: PastpaperItemRow }) {
  return (
    <li
      className={`rounded-2xl border bg-card p-4 ${
        row.suspect_key ? "border-rose-500/40" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-lg bg-surface-2 px-2 py-0.5 text-xs font-bold tabular-nums text-foreground">
              Q{row.number}
            </span>
            <Tag tone="neutral">{row.module_label}</Tag>
            <Tag tone="neutral">{row.format_label}</Tag>
            <Tag tone="neutral">{row.question_type_label}</Tag>
            {row.suspect_key && (
              <Tag tone="danger">
                <KeyRound className="h-3 w-3" aria-hidden />
                Check the answer key
              </Tag>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            {row.stem || (
              // No route reaches a past-paper question from the teacher portal — the module
              // editor is admin-only and on the questions console — so this says where the
              // question is instead of sending a teacher after a link that is not there.
              <span className="text-muted-foreground">
                This question has no text stem saved — it is Q{row.number}, {row.module_label}, on
                the paper itself.
              </span>
            )}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{pastpaperWrongLine(row)}</p>
          {row.seen > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Counting blank answers too,{" "}
              <RateValue value={row.miss_rate} className="font-semibold" /> of the{" "}
              {plural(row.seen, "student")} who saw it missed it.
            </p>
          )}
          {row.suspect_key && (
            <p className="mt-2 rounded-xl bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-700 dark:text-rose-300">
              At {SUSPECT_KEY_THRESHOLD}% or above, a wrong answer key is a likelier explanation
              than a hard question. Read the recorded key
              {row.correct_answer ? ` (“${row.correct_answer}”)` : ""} against the paper before
              re-teaching anything.
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {/* An untagged question says so. Rendering nothing made a missing skill look like
                a chip that failed to load rather than a question nobody tagged. */}
            {row.skill_id != null ? (
              <Tag tone="info">{row.skill}</Tag>
            ) : (
              <Tag tone="neutral">Untagged</Tag>
            )}
            {row.domain_id != null && <Tag tone="neutral">{row.domain}</Tag>}
            {row.difficulty != null && <Tag tone="neutral">{row.difficulty_label}</Tag>}
            {row.correct_answer && !row.suspect_key && (
              <span className="text-xs text-muted-foreground">Key: {row.correct_answer}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <RateValue value={row.error_rate} flagged className="text-2xl font-black leading-none" />
          <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            of answers wrong
          </p>
        </div>
      </div>
    </li>
  );
}

function FullTable({ rows }: { rows: PastpaperItemRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[54rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-semibold">#</th>
            <th className="py-1.5 pr-3 font-semibold">Module</th>
            <th className="py-1.5 pr-3 font-semibold">Question</th>
            <th className="py-1.5 pr-3 font-semibold">Type</th>
            <th className="py-1.5 pr-3 font-semibold">Skill</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Saw it</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Answered</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Blank</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Wrong</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Error rate</th>
            <th className="py-1.5 text-right font-semibold">Miss rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.question_id} className="border-t border-border align-top">
              <td className="py-2 pr-3 tabular-nums text-muted-foreground">{row.number}</td>
              <td className="py-2 pr-3 text-muted-foreground">{row.module_label}</td>
              <td className="max-w-sm py-2 pr-3 text-foreground">
                <span className="line-clamp-2">{row.stem || "—"}</span>
              </td>
              <td className="py-2 pr-3 text-muted-foreground">{row.question_type_label}</td>
              <td className="py-2 pr-3 text-muted-foreground">{row.skill}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {formatCount(row.seen)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {formatCount(row.answered)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {row.omitted > 0 ? formatCount(row.omitted) : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                {formatCount(row.wrong)}
              </td>
              <td className="py-2 pr-3 text-right font-semibold">
                <RateValue value={row.error_rate} flagged={row.needs_analysis} />
              </td>
              <td className="py-2 text-right">
                <RateValue value={row.miss_rate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

  const caveats: Caveat[] = [];
  if (data) {
    const dq = data.data_quality;
    caveats.push({
      id: "denominator",
      tone: "info",
      text:
        `The headline rate is wrong answers over the students who answered (denominator: ${data.denominator}). ` +
        "Blank answers are counted separately as “left it blank”, because running out of time is a pacing problem and a wrong answer is a teaching one.",
    });
    caveats.push({
      id: "selection",
      tone: "info",
      text: `Only the first completed sitting of this paper counts for each student, so a student who sat it three times does not carry triple weight. ${formatCount(
        dq.students_counted,
      )} of ${plural(dq.roster, "student")} on the roster have a counted sitting.`,
    });
    if (dq.excluded.copied > 0) {
      caveats.push({
        id: "copied",
        tone: "warning",
        text: `${plural(
          dq.excluded.copied,
          "sitting",
        )} ${agree(dq.excluded.copied, "was", "were")} excluded as corrupt: the Module 2 answers were recorded under Module 1's question ids by a submit bug fixed in July 2026. That work was not analysed and is in none of the numbers here.`,
      });
    }
    if (dq.excluded.repeat_sitting > 0) {
      caveats.push({
        id: "repeat",
        tone: "info",
        text: `${plural(
          dq.excluded.repeat_sitting,
          "repeat sitting",
        )} of this paper ${agree(dq.excluded.repeat_sitting, "was", "were")} set aside — only each student's first one counts.`,
      });
    }
    if (dq.suspect_key_questions > 0) {
      caveats.push({
        id: "suspect",
        tone: "warning",
        text: `${plural(
          dq.suspect_key_questions,
          "question",
        )} ${agree(dq.suspect_key_questions, "is", "are")} at ${SUSPECT_KEY_THRESHOLD}% or above. That is far more often a wrong answer key than a hard question — check the key before putting it on a lesson plan.`,
      });
    }
    caveats.push({
      id: "cohort",
      tone: "info",
      text:
        "This tab counts only students on the class roster as it stands today. The Assessments tab counts everyone who was given a set, including students who have since left the class, so the two tabs can report different class sizes for the same class.",
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
  }

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
                  <FlaggedCard key={row.question_id} row={row} />
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
            <FullTable rows={data.questions} />
          </Collapsible>
        </>
      )}
    </div>
  );
}
