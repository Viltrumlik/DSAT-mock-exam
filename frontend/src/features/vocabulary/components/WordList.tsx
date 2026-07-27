"use client";

import { useMemo, useState } from "react";
import { Filter } from "lucide-react";

import { Card, CardContent, EmptyState, SegmentedControl, type Segment } from "@/components/ui";

import { WORD_STATUS_LABEL, type VocabWord, type WordFilter } from "../types";
import { WordStatusPill } from "./WordStatusPill";

const FILTER_ORDER: WordFilter[] = ["all", "new", "learning", "mastered"];

export function WordList({ words }: { words: VocabWord[] }) {
  const [filter, setFilter] = useState<WordFilter>("all");

  const counts = useMemo(() => {
    const c: Record<WordFilter, number> = { all: words.length, new: 0, learning: 0, mastered: 0 };
    for (const w of words) c[w.status] += 1;
    return c;
  }, [words]);

  const shown = useMemo(
    () => (filter === "all" ? words : words.filter((w) => w.status === filter)),
    [words, filter],
  );

  const options: Segment<WordFilter>[] = FILTER_ORDER.map((key) => ({
    value: key,
    label: (
      <span className="inline-flex items-center gap-1.5">
        {key === "all" ? "All" : WORD_STATUS_LABEL[key]}
        <span className="ds-num opacity-60">{counts[key]}</span>
      </span>
    ),
  }));

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="ds-h3">Words</h2>
          <SegmentedControl
            options={options}
            value={filter}
            onChange={setFilter}
            size="sm"
            ariaLabel="Filter words by status"
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            compact
            icon={Filter}
            title={
              words.length === 0
                ? "No words in this set yet"
                : `Nothing in ${filter === "all" ? "this set" : WORD_STATUS_LABEL[filter]}`
            }
            description={
              words.length === 0
                ? "Words appear here once this set has been filled in."
                : "Study a mode and the words will move between New, Learning and Mastered."
            }
          />
        ) : (
          <ul className="flex flex-col">
            {shown.map((w) => (
              <li key={w.id} className="flex items-start gap-4 border-b border-border py-4 first:pt-0 last:border-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="ds-h4">{w.word}</span>
                    {w.part_of_speech ? <span className="ds-overline">{w.part_of_speech}</span> : null}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-foreground">{w.definition}</p>
                  {w.example ? (
                    <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-[13px] italic leading-relaxed text-muted-foreground">
                      &ldquo;{w.example}&rdquo;
                    </p>
                  ) : null}
                  {w.synonyms.length > 0 ? (
                    <p className="mt-2 text-[12px] font-medium text-muted-foreground">
                      <span className="ds-overline mr-1.5">Synonyms</span>
                      {w.synonyms.join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 pt-0.5">
                  <WordStatusPill status={w.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
