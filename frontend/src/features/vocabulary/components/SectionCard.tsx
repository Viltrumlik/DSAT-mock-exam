import Link from "next/link";
import { ChevronRight, Layers, Library, Type } from "lucide-react";

import { Card, CardContent, ProgressRing } from "@/components/ui";
import { cn } from "@/lib/cn";

import type { VocabSectionSummary } from "../types";
import { MasteryBar, masteredPercent } from "./MasteryBar";

/**
 * One published bank section on the hub. Icon square + ring + segmented mastery
 * bar, in the classroom-card idiom; `index` only drives the entrance stagger.
 */
export function SectionCard({ section, index = 0 }: { section: VocabSectionSummary; index?: number }) {
  const pct = masteredPercent(section.progress);
  const done = pct >= 100 && section.word_count > 0;

  return (
    <Link href={`/vocabulary/sections/${section.id}`} className="ds-ring block rounded-2xl">
      <Card
        variant="interactive"
        className={cn("cr-card group h-full", done && "ring-1 ring-inset ring-success/40")}
        style={{ animationDelay: `${Math.min(index, 12) * 60}ms` }}
      >
        <CardContent className="flex h-full flex-col gap-4">
          <div className="flex items-start gap-4">
            <span
              className={cn(
                "cr-iconpop flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                done ? "bg-success-soft text-success" : "bg-primary-soft text-primary",
              )}
            >
              <Library className="h-5 w-5" aria-hidden />
            </span>

            <div className="min-w-0 flex-1">
              {/* Wraps rather than truncates: the section name is how a student
                  identifies the card, and two cards per row squeezes it well below
                  the width even a short name like "College Panda" needs. */}
              <h3 className="ds-h4 line-clamp-2">{section.title}</h3>
              {section.description ? (
                <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{section.description}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <MetaChip icon={Layers} value={section.set_count} label={section.set_count === 1 ? "set" : "sets"} />
                <MetaChip icon={Type} value={section.word_count} label={section.word_count === 1 ? "word" : "words"} />
              </div>
            </div>

            <ProgressRing
              value={pct}
              size={56}
              strokeWidth={5}
              color={done ? "text-success" : "text-primary"}
              className="shrink-0"
            />
          </div>

          <MasteryBar progress={section.progress} legend className="mt-auto" />

          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
            Open section
            <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

function MetaChip({ icon: Icon, value, label }: { icon: React.ElementType; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold text-muted-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="ds-num">{value}</span> {label}
    </span>
  );
}
