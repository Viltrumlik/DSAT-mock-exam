import { KeyRound } from "lucide-react";
import { SUSPECT_KEY_THRESHOLD, pastpaperWrongLine, plural } from "../format";
import type { PastpaperItemRow } from "../types";
import { RateValue } from "./Rate";
import { Tag } from "./Tag";

/**
 * One flagged past-paper question.
 *
 * Shared by the standalone console page and the section inside a homework, so the rules only
 * exist once: a blank answer is reported beside the wrong ones rather than folded into them
 * (running out of time and getting it wrong are different lessons), a question at 90%+ is
 * called out as a likely broken answer key instead of a hard topic, and a question nobody
 * tagged says "Untagged" rather than showing an empty space.
 */
export function FlaggedPastpaperCard({ row }: { row: PastpaperItemRow }) {
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
