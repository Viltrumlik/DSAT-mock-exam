"use client";

import type { ReactNode } from "react";

import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import { offsetText, stampText } from "./format";
import { useToolboxActions, useToolboxStatus } from "./toolboxHooks";
import { CARD, ErrorLine, TD, TH } from "./ui";

function yesNo(value: boolean, good = true): ReactNode {
  const fine = value === good;
  return <span className={fine ? "text-ms-positive-fg" : "text-ms-critical-fg"}>{value ? "Yes" : "No"}</span>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] text-ms-fg-2">{label}</dt>
      <dd className="text-[15px] text-ms-fg">{children}</dd>
    </div>
  );
}

/** Which copy this is and whether its background work runs; then everything done in the toolbox, newest first. */
export function StatusPanel() {
  const status = useToolboxStatus();
  const actions = useToolboxActions();
  const s = status.data;
  const release = s?.release;

  return (
    <div className="flex flex-col gap-4">
      <section className={cn(CARD, "p-4")} aria-labelledby="tb-status">
        <h2 id="tb-status" className="mb-3 text-[15px] font-semibold text-ms-fg">Status</h2>
        {status.error ? <ErrorLine>{formatApiErrorForToast(status.error)}</ErrorLine> : null}
        {s ? (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Release">{release ? `${release.release_id ?? ""} ${release.git_short ?? ""}`.trim() || "—" : "—"}</Fact>
            <Fact label="Database">{s.database}</Fact>
            <Fact label="Copied from prod">{stampText(s.database_copied_at)}</Fact>
            <Fact label="Messages captured">{yesNo(s.capture)}</Fact>
            <Fact label="Clock">{offsetText(s.clock.offset_days)} · {stampText(s.clock.test_now)}</Fact>
            <Fact label="Celery worker answers">{yesNo(s.worker_alive)}</Fact>
            <Fact label="Last billing tick">{stampText(s.last_tick)}</Fact>
            <Fact label="Left lc-up (switches)">{yesNo(s.left_lcup)}</Fact>
            <Fact label="Cutover finished">{yesNo(s.finished)}</Fact>
          </dl>
        ) : null}
      </section>
      <section className={cn(CARD, "flex flex-col gap-3 p-4")} aria-labelledby="tb-log">
        <h2 id="tb-log" className="text-[15px] font-semibold text-ms-fg">What was done here</h2>
        {actions.error ? <ErrorLine>{formatApiErrorForToast(actions.error)}</ErrorLine> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-ms-fg">
            <caption className="sr-only">The toolbox&apos;s last 100 actions, newest first</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>When</th>
                <th scope="col" className={TH}>Who</th>
                <th scope="col" className={TH}>What</th>
                <th scope="col" className={TH}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {(actions.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td className={cn(TD, "whitespace-nowrap tabular-nums")}>{stampText(a.at)}</td>
                  <td className={TD}>{a.by || "—"}</td>
                  <td className={cn(TD, "font-mono text-[13px]")}>{a.action}</td>
                  <td className={cn(TD, "break-all font-mono text-[13px]")}>{JSON.stringify(a.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
