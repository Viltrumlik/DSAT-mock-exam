"use client";

import { useState } from "react";

import { buttonClass, signedAmount } from "@/features/console/ui";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import { addDays, dayText, offsetText, stampText } from "./format";
import type { DayReport, TimeJob, TimeRequest } from "./toolboxApi";
import { ANY_REQUEST, useAskTime, useTimeMachineWait, useTimeState } from "./toolboxHooks";
import { CARD, CONTROL, ErrorLine, TD, TH } from "./ui";

const WORKING = "The time machine is working… (the copy restarts, 10–60 s)";
const LOST = "Everything done after this point is lost.";
const ACTION_TEXT: Record<string, string> = {
  forward: "Forward",
  back: "Back to a checkpoint",
  today: "Back to today",
  refresh: "Refresh from prod",
};

function reloadPage() {
  window.location.reload();
}

function jobTitle(job: TimeJob): string {
  const days = Number(job.params?.days ?? 0);
  const words = ACTION_TEXT[job.action] ?? job.action;
  return job.action === "forward" && days ? `${words} ${offsetText(days)}` : words;
}

function daysOf(result: unknown): DayReport[] {
  const days = (result as { days?: unknown } | null)?.days;
  return Array.isArray(days) ? (days as DayReport[]) : [];
}

function summaryOf(job: TimeJob): string {
  const result = (job.result ?? {}) as { checkpoint?: number; test_date?: string; cutover?: unknown };
  if (job.action === "refresh") return `A new copy of prod, checkpoint ${result.checkpoint ?? "—"}. Cutover: ${String(result.cutover ?? "—")}.`;
  if (result.test_date) return `Back at checkpoint ${result.checkpoint ?? "—"}: the test date is ${dayText(result.test_date)}.`;
  return "Done.";
}

