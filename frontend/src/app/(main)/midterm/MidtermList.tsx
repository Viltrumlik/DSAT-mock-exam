"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Timer, Lock, ArrowRight, Award, Hourglass, CheckCircle2 } from "lucide-react";
import { classesApi } from "@/lib/api";
import { downloadBlob } from "@/lib/download";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { useMyMidterms, type MyMidterm } from "@/features/classroom/hooks";

/**
 * Student midterm list — schedule-aware states (countdown → start → awaiting → result).
 *
 * NOTE: presentation is intentionally straightforward and built on the shared design
 * tokens; it is isolated so the pending 1:1 mockup can restyle this file alone.
 */

/** Live countdown to an ISO instant. `done` flips true when the instant passes. */
function useCountdown(targetIso: string | null) {
  const [now, setNow] = useState(() => 0);
  useEffect(() => {
    setNow(Date.now());
    if (!targetIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [targetIso]);
  if (!targetIso || now === 0) return { done: !targetIso, label: "" };
  const ms = new Date(targetIso).getTime() - now;
  if (ms <= 0) return { done: true, label: "" };
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const label = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
  return { done: false, label };
}

function scaleMax(scoring_scale: string) {
  return scoring_scale === "SCALE_800" ? 800 : 100;
}

function MidtermCard({ m }: { m: MyMidterm }) {
  const router = useRouter();
  const countdown = useCountdown(m.is_before_start ? m.available_at : null);
  const [busy, setBusy] = useState(false);
  const open = m.is_open || (m.is_before_start && countdown.done);

  async function download() {
    if (!m.certificate.code) return;
    setBusy(true);
    try {
      const blob = await classesApi.downloadCertificate(m.certificate.code);
      downloadBlob(blob, "certificate.pdf");
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    } finally {
      setBusy(false);
    }
  }

  const locked = m.is_before_start && !countdown.done;
  const awaiting = m.submitted && !m.results_visible;
  const released = m.submitted && m.results_visible;

  return (
    <div className="cr-rise flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Timer className="h-4 w-4 text-primary" aria-hidden />
        <span className="ds-overline text-muted-foreground">Midterm</span>
      </div>
      <h3 className="ds-h4 mt-1 text-foreground">{m.title}</h3>

      <div className="mt-4 flex-1">
        {locked && (
          <div className="rounded-xl bg-surface-2 p-4 text-center">
            <Lock className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opens in</p>
            <p className="ds-num mt-1 text-2xl font-black tabular-nums text-foreground">{countdown.label || "…"}</p>
            {m.available_at && <p className="mt-1 text-xs text-muted-foreground">{new Date(m.available_at).toLocaleString()}</p>}
          </div>
        )}
        {!locked && awaiting && (
          <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-4 text-sm text-muted-foreground">
            <Hourglass className="h-4 w-4" aria-hidden /> Submitted — your teacher will release the results.
          </div>
        )}
        {released && (
          <div className="rounded-xl bg-primary-soft p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your score</p>
            <p className="ds-num mt-1 text-3xl font-black tabular-nums text-primary">{m.score ?? "—"}<span className="text-base font-semibold text-muted-foreground"> / {scaleMax(m.scoring_scale)}</span></p>
            {m.certificate.rank != null && m.certificate.cohort_size != null && (
              <p className="mt-1 text-xs font-medium text-muted-foreground">Class rank {m.certificate.rank} of {m.certificate.cohort_size}</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4">
        {open && !m.submitted ? (
          <button
            onClick={() => router.push(`/mock/${m.mock_exam_id}?midterm=1`)}
            className="cr-press ds-anim-pop inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--primary-hover)]"
          >
            {m.has_attempt ? "Resume midterm" : "Start midterm"} <ArrowRight className="h-4 w-4" />
          </button>
        ) : released && m.certificate.available ? (
          <button
            onClick={download}
            disabled={busy}
            className="cr-press inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--primary-hover)] disabled:opacity-60"
          >
            <Award className="h-4 w-4" /> {busy ? "Preparing…" : "Download certificate"}
          </button>
        ) : released ? (
          <div className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-semibold text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" /> Completed
          </div>
        ) : locked ? (
          <button disabled className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-semibold text-muted-foreground">
            <Lock className="h-4 w-4" /> Locked
          </button>
        ) : (
          <div className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-semibold text-muted-foreground">
            <Hourglass className="h-4 w-4" /> Awaiting results
          </div>
        )}
      </div>
    </div>
  );
}

export default function MidtermList() {
  const { data, isLoading } = useMyMidterms();
  const midterms = data?.midterms ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <span className="ds-overline text-muted-foreground">Midterm</span>
      <h1 className="ds-h1 mt-1 text-foreground">Your midterms</h1>
      <p className="ds-lead mt-2 max-w-2xl text-muted-foreground">
        Timed midterms your teacher schedules. A midterm unlocks at its start time; your score is released once your teacher issues certificates.
      </p>

      {isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : midterms.length === 0 ? (
        <p className="mt-8 rounded-xl bg-surface-2 p-6 text-center text-sm text-muted-foreground">No midterms assigned yet.</p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {midterms.map((m) => <MidtermCard key={m.mock_exam_id} m={m} />)}
        </div>
      )}
    </div>
  );
}
