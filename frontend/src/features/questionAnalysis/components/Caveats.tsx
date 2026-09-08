import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Caveat {
  id: string;
  /** `warning` for work that was left out or numbers that need a human; `info` for the rest. */
  tone: "info" | "warning";
  text: string;
}

/**
 * The footnotes that make the numbers above them mean something.
 *
 * These are not decoration and they are not collapsed. Both endpoints deliberately exclude
 * work — corrupt attempts, repeat sittings, retired questions — and both divide by a
 * denominator narrower than "the class". A page that shows the rates without the exclusions
 * is claiming to have analysed work it never looked at, which is worse than showing nothing.
 */
export function Caveats({ items, className }: { items: Caveat[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item) => {
        const Icon = item.tone === "warning" ? AlertTriangle : Info;
        return (
          <li
            key={item.id}
            className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/60 px-3 py-2"
          >
            <Icon
              className={cn(
                "mt-0.5 h-3.5 w-3.5 shrink-0",
                item.tone === "warning" ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground",
              )}
              aria-hidden
            />
            <span className="text-xs leading-relaxed text-muted-foreground">{item.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
