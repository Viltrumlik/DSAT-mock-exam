"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Lock, RefreshCw } from "lucide-react";

import { examsPublicApi } from "@/lib/api";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { midtermApi, subjectLabel as midtermSubject, type MidtermRow } from "@/lib/midtermApi";
import { bucketMidterms } from "@/lib/midtermBuckets";
import { desktopDonePath } from "@/lib/desktop/routes";
import { pastpaperReportApi } from "@/features/pastpapers/pastpaperReportApi";
import { sectionTitle, subjectLabel } from "@/features/pastpapers/pastpaperLabels";
import type { CardAttempt } from "@/features/pastpapers/pastpaperCardState";

import { DesktopChrome, useDesktopSession } from "./DesktopChrome";
import { groupPastpapers, midtermStatus, paperAction, type MidtermCardKind, type PaperRow } from "./homeModel";

async function loadPastpapers() {
  const [sections, attempts, reopened] = await Promise.all([
    examsPublicApi.getPastpaperSections(),
    examsPublicApi.getAttempts().then((r) => r.items as unknown as CardAttempt[]),
    // Soft, as on the site: without it a paper set again just reads "See score".
    pastpaperReportApi.reopened().catch(() => []),
  ]);
  return groupPastpapers(sections, attempts, reopened);
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  // A failed fetch is never shown as "nothing here" — the student would think they have no tests.
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-800">
      <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1">This list could not be loaded. Check your internet connection.</span>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 font-bold hover:underline">
        <RefreshCw className="h-4 w-4" aria-hidden /> Try again
      </button>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-slate-300 px-5 py-6 text-sm text-slate-500">{children}</p>;
}

function Card({
  title,
  meta,
  status,
  action,
  busy,
  onAction,
  locked,
}: {
  title: string;
  meta: string;
  status?: string;
  action?: string;
  busy?: boolean;
  onAction?: () => void;
  locked?: boolean;
}) {
  return (
    <li className="flex items-center gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-base font-bold text-slate-900">
          {locked ? <Lock className="h-4 w-4 shrink-0 text-slate-400" aria-label="Taken locked down" /> : null}
          {title}
        </p>
        <p className="mt-0.5 text-sm text-slate-500">{meta}</p>
      </div>
      {status ? <span className="shrink-0 text-sm font-semibold text-slate-600">{status}</span> : null}
      {action && onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {busy ? "Opening…" : action}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

/** "Your tests": the app's home — midterms first, then past papers to practise on. */
export function DesktopHome() {
  const router = useRouter();
  const { ready, me } = useDesktopSession();
  const { assertCriticalAuth } = useAuthCriticalGate();
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const midterms = useQuery({
    queryKey: ["midterm", "mine"],
    queryFn: midtermApi.myMidterms,
    enabled: ready,
    // A teacher starting the midterm (the access code) should show up without a reload.
    refetchInterval: 30_000,
  });
  const papers = useQuery({ queryKey: ["desktop", "pastpapers"], queryFn: loadPastpapers, enabled: ready });

  const openMidterm = async (m: MidtermRow) => {
    if (!assertCriticalAuth()) return;
    setOpening(`m${m.midterm_id}`);
    setOpenError(null);
    try {
      const attemptId = await midtermApi.createAttempt(m.midterm_id);
      router.push(`/exam/${attemptId}?src=midterm&welcome=1`);
    } catch {
      setOpenError("That midterm could not be opened. Try again.");
      setOpening(null);
    }
  };

  const openPaper = async ({ section, state }: PaperRow) => {
    if (state.status === "completed" && state.completedAttemptId) {
      router.push(desktopDonePath("pastpaper", state.completedAttemptId));
      return;
    }
    if (!assertCriticalAuth()) return;
    setOpening(`p${section.id}`);
    setOpenError(null);
    try {
      // A paper set again starts a NEW sitting; an open one is resumed where it was left.
      const attemptId = state.openAttemptId ?? (await examsPublicApi.startTest(section.id)).id;
      router.push(`/exam/${attemptId}${state.openAttemptId == null ? "?welcome=1" : ""}`);
    } catch {
      setOpenError("That past paper could not be opened. Try again.");
      setOpening(null);
    }
  };

  const buckets = bucketMidterms(midterms.data ?? []);
  const midtermCards: { m: MidtermRow; kind: MidtermCardKind }[] = [
    ...buckets.available.map((m) => ({ m, kind: "available" as const })),
    ...buckets.scheduled.map((m) => ({ m, kind: "scheduled" as const })),
    ...buckets.past.map((m) => ({ m, kind: "past" as const })),
    ...buckets.missed.map((m) => ({ m, kind: "missed" as const })),
  ];

  return (
    <DesktopChrome>
      <div className="mx-auto max-w-4xl px-8 py-10">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {me?.first_name ? `Welcome, ${me.first_name}` : "Your tests"}
        </h1>
        {openError ? <p className="mt-4 text-sm font-semibold text-red-600">{openError}</p> : null}

        <Section
          title="Midterms"
          hint="Midterms run locked down: the app closes everything else until you finish."
        >
          {midterms.isError ? (
            <LoadFailed onRetry={() => void midterms.refetch()} />
          ) : midterms.isLoading || !ready ? (
            <Empty>Loading your midterms…</Empty>
          ) : midtermCards.length === 0 ? (
            <Empty>No midterms yet. When your teacher gives you one, it appears here.</Empty>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {midtermCards.map(({ m, kind }) => {
                const s = midtermStatus(m, kind);
                const meta = [midtermSubject(m.subject), `${m.duration_minutes} min`, m.question_count ? `${m.question_count} questions` : null]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <Card
                    key={`${m.midterm_id}-${kind}`}
                    title={m.title}
                    meta={meta}
                    locked
                    status={s.actionable ? undefined : s.label}
                    action={s.actionable ? s.label : undefined}
                    busy={opening === `m${m.midterm_id}`}
                    onAction={s.actionable ? () => void openMidterm(m) : undefined}
                  />
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Practice: past papers" hint="Full SAT sections, timed like test day.">
          {papers.isError ? (
            <LoadFailed onRetry={() => void papers.refetch()} />
          ) : papers.isLoading || !ready ? (
            <Empty>Loading past papers…</Empty>
          ) : (papers.data ?? []).length === 0 ? (
            <Empty>No past papers are available yet.</Empty>
          ) : (
            (papers.data ?? []).map((group) => (
              <div key={group.name} className="mb-6">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{group.name}</h3>
                <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  {group.items.map((row) => {
                    const a = paperAction(row.state);
                    return (
                      <Card
                        key={row.section.id}
                        title={sectionTitle(row.section)}
                        meta={subjectLabel(row.section.subject)}
                        status={a.finished && row.state.score != null ? `Score ${row.state.score}` : undefined}
                        action={a.label}
                        busy={opening === `p${row.section.id}`}
                        onAction={() => void openPaper(row)}
                      />
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </Section>
      </div>
    </DesktopChrome>
  );
}