/** The last request's report: per day what the day's work did, its alerts in amber and its errors in red. */
function LastRun({ job }: { job: TimeJob }) {
  const heading = `Last run: ${jobTitle(job)}${job.by ? `, by ${job.by}` : ""}, ${stampText(job.finished_at ?? job.started_at)}`;
  if (job.ok === false) {
    return (
      <section className={cn(CARD, "p-4")} aria-label="Last run">
        <h2 className="text-[15px] font-semibold text-ms-fg">{heading}</h2>
        <ErrorLine>It did not go through: {job.error || "no reason was given"}. The copy is as it was before it.</ErrorLine>
      </section>
    );
  }
  const days = job.action === "forward" ? daysOf(job.result) : [];
  const alerts = days.flatMap((d) => d.alerts.map((text) => ({ day: d.test_date, text })));
  const errors = days.flatMap((d) => d.errors.map((text) => ({ day: d.test_date, text })));
  return (
    <section className={cn(CARD, "flex flex-col gap-3 p-4")} aria-label="Last run">
      <h2 className="text-[15px] font-semibold text-ms-fg">{heading}</h2>
      {days.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] whitespace-nowrap text-ms-fg">
            <caption className="sr-only">What each test day did</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Day</th>
                <th scope="col" className={cn(TH, "text-right")}>Lessons</th>
                <th scope="col" className={cn(TH, "text-right")}>Charged, so’m</th>
                <th scope="col" className={cn(TH, "text-right")}>Frozen</th>
                <th scope="col" className={cn(TH, "text-right")}>Unfrozen</th>
                <th scope="col" className={cn(TH, "text-right")}>SMS</th>
                <th scope="col" className={cn(TH, "text-right")}>Telegram</th>
                <th scope="col" className={cn(TH, "text-right")}>E-mail</th>
                <th scope="col" className={cn(TH, "text-right")}>Push</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.test_date} data-day-row>
                  <td className={cn(TD, "tabular-nums")}>{dayText(d.test_date)}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{d.lessons.count}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{signedAmount(d.lessons.amount)}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{d.frozen}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{d.unfrozen}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{d.messages.sms}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{d.messages.telegram}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{d.messages.email}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{d.messages.push}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[14px] text-ms-fg-2">{summaryOf(job)}</p>
      )}
      {alerts.length || errors.length ? (
        <ul className="flex flex-col gap-1 text-[14px]">
          {alerts.map((a, i) => (
            <li key={`a${i}`} data-alert className="rounded-ms-ctl border border-ms-border bg-ms-attention-soft px-3 py-1.5 text-ms-attention-fg">
              {dayText(a.day)}: {a.text}
            </li>
          ))}
          {errors.map((e, i) => (
            <li key={`e${i}`} data-error className="rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3 py-1.5 text-ms-critical-fg">
              {dayText(e.day)}: {e.text}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The time machine (deploy/staging/stg_timemachine.py): the copy's date moves forward a day at a time, each day's work
 * done; or the copy goes back to a checkpoint, or to a fresh copy of prod. One request at a time. While it works the
 * copy restarts, so the panel asks every few seconds and reloads the page when its request is done — the browser's
 * clock script then reads the new date.
 */
export function TimeMachinePanel({ reload = reloadPage }: { reload?: () => void }) {
  const state = useTimeState();
  const ask = useAskTime();
  const [mine, setMine] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const data = state.data;
  const othersRunning = Boolean(data && (data.busy || data.pending));
  const failed = useTimeMachineWait(mine ?? (othersRunning ? ANY_REQUEST : null), reload);
  const working = Boolean(mine) || othersRunning;
  const off = working || ask.isPending || !data;

  function send(body: TimeRequest, question?: string) {
    if (question && !window.confirm(question)) return;
    ask.mutate(body, { onSuccess: ({ id }) => setMine(id) });
  }

  if (state.isPending) {
    return <div role="status" aria-busy className="h-40 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />;
  }
  if (!data) {
    return (
      <ErrorLine>
        Could not read the time machine. {formatApiErrorForToast(state.error)}{" "}
        <button type="button" onClick={() => state.refetch()} className={buttonClass({ variant: "secondary", size: "sm" })}>
          Try again
        </button>
      </ErrorLine>
    );
  }

  const tomorrow = addDays(data.test_date, 1);
  const checkpoints = [...data.checkpoints].sort((a, b) => b.id - a.id);
  const base = checkpoints.find((cp) => cp.kind === "base");
  const button = buttonClass({ variant: "secondary", size: "sm" });

  return (
    <div className="flex flex-col gap-4">
      <section className={cn(CARD, "flex flex-col gap-3 p-4")} aria-labelledby="tm-date">
        <h2 id="tm-date" className="text-[17px] font-semibold text-ms-fg">
          Test date: {dayText(data.test_date)} <span className="font-normal text-ms-fg-2">({offsetText(data.offset_days)})</span>
        </h2>
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" disabled={off} onClick={() => send({ action: "forward", days: 1 })} className={button}>
            +1 day
          </button>
          <button type="button" disabled={off} onClick={() => send({ action: "forward", days: 7 })} className={button}>
            +1 week
          </button>
          <label className="flex flex-col gap-1 text-[13px] text-ms-fg-2">
            Date
            <input type="date" min={tomorrow} value={date} disabled={off} onChange={(e) => setDate(e.target.value)} className={cn(CONTROL, "w-44")} />
          </label>
          <button type="button" disabled={off || !date || date < tomorrow} onClick={() => send({ action: "to", date })} className={button}>
            Go to date
          </button>
        </div>
        {working ? (
          <p role="status" className="rounded-ms-ctl border border-ms-border bg-ms-surface-2 px-3 py-2 text-[14px] text-ms-fg">
            {WORKING}
            {!mine && data.busy ? <span className="block text-ms-fg-2">{jobTitle(data.busy)}{data.busy.by ? `, asked by ${data.busy.by}` : ""}.</span> : null}
          </p>
        ) : null}
        {ask.error ? <ErrorLine>{formatApiErrorForToast(ask.error)}</ErrorLine> : null}
        {failed ? <ErrorLine>Lost touch with the time machine: {formatApiErrorForToast(failed)} Reload the page.</ErrorLine> : null}
      </section>

      {data.last ? <LastRun job={data.last} /> : null}

      <section className={cn(CARD, "flex flex-col gap-3 p-4")} aria-labelledby="tm-checkpoints">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="tm-checkpoints" className="text-[15px] font-semibold text-ms-fg">Checkpoints</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={off || !base}
              onClick={() => send({ action: "today" }, `Go back to the copy as it was taken from prod? ${LOST}`)}
              className={button}
            >
              Back to today
            </button>
            <button
              type="button"
              disabled={off}
              onClick={() =>
                send({ action: "refresh" }, "Take a new copy of prod (2–5 minutes)? Everything on the copy now, and every checkpoint, is lost.")
              }
              className={buttonClass({ variant: "danger", size: "sm" })}
            >
              Refresh from prod
            </button>
          </div>
        </div>
        {checkpoints.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] whitespace-nowrap text-ms-fg">
              <caption className="sr-only">Checkpoints, newest first</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Checkpoint</th>
                  <th scope="col" className={TH}>Test date</th>
                  <th scope="col" className={TH}>Taken at</th>
                  <th scope="col" className={cn(TH, "w-0")}><span className="sr-only">Go back</span></th>
                </tr>
              </thead>
              <tbody>
                {checkpoints.map((cp) => (
                  <tr key={cp.id}>
                    <td className={TD}>{cp.label}{cp.kind === "base" ? " (base)" : ""}</td>
                    <td className={cn(TD, "tabular-nums")}>{dayText(cp.test_date)}</td>
                    <td className={cn(TD, "tabular-nums")}>{stampText(cp.taken_at)}</td>
                    <td className={TD}>
                      <button
                        type="button"
                        disabled={off}
                        onClick={() =>
                          send({ action: "back", checkpoint: cp.id }, `Go back to “${cp.label}” (test date ${dayText(cp.test_date)})? ${LOST}`)
                        }
                        className={button}
                      >
                        Go back here
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[14px] text-ms-fg-2">No checkpoints yet: Refresh from prod takes the first one.</p>
        )}
      </section>
    </div>
  );
}
