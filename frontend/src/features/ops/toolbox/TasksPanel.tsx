"use client";

import { buttonClass } from "@/features/console/ui";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import { useBeatTasks, useRunTask } from "./toolboxHooks";
import { CARD, DoneLine, ErrorLine, TD, TH } from "./ui";

/** Every task the beat runs on its schedule, run now instead, with what it returned. */
export function TasksPanel() {
  const tasks = useBeatTasks();
  const run = useRunTask();
  const result = run.data;

  return (
    <section className={cn(CARD, "flex flex-col gap-3 p-4")} aria-labelledby="tb-tasks">
      <h2 id="tb-tasks" className="text-[15px] font-semibold text-ms-fg">Run a beat task now</h2>
      {run.error ? <ErrorLine>{formatApiErrorForToast(run.error)}</ErrorLine> : null}
      {result ? (
        result.ok ? (
          <DoneLine>
            <span className="font-semibold">{result.name}</span>: <code className="break-all">{result.result}</code>
          </DoneLine>
        ) : (
          <ErrorLine>
            <span className="font-semibold">{result.name}</span> failed: <code className="break-all">{result.result}</code>
          </ErrorLine>
        )
      ) : null}
      {tasks.error ? <ErrorLine>{formatApiErrorForToast(tasks.error)}</ErrorLine> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-ms-fg">
          <caption className="sr-only">The beat&apos;s schedule</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Entry</th>
              <th scope="col" className={TH}>Task</th>
              <th scope="col" className={TH}>Schedule</th>
              <th scope="col" className={cn(TH, "w-0")}><span className="sr-only">Run</span></th>
            </tr>
          </thead>
          <tbody>
            {(tasks.data ?? []).map((t) => (
              <tr key={t.name}>
                <td className={TD}>{t.name}</td>
                <td className={cn(TD, "font-mono text-[13px]")}>{t.task}</td>
                <td className={cn(TD, "whitespace-nowrap font-mono text-[13px]")}>{t.schedule}</td>
                <td className={TD}>
                  <button
                    type="button"
                    disabled={run.isPending}
                    onClick={() => run.mutate(t.name)}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    {run.isPending && run.variables === t.name ? "Running…" : "Run now"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
