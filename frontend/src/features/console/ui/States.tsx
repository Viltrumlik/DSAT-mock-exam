import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { Illustration, type IllustrationName } from "../graphics/Illustration";
import { buttonClass } from "./Button";

/** What failed, and Retry. Never drawn like an empty list: an error is not zero (design handoff v0.3, rule 4). */
export function ErrorState({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="animate-ms-fade-in flex items-center gap-3 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-3 text-[14px]">
      <Icon name="alert" className="shrink-0 text-ms-critical-fg" />
      <span className="flex-1 text-ms-fg">Couldn’t load {what}. This is not zero.</span>
      <button type="button" onClick={onRetry} className={buttonClass({ variant: "ghost", size: "sm", className: "text-ms-primary-text" })}>
        Retry
      </button>
    </div>
  );
}

/** Nothing to show: why, and the next thing to do. */
export function EmptyState({
  icon = "search",
  art,
  title,
  detail,
  action,
}: {
  icon?: IconName;
  /** A spot illustration in place of the icon (Graphics board): one per screen, never in a dialog. */
  art?: IllustrationName;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="animate-ms-fade-in flex flex-col items-center gap-2 px-5 py-12 text-center">
      {art ? (
        <Illustration name={art} decorative className="mb-2 w-[200px]" />
      ) : (
        <span className="mb-1 grid size-12 place-items-center rounded-full bg-ms-surface-2 text-ms-fg-3">
          <Icon name={icon} size="lg" />
        </span>
      )}
      <b className="text-[16px] font-semibold text-ms-fg">{title}</b>
      {detail ? <p className="max-w-sm text-[14px] text-ms-fg-2">{detail}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
