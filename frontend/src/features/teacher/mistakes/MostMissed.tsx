"use client";

/**
 * "Most missed" — the class's mistakes, inside the homework a teacher is already looking at.
 *
 * The owner's ask, in translation: *"when homework is given, it should be easy to see the
 * students' most common mistakes, and from there open the full question in a pop-up window
 * and work it."* The figures behind this block are not new — they have been computed and
 * rendered for months on the standalone question-analysis console, which teachers open about
 * nine times a week between them. The data was never the problem; the placement was. So this
 * is small on purpose: five rows and a way to see the rest, sitting in the homework, above
 * the full statistics that were already here for anyone who wants the breakdowns.
 *
 * TEACHER-ONLY, BY CAPABILITY. This file is mounted from `AssignmentDetail`, which BOTH a
 * student and a teacher open — the student route and the teacher route render the same page.
 * The gate is `caps.canViewClassAnalytics`, never the route: a row here carries a question
 * prompt and the pop-up behind it carries the recorded answer key, and a student who can
 * still hand this homework in must not read either.
 *
 * FOUR STATES, AND THEY ARE FOUR DIFFERENT THINGS:
 *   · **locked** — the deadline has not passed. One line saying when the figures open, and
 *     not a single number. The server decides this; see `useMostMissed`.
 *   · **loading**
 *   · **failed** — says what failed, says nothing was counted, and offers a retry. A failed
 *     request rendering as "nobody missed anything" is the inversion this codebase has been
 *     bitten by, and it would tell a teacher their class got everything right.
 *   · **empty** — genuinely nobody missed anything, and it is allowed to be good news. It is
 *     guarded twice over: an empty list on top of a half that failed, or on top of a set of
 *     papers the server capped, is NOT "the class got everything right", and each of those
 *     says what it actually is instead.
 *
 * Painted with the classroom kit (`features/classroom/ui`), not the teacher kit, because its
 * neighbours on this page are classroom cards. The pop-up it opens is the teacher kit's
 * Dialog, which carries its own scope — see `QuestionPopup`.
 */

import { Suspense, lazy, useState } from "react";
import { Lock, PartyPopper } from "lucide-react";
import { Card, CardHeader, EmptyState, ErrorState, LoadingState } from "@/features/classroom/ui";
import {
  agree,
  formatCount,
  formatDeadline,
  formatPercent,
  plural,
  timeUntilDeadline,
} from "@/features/questionAnalysis/format";
import { useMostMissed } from "./useMostMissed";
import type { MissedRow } from "./rows";

/**
 * Split off, and loaded when a teacher opens a row rather than when the homework page does.
 *
 * The pop-up drags in the whole question-rendering stack — the runner's answer inputs, the
 * maths renderer, the authoring clients for both a set and a paper. That belongs to the
 * gesture of opening a question, not to a homework page that a student's browser also loads
 * (this file's host is the shared `AssignmentDetail`), and most visits never open a row at
 * all. No fallback: the chunk is small, and a flicker of a spinner inside a dialog that has
 * not appeared yet would be noise, not information.
 */
const QuestionPopup = lazy(() =>
  import("./QuestionPopup").then((m) => ({ default: m.QuestionPopup })),
);

/** How many rows stand before "show the rest". Five is the owner's "walk the worst five". */
const FIRST_RUN = 5;

