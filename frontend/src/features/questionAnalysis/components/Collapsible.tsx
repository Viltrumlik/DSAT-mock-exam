import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The full question list, folded away under the short one.
 *
 * A native `<details>` rather than React state: it keeps the rows in the DOM for the
 * browser's own find-in-page, needs no hydration to open, and cannot desync from a re-render
 * of the table inside it.
 */
export function Collapsible({
  summary,
  hint,
  children,
  className,
}: {
  summary: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group rounded-2xl border border-border bg-card", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold text-foreground marker:content-[''] [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden
        />
        <span>{summary}</span>
        {hint ? <span className="ml-auto text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </summary>
      <div className="border-t border-border px-5 py-4">{children}</div>
    </details>
  );
}
