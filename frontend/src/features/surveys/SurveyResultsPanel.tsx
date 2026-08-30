"use client";

import { useState } from "react";
import { Download, GitBranch, MessageSquareText, Users, X } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  IconButton,
  Input,
  SegmentedControl,
  Skeleton,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { surveysApi, isChoiceType, isNumericType, type SurveySummary } from "./surveysApi";
import { errorText, useSurveyResults } from "./surveysHooks";

/** A labelled proportion bar. One row of a choice question's distribution. */
function ShareRow({ text, count, percent }: { text: string; count: number; percent: number | null }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{text}</span>
        <span className="ds-num shrink-0 text-xs font-bold text-muted-foreground">
          {count}
          {percent != null && <span className="ml-1 font-medium">({percent}%)</span>}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
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
    <div className="space-y-2">
      <div className="flex items-end gap-1" style={{ height: 96 }}>
        {bars.map((b) => {
          const below = summary.threshold != null && b.score < summary.threshold;
          return (
            <div key={b.score} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="ds-num text-[10px] font-bold text-muted-foreground">
                {b.count || ""}
              </span>
              <div
                // Below the author's own bar is coloured as the thing they asked to see.
                className={cn(
                  "w-full rounded-t-[3px]",
                  below ? "bg-amber-500/70" : "bg-primary/70",
                  b.count === 0 && "bg-border",
                )}
                style={{ height: `${Math.max(2, (b.count / peak) * 72)}px` }}
                title={`${b.count} at ${b.score}`}
              />
              <span className="ds-num text-[10px] font-semibold text-muted-foreground">
                {b.score}
              </span>
            </div>
          );
        })}
      </div>
      {(summary.scale_low_label || summary.scale_high_label) && (
        <div className="flex justify-between gap-4 text-[11px] font-medium text-muted-foreground">
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
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-bold text-foreground">
          <span className="ds-num mr-1.5 text-muted-foreground">{index + 1}.</span>
          {summary.prompt}
          {summary.is_conditional && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 align-middle text-[11px] font-bold text-primary">
              <GitBranch className="h-3 w-3" aria-hidden /> shown to some
            </span>
          )}
        </p>
        <span className="ds-num shrink-0 text-[11px] font-semibold text-muted-foreground">
          {summary.answered} answered
          {summary.skipped > 0 && ` · ${summary.skipped} skipped`}
          {/* Kept apart from "skipped", which it would otherwise swamp: a question only 12
              of 200 students were ever SHOWN is not one 188 people declined to answer. */}
          {summary.not_asked > 0 && ` · ${summary.not_asked} not shown`}
        </span>
      </div>

      {summary.answered === 0 ? (
        <p className="text-sm text-muted-foreground">
          {summary.is_conditional && summary.not_asked > 0
            ? "Nobody who reached this question has answered it yet."
            : "Nobody has answered this one yet."}
        </p>
      ) : isChoiceType(summary.question_type) ? (
        <div className="space-y-2.5">
          {(summary.options ?? []).map((o) => (
            <ShareRow key={o.text} text={o.text} count={o.count} percent={o.percent} />
          ))}
        </div>
      ) : isNumericType(summary.question_type) ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span className="ds-num text-2xl font-extrabold text-foreground">
              {summary.average ?? "—"}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              average out of {summary.scale_max}
            </span>
            {summary.threshold != null && summary.below_threshold != null && (
              <Badge variant={summary.below_threshold > 0 ? "warning" : "success"}>
                {summary.below_threshold} below {summary.threshold}
              </Badge>
            )}
          </div>
          <ScoreDistribution summary={summary} />
        </div>
      ) : (
        <div className="space-y-1.5">
          {shownTexts.map((t, i) => (
            <p
              key={i}
              className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground"
            >
              {t}
            </p>
          ))}
          {texts.length > 5 && (
            <Button size="sm" variant="ghost" onClick={() => setShowAllText((v) => !v)}>
              {showAllText ? "Show fewer" : `Show all ${texts.length}`}
            </Button>
          )}
        </div>
      )}

      {/* The comments the follow-up box collected, each next to the answer that prompted it.
          This is the whole point of the threshold, so it is not hidden behind a tab. */}
      {summary.comments.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-amber-400/40 bg-amber-500/[0.05] p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
            {summary.comments.length} wrote more
          </p>
          {summary.comments.map((c, i) => (
            <p key={i} className="text-sm text-foreground">
              <span className="ds-num mr-1.5 font-bold text-amber-700 dark:text-amber-400">
                {Array.isArray(c.value) ? c.value.join(", ") : String(c.value)}
              </span>
              {c.text}
            </p>
          ))}
        </div>
      )}
    </div>
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
  const results = useSurveyResults(surveyId);
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
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="ds-h4 min-w-0 truncate">Replies — {title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Download aria-hidden />}
            loading={downloading}
            disabled={responses.length === 0}
            onClick={() => void download()}
          >
            CSV
          </Button>
          <IconButton size="sm" variant="ghost" onClick={onClose} aria-label="Close replies">
            <X className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      {downloadError && (
        <Alert tone="danger" title={downloadError} className="mb-3" />
      )}

      {/* The four branches, in order: loading → error → empty → content. */}
      {results.isPending ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : results.isError ? (
        <div className="space-y-3">
          <Alert tone="danger" title="Couldn’t load the replies">
            {errorText(results.error) ?? "The answers didn’t come back this time."}
          </Alert>
          <Button variant="secondary" onClick={() => void results.refetch()}>
            Retry
          </Button>
        </div>
      ) : responses.length === 0 ? (
        <EmptyState
          compact
          icon={Users}
          title="No replies yet"
          description="Answers will appear here as students finish the survey."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              value={view}
              onChange={(v) => setView(v as "summary" | "replies")}
              options={[
                { value: "summary", label: "Overview" },
                { value: "replies", label: `Each reply (${responses.length})` },
              ]}
            />
            {view === "replies" && (
              // The width goes on a wrapper: Input's own root is `w-full`, so a max-width on
              // the control would leave a full-width box around a narrow field.
              <div className="w-full max-w-[220px]">
                <Input
                  inputSize="sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Find a student"
                  aria-label="Find a student"
                />
              </div>
            )}
          </div>

          {view === "summary" ? (
            <div className="space-y-3">
              {(results.data?.summaries ?? []).map((s, i) => (
                <SummaryCard key={s.question_id} summary={s} index={i} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            // Gated on the SEARCH, not on the raw count — the empty branch above already
            // covered "nobody has replied", and reusing it here would tell an admin whose
            // search matched nothing that the survey has no answers.
            <EmptyState
              compact
              icon={Users}
              title={`Nobody matching “${search.trim()}”`}
              description="Every reply is still there — only this search came up empty."
            />
          ) : (
            <div className="space-y-3">
              {filtered.map((r) => (
                <div key={r.id} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                      {r.student_name}
                    </p>
                    {r.is_anonymous && <Badge variant="neutral">Anonymous</Badge>}
                    {r.submitted_at && (
                      <span className="ds-num text-[11px] text-muted-foreground">
                        {new Date(r.submitted_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <dl className="mt-2 space-y-1.5">
                    {r.answers.map((a) => (
                      <div key={a.question} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{a.prompt}</dt>
                        <dd className="text-sm text-foreground">
                          {a.value == null ? (
                            <span className="text-muted-foreground">Skipped</span>
                          ) : Array.isArray(a.value) ? (
                            a.value.join(", ")
                          ) : (
                            String(a.value)
                          )}
                          {a.follow_up && (
                            <span className="mt-0.5 block text-[13px] italic text-muted-foreground">
                              “{a.follow_up}”
                            </span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
