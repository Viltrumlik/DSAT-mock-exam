import type { ReactNode } from "react";

/** The toolbox's cards and controls, in the console's ruled look (every `<table>` is ruled by globals.css). */
export const CARD = "relative rounded-ms-card border border-ms-border bg-ms-card";
export const CONTROL =
  "ms-transition h-(--ms-h-ctl) w-full rounded-ms-ctl border border-ms-border-input bg-ms-card px-3 text-[15px] text-ms-fg outline-none focus:border-ms-primary focus:shadow-[0_0_0_3px_var(--ms-primary-soft-2)] disabled:opacity-60";
export const TH = "px-3 text-left first:pl-4 last:pr-4";
export const TD = "px-3 py-1.5 first:pl-4 last:pr-4";
export const LABEL = "flex flex-col gap-1 text-[13px] text-ms-fg-2";

/** A refusal or a failure, in red. */
export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3 py-2 text-[14px] text-ms-critical-fg">
      {children}
    </div>
  );
}

/** What a tool did, in green. */
export function DoneLine({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-ms-ctl border border-ms-border bg-ms-positive-soft px-3 py-2 text-[14px] text-ms-positive-fg">
      {children}
    </div>
  );
}
