import { Gamepad2 } from "lucide-react";

import { Card, CardContent, ExplainButton } from "@/components/ui";
import { cn } from "@/lib/cn";

import { MODE_META, modeAccent } from "../modeTone";
import { STUDY_MODES, STUDY_MODE_LABEL } from "../types";

/**
 * The four games, on the hub.
 *
 * They are what the feature *is*, and they were invisible until a student had picked a
 * section, then a set — two clicks — because the hub described them in a single line of
 * hero prose and nothing else. Meanwhile the hub's own bottom half was empty: four
 * section cards ended a little past the fold and the rest of the page was background.
 *
 * So the games fill it, in their own colours. Those are the same four colours the bar on
 * every set card is painted in, which is what the strip along the bottom of each tile is
 * for — this band is that bar's key. The rule itself (one clean run masters a game; four
 * master the set) is non-obvious enough to have needed a sentence of hero copy, so it
 * sits behind the **!** where a student can ask for it instead of being told it every
 * visit.
 */
export function GameGuide({ className }: { className?: string }) {
  return (
    <Card className={cn("cr-cardrise", className)}>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary dark:text-primary-hover">
              <Gamepad2 className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="ds-h4">Four ways to play every set</h2>
              <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">
                The coloured bar on every set card is these four — a quarter each.
              </p>
            </div>
          </div>

          <ExplainButton title="How a set is mastered" side="left" className="mt-1">
            Play one game with <strong className="font-bold text-foreground">every word right</strong> and
            that game is mastered — a quarter of the set&rsquo;s bar fills in its colour. Master all four
            and the set is done. There is no part credit: a run with one mistake leaves the quarter
            empty, so you can simply play it again.
          </ExplainButton>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STUDY_MODES.map((mode, i) => {
            const tone = modeAccent(mode);
            const { icon: Icon, blurb } = MODE_META[mode];
            return (
              <div
                key={mode}
                className={cn("cr-card group relative overflow-hidden rounded-2xl border p-4", tone.wash)}
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", tone.edge)} />
                <span className={cn("cr-iconpop grid h-11 w-11 place-items-center rounded-2xl", tone.icon)}>
                  <Icon className="h-[21px] w-[21px]" aria-hidden />
                </span>
                <h3 className={cn("mt-3 text-[14.5px] font-extrabold tracking-tight", tone.cta)}>
                  {STUDY_MODE_LABEL[mode]}
                </h3>
                <p className="mt-1 text-[12.5px] font-medium leading-relaxed text-muted-foreground">{blurb}</p>
                {/* This game's quarter, at the size it appears on a set card. */}
                <span
                  aria-hidden
                  className={cn("ds-growx mt-3.5 block h-1.5 w-full rounded-full", tone.fill)}
                  style={{ "--ds-delay": `${240 + i * 90}ms` } as React.CSSProperties}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
