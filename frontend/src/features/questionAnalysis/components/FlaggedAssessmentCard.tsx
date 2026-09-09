import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { assessmentWrongLine, plural } from "../format";
import type { AssessmentItemRow } from "../types";
import { RateValue } from "./Rate";
import { Tag } from "./Tag";

/**
 * Where a teacher can actually read a flagged question.
 *
 * `/teacher/assessments/[setId]/practice` renders every question in the set the way a
 * student sees it, with the recorded answer and explanation, and it is guarded by a plain
 * `AuthGuard` — a teacher can open it. The builder's set editor cannot be used here: it is
 * `adminOnly` and lives on the questions console, not the teacher portal.
 *
 * It has no per-question segment, so this lands on question 1 of the set; the link says so.
 */
export function setPracticeHref(setId: number): string {
  return `/teacher/assessments/${setId}/practice`;
}

/**
 * One flagged assessment question, with enough context to act on without another click.
 *
 * Lives here rather than inside a panel because two surfaces show the same card — the
 * standalone console page across a whole class, and the section inside one homework — and a
 * second copy would be a second set of rules to keep honest. Everything it encodes was paid
 * for: the ungraded count kept apart from the wrong count, the "Untagged" chip that stops a
 * missing skill reading as a chip that failed to load, and a rate that is an em dash rather
 * than a 0% when nothing has been graded.
 */
export function FlaggedAssessmentCard({ row }: { row: AssessmentItemRow }) {
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
            <Tag tone="neutral">{row.question_type_label}</Tag>
            {row.ungraded > 0 && (
              <Tag tone="warning">{plural(row.ungraded, "answer")} not graded yet</Tag>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            {row.prompt || (
              <span className="text-muted-foreground">
                This question has no text prompt saved — open the set below to read it.
              </span>
            )}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{assessmentWrongLine(row)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {/* An untagged question says so. Rendering nothing here made a missing skill look
                like a chip that failed to load rather than a question nobody tagged. */}
            {row.skill ? <Tag tone="info">{row.skill}</Tag> : <Tag tone="neutral">Untagged</Tag>}
            {row.domain && <Tag tone="neutral">{row.domain}</Tag>}
          </div>
          <Link
            href={setPracticeHref(row.set.id)}
            title={`Opens “${row.set.title}” in teacher practice at question 1 — use the question map at the bottom to jump to Q${row.position}.`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            Open the set to read Q{row.position}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
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
