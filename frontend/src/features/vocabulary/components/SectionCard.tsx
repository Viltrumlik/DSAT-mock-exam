import Link from "next/link";
import { ChevronRight, Layers, Type } from "lucide-react";

import { Card, CardContent, ProgressRing } from "@/components/ui";
import { cn } from "@/lib/cn";

import { sectionLook } from "../sectionTone";
import type { VocabSectionSummary } from "../types";
import { SectionMasteryBar } from "./MasteryBar";

/**
 * One published bank section on the hub.
 *
 * Rebuilt around the fact that these cards appear four at a time and used to be
 * indistinguishable — one `Library` glyph, one blue square, one grey ring at 0%, one grey
 * bar, four times. The section now owns a colour (see `sectionTone`), carried by the
 * card's top edge, the glyph square, the meta chips, the ring and the meter — never by the
 * card's GROUND, which stays white. Four small marks are enough to tell four cards apart,
 * and they cost the page no coloured surface. The same colour greets the student on the
 * section's own page.
 *
 * The ring and the bar answer **different** questions, which is why both are here:
 *
 * * the ring counts **words** mastered out of the section's distinct words — the number
 *   the hub's "Words mastered" tile sums across every section;
 * * the bar counts **sets** mastered, the roll-up of the very bars on the set cards one
 *   click away.
 *
 * They are labelled accordingly. Drawing one number twice was the thing to avoid.
 */
export function SectionCard({ section, index = 0 }: { section: VocabSectionSummary; index?: number }) {
  const look = sectionLook(section.id);
  const setPct = section.mastery?.percent ?? 0;
  const done = setPct >= 100 && section.set_count > 0;

  const words = section.progress;
  const wordPct = words && words.total > 0 ? Math.round((words.mastered / words.total) * 100) : 0;

  return (
    <Link href={`/vocabulary/sections/${section.id}`} className="ds-ring block rounded-2xl">
      <Card
        variant="interactive"
        className={cn("cr-card group relative h-full overflow-hidden", done && "ring-1 ring-inset ring-success/40")}
        style={{ animationDelay: `${Math.min(index, 12) * 60}ms` }}
      >
        {/* The card stays white. The section's colour lives in the small marks only — this
            edge, the glyph, the ring, the meter, the link — which is enough to tell four
            cards apart at a glance and adds no coloured ground to the page. */}
        <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r", look.edge)} />

        <CardContent className="relative flex h-full flex-col gap-4">
          <div className="flex items-start gap-4">
            <span
              className={cn(
                "cr-iconpop flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                done ? "bg-success/15 text-success" : look.icon,
              )}
            >
              <look.Icon className="h-[22px] w-[22px]" aria-hidden />
            </span>

            <div className="min-w-0 flex-1">
              {/* Wraps rather than truncates: the section name is how a student
                  identifies the card, and two cards per row squeezes it well below
                  the width even a short name like "College Panda" needs. */}
              <h3 className="ds-h4 line-clamp-2">{section.title}</h3>
              {section.description ? (
                <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{section.description}</p>
              ) : null}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <MetaChip
                  icon={Layers}
                  value={section.set_count}
                  label={section.set_count === 1 ? "set" : "sets"}
                  className={look.chip}
                />
                <MetaChip
                  icon={Type}
                  value={section.word_count}
                  label={section.word_count === 1 ? "word" : "words"}
                  className={look.chip}
                />
              </div>
            </div>

            <div
              className="flex shrink-0 flex-col items-center gap-1"
              title={`${words?.mastered ?? 0} of ${words?.total ?? 0} words mastered`}
            >
              <ProgressRing
                value={wordPct}
                size={54}
                strokeWidth={5}
                color={done ? "text-success" : look.ring}
                trackColor={done ? "text-success/20" : look.ringTrack}
              />
              <span className="text-[9.5px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
                words
              </span>
            </div>
          </div>

          <SectionMasteryBar
            mastery={section.mastery}
            className="mt-auto"
            bar={done ? "bg-success" : look.bar}
            track={done ? "bg-success/15" : look.track}
          />

          <span className={cn("inline-flex items-center gap-1 text-[13px] font-bold", look.text)}>
            Open section
            <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

function MetaChip({
  icon: Icon,
  value,
  label,
  className,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold",
        className ?? "bg-surface-2 text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="ds-num">{value}</span> {label}
    </span>
  );
}
