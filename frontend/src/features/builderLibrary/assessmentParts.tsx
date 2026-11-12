"use client";

import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * What Categories, Archived and the Old sets bank share (design handoff v0.3, PR 20): an assessment set's subject
 * in the Builder's colours, and the page's standing note. The words are the pages' own.
 */

/** An assessment set's subject ("math" / "english") as the Builder colours it: Math violet, English rose. */
export function SetSubjectPill({ subject, children }: { subject: string; children: ReactNode }) {
  const math = subject === "math";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-[9px] text-[13px] font-semibold leading-none tabular-nums",
        math ? "bg-ms-math-soft text-ms-math-fg" : "bg-ms-rw-soft text-ms-rw-fg",
      )}
    >
      <Icon name={math ? "sigma" : "book"} size="sm" className="size-3.5" />
      {children}
    </span>
  );
}

/** A standing note at the top of a page: a title and a sentence, in the attention colours. */
export function PageNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      role="note"
      className="animate-ms-fade-in flex items-start gap-2.5 rounded-ms-card border border-ms-attention-line bg-ms-attention-soft px-4 py-3.5 text-ms-attention-fg"
    >
      <Icon name="warn" size="sm" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-[14px] font-semibold leading-5">{title}</p>
        <p className="mt-0.5 text-[14px] leading-5">{children}</p>
      </div>
    </div>
  );
}
