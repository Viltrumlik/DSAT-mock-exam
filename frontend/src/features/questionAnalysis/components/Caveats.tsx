import { AlertTriangle, ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { plural } from "../format";

export interface Caveat {
  id: string;
  /** `warning` for work that was left out or numbers that need a human; `info` for the rest. */
  tone: "info" | "warning";
  text: string;
}

/** The label on the fold. Exported so the panels' tests can name the thing they open. */
export const COUNTING_NOTES_SUMMARY = "How these numbers are counted";

/**
 * The footnotes that make the numbers above them mean something.
 *
 * Nothing here is ever dropped: both endpoints deliberately exclude work — corrupt attempts,
 * repeat sittings, retired questions — and both divide by a denominator narrower than "the
 * class". A page that shows the rates without the exclusions is claiming to have analysed
 * work it never looked at, which is worse than showing nothing.
 *
 * But they are not all the same kind of fact, and rendering them as six identical grey rows
 * cost the page its first screen: the work list started ~340px down, and "3 sittings were
 * excluded as corrupt" looked exactly like "here is how the denominator works" because only
 * the icon carried the tone.
 *
 * So they split by what a teacher has to DO about them:
 *
 *   - **Warnings** — something was left out, or a number needs a human to check it. Always
 *     visible, on an amber surface, above the fold. These are the ones that change what you
 *     do next.
 *   - **Notes** — the unconditional method: what the denominator is, which sitting counts.
 *     True on every render, identical every time, and needed only when a number is being
 *     questioned. They fold into one disclosure.
 *
 * A native `<details>`, so every note stays in the DOM for find-in-page and nothing depends
 * on hydration to be readable.
 */
export function Caveats({ items, className }: { items: Caveat[]; className?: string }) {
  if (items.length === 0) return null;

  const warnings = items.filter((item) => item.tone === "warning");
  const notes = items.filter((item) => item.tone !== "warning");

  return (
    <div className={cn("space-y-2", className)}>
      {warnings.length > 0 && (
        <ul className="space-y-2">
          {warnings.map((item) => (
            <li
              key={item.id}
              data-caveat-tone="warning"
              className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2"
            >
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300"
                aria-hidden
              />
              {/* 8.06:1 light, 13.66:1 dark on this surface. */}
              <span className="text-xs font-medium leading-relaxed text-amber-900 dark:text-amber-100">
                {item.text}
              </span>
            </li>
          ))}
        </ul>
      )}

      {notes.length > 0 && (
        <details
          data-caveat-notes
          className="group rounded-xl border border-border bg-surface-2/60"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground marker:content-[''] [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90"
              aria-hidden
            />
            <span>{COUNTING_NOTES_SUMMARY}</span>
            <span className="ml-auto font-normal">{plural(notes.length, "note")}</span>
          </summary>
          <ul className="space-y-2 border-t border-border px-3 py-2.5">
            {notes.map((item) => (
              <li key={item.id} data-caveat-tone="info" className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="text-xs leading-relaxed text-muted-foreground">{item.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
