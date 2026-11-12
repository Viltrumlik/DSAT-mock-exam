import type { CSSProperties, ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { buttonClass } from "../ui";

/** A Today card; `delay` puts it in reading order as the page arrives. */
export function Card({
  title,
  children,
  action,
  aside,
  delay = 0,
  className = "",
  style,
}: {
  title: ReactNode;
  children: ReactNode;
  /** Right of the title: a link or a quiet note. */
  action?: ReactNode;
  /** Right beside the title: a count, a badge. */
  aside?: ReactNode;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      className={`animate-ms-card-in flex min-w-0 flex-col gap-3.5 rounded-ms-card bg-ms-card px-[22px] py-5 shadow-ms-1 ${className}`}
      style={{ animationDelay: `${delay}ms`, ...style }}
    >
      <div className="flex items-center gap-2.5">
        <h2 className="text-ms-h text-ms-fg">{title}</h2>
        {aside}
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** What failed and Retry — never drawn as a zero. */
export function Failed({ what, why, retry }: { what: string; why?: string; retry: () => void }) {
  return (
    <div className="animate-ms-fade-in flex items-start gap-3 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-3 text-[14px]">
      <Icon name="alert" className="mt-0.5 shrink-0 text-ms-critical-fg" />
      <span className="flex flex-1 flex-col gap-0.5">
        <b className="font-semibold text-ms-fg">Couldn’t load {what}</b>
        <span className="text-ms-fg-2">{why ?? "This is not zero."}</span>
      </span>
      <button type="button" onClick={retry} className={buttonClass({ variant: "ghost", size: "sm", className: "text-ms-primary-text" })}>
        Retry
      </button>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 py-1">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="animate-ms-shimmer h-4 rounded-[6px]" style={{ width: `${80 - i * 15}%` }} />
      ))}
    </div>
  );
}
