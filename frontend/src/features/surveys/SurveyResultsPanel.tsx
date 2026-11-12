"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Badge, Button, EmptyState, Segmented, TextInput } from "@/features/console/ui";
import { CONTROL } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";
import { surveysApi, isChoiceType, isNumericType, type SurveySummary } from "./surveysApi";
import { errorText, useSurveyParticipation, useSurveyResults } from "./surveysHooks";
import { levelLabel } from "@/lib/levels";
import { INSET, Notice, Shimmer } from "./surveyLook";

/** A labelled proportion bar. One row of a choice question's distribution. */
function ShareRow({ text, count, percent }: { text: string; count: number; percent: number | null }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[14px] font-medium text-ms-fg">{text}</span>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ms-fg-2">
          {count}
          {percent != null && <span className="ml-1 font-normal text-ms-fg-3">({percent}%)</span>}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ms-surface-2">
        <div
          className="h-full rounded-full bg-ms-primary transition-[width] duration-300 ease-out"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
}

/** The count at each score, as a column chart with the satisfactory bar marked. */
function ScoreDistribution({ summary }: { summary: SurveySummary }) {
  const bars = summary.distribution ?? [];
  const peak = Math.max(1, ...bars.map((b) => b.count));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-1" style={{ height: 96 }}>
        {bars.map((b) => {
          const below = summary.threshold != null && b.score < summary.threshold;
          return (
            <div key={b.score} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[11px] font-semibold tabular-nums text-ms-fg-2">
                {b.count || ""}
              </span>
              <div
                // Below the author's own bar is coloured as the thing they asked to see.
                className={cn(
                  "w-full rounded-t-[4px]",
                  b.count === 0 ? "bg-ms-border" : below ? "bg-ms-attention" : "bg-ms-primary",
                )}
                style={{ height: `${Math.max(2, (b.count / peak) * 72)}px` }}
                title={`${b.count} at ${b.score}`}
              />
              <span className="text-[11px] font-medium tabular-nums text-ms-fg-3">
                {b.score}
              </span>
            </div>
          );
        })}
      </div>
      {(summary.scale_low_label || summary.scale_high_label) && (
        <div className="flex justify-between gap-4 text-[12px] text-ms-fg-3">
          <span className="min-w-0 truncate">{summary.scale_low_label}</span>
          <span className="min-w-0 truncate text-right">{summary.scale_high_label}</span>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ summary, index }: { summary: SurveySummary; index: number }) {
  const [showAllText, setShowAllText] = useState(false);
  const texts = summary.texts ?? [];
  const shownTexts = showAllText ? texts : texts.slice(0, 5);

  return (
    <article
      data-summary={summary.question_id}
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
      className="animate-ms-card-in flex flex-col gap-3 rounded-ms-card border border-ms-border bg-ms-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 basis-[16rem] text-[15px] font-semibold leading-[22px] text-ms-fg">
          <span className="mr-1.5 tabular-nums text-ms-fg-3">{index + 1}.</span>
          {summary.prompt}
          {summary.is_conditional && (
            <Badge tone="info" icon="filter" className="ml-2 align-middle">
              shown to some
            </Badge>
          )}
        </p>
        <span className="text-[13px] tabular-nums text-ms-fg-3">
          {summary.answered} answered
          {summary.skipped > 0 && ` · ${summary.skipped} skipped`}
          {/* Kept apart from "skipped", which it would otherwise swamp: a question only 12
              of 200 students were ever SHOWN is not one 188 people declined to answer. */}
          {summary.not_asked > 0 && ` · ${summary.not_asked} not shown`}
        </span>
      </div>

      {summary.answered === 0 ? (
        <p className="text-[14px] text-ms-fg-3">
          {summary.is_conditional && summary.not_asked > 0
            ? "Nobody who reached this question has answered it yet."
            : "Nobody has answered this one yet."}
        </p>
      ) : isChoiceType(summary.question_type) ? (
        <div className="flex flex-col gap-2.5">
          {(summary.options ?? []).map((o) => (
            <ShareRow key={o.text} text={o.text} count={o.count} percent={o.percent} />
          ))}
        </div>
      ) : isNumericType(summary.question_type) ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-ms-display text-[28px] font-bold leading-8 tabular-nums text-ms-fg">
              {summary.average ?? "—"}
            </span>
            <span className="text-[13px] text-ms-fg-2">
              average out of {summary.scale_max}
            </span>
            {summary.threshold != null && summary.below_threshold != null && (
              <Badge tone={summary.below_threshold > 0 ? "attention" : "positive"} dot>
                {summary.below_threshold} below {summary.threshold}
              </Badge>
            )}
          </div>
          <ScoreDistribution summary={summary} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {shownTexts.map((t, i) => (
            <p
              key={i}
              className="rounded-ms-ctl border border-ms-border bg-ms-surface px-3 py-2 text-[14px] leading-5 text-ms-fg"
            >
              {t}
            </p>
          ))}
          {texts.length > 5 && (
            <div>
              <Button size="sm" variant="ghost" onClick={() => setShowAllText((v) => !v)}>
                {showAllText ? "Show fewer" : `Show all ${texts.length}`}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* The comments the follow-up box collected, each next to the answer that prompted it.
          This is the whole point of the threshold, so it is not hidden behind a tab. */}
      {summary.comments.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-ms-ctl border border-ms-attention-line bg-ms-attention-soft p-3">
          <p className="text-ms-over flex items-center gap-1.5 uppercase text-ms-attention-fg">
            <Icon name="msg" size="sm" className="size-3.5" />
            {summary.comments.length} wrote more
          </p>
          {summary.comments.map((c, i) => (
            <p key={i} className="text-[14px] leading-5 text-ms-fg">
              <span className="mr-1.5 font-semibold tabular-nums text-ms-attention-fg">
                {Array.isArray(c.value) ? c.value.join(", ") : String(c.value)}
              </span>
              {c.text}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}

export function SurveyResultsPanel({
  surveyId,
  title,
  onClose,
}: {
  surveyId: number;
  title: string;
  onClose: () => void;
}) {
  // The cohort filter is part of the results query key, so switching class refetches rather
  // than showing the previous class's numbers.
  const [level, setLevel] = useState<string>("");
  const results = useSurveyResults(surveyId, { level: level || undefined });
  const participation = useSurveyParticipation(surveyId);
  const [view, setView] = useState<"summary" | "replies">("summary");
  const [search, setSearch] = useState("");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const responses = results.data?.responses ?? [];
  const filtered = search.trim()
    ? responses.filter((r) =>
        r.student_name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : responses;

  async function download() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await surveysApi.downloadResults(surveyId, `${title || "survey"}-replies.csv`);
    } catch (e) {
      setDownloadError(errorText(e) ?? "The spreadsheet couldn't be downloaded.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="min-w-0 flex-1 basis-[14rem] truncate text-[18px] font-bold leading-7 text-ms-fg">Replies — {title}</h2>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            icon="download"
            state={downloading ? "busy" : "idle"}
            disabled={responses.length === 0 || downloading}
            onClick={() => void download()}
          >
            CSV
          </Button>
          <Button size="sm" variant="ghost" icon="x" onClick={onClose} aria-label="Close replies" />
        </div>
      </div>

      {downloadError && <Notice tone="danger" title={downloadError} />}

      {/* HOW MANY WERE ASKED. "200 replies" is unreadable without it — 200 of 210 is a
          mandate, 200 of 900 is a self-selected minority whose complaints deserve different
          weight. An "everyone" survey honestly reports no rate rather than inventing one. */}
      {participation.data && (
        <div className={cn(INSET, "flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3")}>
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5 text-[14px] font-semibold tabular-nums text-ms-fg">
            <Icon name="users" size="sm" className="self-center text-ms-fg-3" />
            {participation.data.expected == null ? (
              <>
                {participation.data.replied} replies
                <span className="ml-1.5 text-[13px] font-normal text-ms-fg-3">
                  (sent to everyone — no fixed roster to count against)
                </span>
              </>
            ) : (
              <>
                {participation.data.replied} of {participation.data.expected} replied
                <span className="ml-1.5 text-ms-primary-text">{participation.data.rate}%</span>
              </>
            )}
          </span>
          {(participation.data.outstanding_total ?? 0) > 0 && (
            <details className="min-w-0">
              <summary className="cursor-pointer rounded-[6px] text-[14px] font-medium text-ms-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ms-ring">
                {participation.data.outstanding_total} still to answer
              </summary>
              <div className="mt-2 max-h-40 overflow-y-auto text-[14px] text-ms-fg">
                {participation.data.outstanding.map((o) => (
                  <p key={o.id} className="truncate">{o.name}</p>
                ))}
                {(participation.data.outstanding_total ?? 0) >
                  participation.data.outstanding.length && (
                  <p className="mt-1 text-ms-fg-3">
                    …and {(participation.data.outstanding_total ?? 0) - participation.data.outstanding.length} more
                  </p>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {/* The four branches, in order: loading → error → empty → content. */}
      {results.isPending ? (
        <Shimmer rows={2} className="h-28 rounded-ms-card" />
      ) : results.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="danger" title="Couldn’t load the replies">
            {errorText(results.error) ?? "The answers didn’t come back this time."}
          </Notice>
          <Button variant="secondary" icon="refresh" onClick={() => void results.refetch()}>
            Retry
          </Button>
        </div>
      ) : responses.length === 0 ? (
        <EmptyState
          icon="users"
          title={level ? `No replies from ${levelLabel(level)}` : "No replies yet"}
          detail={
            level
              ? "Other levels may still have answered — clear the filter to see everything."
              : "Answers will appear here as students finish the survey."
          }
          action={
            level ? (
              <Button size="sm" variant="secondary" onClick={() => setLevel("")}>
                Clear filter
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="Replies view"
                value={view}
                onChange={(v) => setView(v)}
                options={[
                  { value: "summary", label: "Overview" },
                  { value: "replies", label: `Each reply (${responses.length})` },
                ]}
              />
              {/* Narrowed on the cohort SNAPSHOT taken when they answered — which is what
                  makes this work on an anonymous survey at all, since the student FK must
                  never be followed. */}
              <div className="w-44">
                <select
                  aria-label="Filter by level"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className={CONTROL}
                >
                  <option value="">All levels</option>
                  {["foundation", "junior", "middle", "senior"].map((l) => (
                    <option key={l} value={l}>{levelLabel(l)}</option>
                  ))}
                </select>
              </div>
            </div>
            {view === "replies" && (
              // The width goes on a wrapper: the field's shell takes the wrapper's width, so a
              // max-width on the control would leave a full-width box around a narrow field.
              <div className="w-full max-w-[240px]">
                <TextInput
                  icon="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Find a student"
                  aria-label="Find a student"
                />
              </div>
            )}
          </div>

          {view === "summary" ? (
            <div className="flex flex-col gap-3">
              {(results.data?.summaries ?? []).map((s, i) => (
                <SummaryCard key={s.question_id} summary={s} index={i} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            // Gated on the SEARCH, not on the raw count — the empty branch above already
            // covered "nobody has replied", and reusing it here would tell an admin whose
            // search matched nothing that the survey has no answers.
            <EmptyState
              icon="search"
              title={`Nobody matching “${search.trim()}”`}
              detail="Every reply is still there — only this search came up empty."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map((r) => (
                <article key={r.id} data-reply={r.id} className="rounded-ms-card border border-ms-border bg-ms-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-[15px] font-semibold text-ms-fg">
                      {r.student_name}
                    </p>
                    {r.is_anonymous && <Badge tone="neutral" icon="shield">Anonymous</Badge>}
                    {r.submitted_at && (
                      <span className="text-[13px] tabular-nums text-ms-fg-3">
                        {new Date(r.submitted_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <dl className="mt-3 flex flex-col gap-2">
                    {r.answers.map((a) => (
                      <div key={a.question} className="min-w-0">
                        <dt className="text-[13px] text-ms-fg-3">{a.prompt}</dt>
                        <dd className="text-[14px] leading-5 text-ms-fg">
                          {a.value == null ? (
                            <span className="text-ms-fg-3">Skipped</span>
                          ) : Array.isArray(a.value) ? (
                            a.value.join(", ")
                          ) : (
                            String(a.value)
                          )}
                          {a.follow_up && (
                            <span className="mt-0.5 block font-ms-serif text-[14px] italic text-ms-fg-2">
                              “{a.follow_up}”
                            </span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