export function MostMissed({
  assignmentId,
  hasAssessments,
  hasPastPapers,
}: {
  assignmentId: number;
  hasAssessments: boolean;
  hasPastPapers: boolean;
}) {
  const state = useMostMissed({ assignmentId, hasAssessments, hasPastPapers });
  const [showAll, setShowAll] = useState(false);
  /** Which row the pop-up is on, by position in the ranked list. `null` = closed. */
  const [openAt, setOpenAt] = useState<number | null>(null);

  const heading = (
    <CardHeader
      title="Most missed"
      description="The questions this class got wrong most, worst first. Open one to read it in full and work it."
    />
  );

  if (state.status === "locked") {
    const deadline = formatDeadline(state.homework.due_at);
    const soon = timeUntilDeadline(state.homework.due_at);
    return (
      <Card className="cr-card border-primary/25 bg-primary/5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Lock className="h-5 w-5" aria-hidden />
          </span>
          {/* One line, as asked. Not an empty state and not an error: the request succeeded,
              and "not yet" is an answer. The class is still working on this. */}
          <p data-missed-locked className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Most missed</span> opens once this
            homework&apos;s deadline passes
            {deadline ? (
              <>
                {" "}
                — <span className="font-semibold text-foreground">{deadline}</span>
                {soon ? `, ${soon}` : ""}
              </>
            ) : null}
            .
          </p>
        </div>
      </Card>
    );
  }

  if (state.status === "loading") {
    return (
      <Card className="cr-card">
        {heading}
        <LoadingState label="Counting this homework across the class…" />
      </Card>
    );
  }

  if (state.status === "error") {
    return (
      <Card className="cr-card">
        {heading}
        <ErrorState
          title="We could not count this homework's mistakes."
          message={`${state.message} Nothing was counted — this is not a homework the class got right.`}
          onRetry={state.retry}
        />
      </Card>
    );
  }

  const rows = state.rows;
  const shown = showAll ? rows : rows.slice(0, FIRST_RUN);

  return (
    <Card className="cr-card">
      {heading}

      {state.gap ? (
        <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          {state.gap}
        </p>
      ) : null}

      {state.truncated ? (
        /* The server worded this itself — it knows the cap it applied and where the rest can
           be read. The fallback mirrors the sentence HomeworkQuestionStatistics renders for
           the same payload; it is duplicated rather than shared because that file belongs to
           another slice, and the two must be re-joined if either moves. It sits ABOVE the
           list, because it changes what the list below is: not every question the class
           missed, only the ones on the papers that were counted. */
        <p
          data-missed-truncated
          className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium leading-relaxed text-amber-900 dark:text-amber-100"
        >
          {state.truncated.note ??
            (state.truncated.total > state.truncated.analysed
              ? `This homework carries ${plural(state.truncated.total, "past paper")}; ${formatCount(
                  state.truncated.analysed,
                )} of them ${agree(
                  state.truncated.analysed,
                  "is",
                  "are",
                )} counted here. The rest are not in the list below — open the full question analysis to read them.`
              : "Not every past paper on this homework is counted here. Open the full question analysis to read the rest.")}
        </p>
      ) : null}

      {rows.length === 0 && state.gap ? (
        /* No rows AND half of the homework never loaded. "Nobody missed anything" would be a
           claim about work nothing counted — the same inversion as rendering a failure as an
           empty state, only harder to spot because a one-line banner sits above it. */
        <ErrorState
          title="Only half of this homework was counted"
          /* The banner above already names WHICH half; this says what that costs the list. */
          message="Nobody missed a question in the half that came back, and the other half did not load — so this is not a homework the class got right."
          onRetry={state.retry}
        />
      ) : rows.length === 0 && state.truncated ? (
        /* Everything that WAS counted came back right — but the server capped how many papers
           it counted, so "nobody missed anything" would be a claim about papers nobody
           analysed. Good news, scoped to what it is news about. */
        <EmptyState
          icon={PartyPopper}
          title="Nothing missed in what was counted"
          description="Every question on the papers counted here came back right. Not every past paper on this homework was counted, though — the note above says where to read the rest."
        />
      ) : rows.length === 0 ? (
        /* Genuinely nobody missed anything — and it is allowed to read as the good news it
           is. Reachable only when everything that was asked for came back: a total failure
           returned far above, a half-failure and a capped paper list took the two branches
           directly above this one. */
        <EmptyState
          icon={PartyPopper}
          title="Nobody missed anything"
          description="Every question in this homework came back right from everyone who has been graded. There is nothing here to go back over."
        />
      ) : (
        <>
          <ol className="mt-4 space-y-2">
            {shown.map((row, i) => (
              <MissedRowButton
                key={row.key}
                row={row}
                rank={i + 1}
                open={openAt === i}
                onOpen={() => setOpenAt(i)}
              />
            ))}
          </ol>

          {rows.length > FIRST_RUN ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 text-sm font-semibold text-primary hover:underline"
            >
              {showAll
                ? `Show the worst ${FIRST_RUN}`
                : /* "All" is only true when every paper on the homework was analysed. Under
                     the server's cap this list provably is not all of them, so the label
                     stops claiming it and the note below says why. */
                  state.truncated
                  ? `Show the other ${rows.length - FIRST_RUN}`
                  : `Show all ${rows.length} questions the class missed`}
            </button>
          ) : null}
        </>
      )}

      {openAt != null && rows[openAt] ? (
        <Suspense fallback={null}>
          <QuestionPopup
            rows={rows}
            index={openAt}
            onIndex={(next) => setOpenAt(Math.min(rows.length - 1, Math.max(0, next)))}
            onClose={() => setOpenAt(null)}
          />
        </Suspense>
      ) : null}
    </Card>
  );
}

/**
 * One row: where the question sits, what it says, and how many of the class missed it.
 *
 * A button, not a link — the question opens over the homework rather than navigating away
 * from it, which is the whole of the owner's "pop-up window".
 */
function MissedRowButton({
  row,
  rank,
  open,
  onOpen,
}: {
  row: MissedRow;
  rank: number;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={open ? "true" : undefined}
        data-missed-row={row.key}
        title={row.line}
        className={
          "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-surface-2 " +
          (open ? "border-primary bg-primary/5" : "border-border")
        }
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-foreground">{row.place}</span>
            {row.suspectKey ? (
              /* The backend's own flag: at 90%+ the recorded key is likelier broken than the
                 topic is hard, and the two ask a teacher to do opposite things. */
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Check the answer key
              </span>
            ) : null}
          </span>
          {/* The prompt as the analysis sent it — the server truncates a long one, and the
              pop-up is where the question is read in full. */}
          <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
            {row.preview}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-bold text-foreground">
            {row.missed}
            {row.of > 0 ? <span className="text-muted-foreground">/{row.of}</span> : null}
          </span>
          {/* An unknown rate is an em dash, never 0% — "nobody answered" and "everybody got it
              right" are opposite facts. `formatPercent` is the page's own rule for that. */}
          <span className="block text-[11px] font-semibold text-muted-foreground">
            {formatPercent(row.rate)}
          </span>
        </span>
        {/* "14 of 21 graded answers got it wrong". The two kinds of work count different
            populations, so the sentence that names the denominator travels with the row —
            visible in the tooltip, and read out as part of the button's own name. */}
        <span className="sr-only">{row.line}</span>
      </button>
    </li>
  );
}
