"use client";

import { cn } from "@/lib/cn";
import { spawnRipple } from "./ripple";

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ElementType;
  count?: number;
}

/**
 * The tab bar, shared by the classroom shell, its lesson and midterm panels, the
 * vocabulary hub, the standalone midterm list and the question analysis page.
 *
 * Restyled to the filter pills on the leaderboard, which is the shape the owner pointed
 * at: fully round, **solid** primary when chosen, a soft neutral when not, and no border
 * on either. What it replaces read as a row of outlined buttons of equal weight — the
 * chosen one was only a paler blue inside the same 1.5px frame, so which tab you were on
 * took a moment to find.
 *
 * The row sits on a block of white quartz (`.quartz`), without the float: a bar that
 * jumped whenever the pointer crossed it would be noise, and the surface is here to
 * ground the pills, not to be clicked.
 */
export function Tabs({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      // `p-2` is also the headroom the pills' hover lift needs: `overflow-x-auto` makes
      // the other axis scroll too, so a 2px rise with no padding would be clipped.
      //
      // `w-fit`: the block is as wide as its tabs and grows with each one added, rather
      // than stretching across the whole view — a full-width white bar behind two or three
      // pills read as an empty panel. `max-w-full` keeps a long bar from running off a
      // narrow screen: it caps at the column and the row scrolls inside it instead.
      className={cn("quartz flex w-fit max-w-full gap-2 overflow-x-auto rounded-2xl p-2", className)}
      role="tablist"
    >
      {items.map((t) => {
        const selected = t.id === active;
        const Icon = t.icon;
        return (
          <button
            // Key flips on selection so the newly-active tab remounts and replays the pop.
            key={selected ? `${t.id}-on` : t.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.id)}
            onPointerDown={spawnRipple}
            className={cn(
              "ds-ring cr-ripple cr-pill flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2",
              // Tabs take the surrounding page's face through the global controls rule in
              // globals.css (`font-family: inherit`); `font-[inherit]` only restates it.
              "font-[inherit] text-[13.5px] font-bold",
              selected
                ? "cr-tabpop bg-primary text-primary-foreground shadow-[0_6px_14px_-6px_var(--primary)]"
                : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden />}
            {t.label}
            {typeof t.count === "number" && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] font-extrabold leading-none",
                  // On the filled pill the count has to sit on the primary itself, so it
                  // is a translucent white rather than another opaque chip.
                  selected ? "bg-white/25 text-primary-foreground" : "bg-surface-3 text-muted-foreground",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
