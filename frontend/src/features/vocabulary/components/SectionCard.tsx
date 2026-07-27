import Link from "next/link";
import { ChevronRight, Layers, Type } from "lucide-react";

import { Card, CardContent, ProgressRing } from "@/components/ui";

import type { VocabSectionSummary } from "../types";
import { MasteryBar, masteredPercent } from "./MasteryBar";

export function SectionCard({ section }: { section: VocabSectionSummary }) {
  const pct = masteredPercent(section.progress);

  return (
    <Link href={`/vocabulary/sections/${section.id}`} className="ds-ring block rounded-2xl">
      <Card variant="interactive" className="h-full">
        <CardContent className="flex h-full flex-col gap-4">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h3 className="ds-h4 truncate">{section.title}</h3>
              {section.description ? (
                <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{section.description}</p>
              ) : null}
              <div className="ds-num mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" />
                  {section.set_count} {section.set_count === 1 ? "set" : "sets"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Type className="h-3.5 w-3.5" />
                  {section.word_count} {section.word_count === 1 ? "word" : "words"}
                </span>
              </div>
            </div>
            <ProgressRing
              value={pct}
              size={56}
              strokeWidth={5}
              color={pct >= 100 ? "text-success" : "text-primary"}
              className="shrink-0"
            />
          </div>

          <MasteryBar progress={section.progress} legend className="mt-auto" />

          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
            Open section <ChevronRight className="h-4 w-4" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
