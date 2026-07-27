"use client";

import { useMemo, useState } from "react";
import { Filter, Type } from "lucide-react";

import { Card, CardContent, EmptyState, SegmentedControl, type Segment } from "@/components/ui";

import { WORD_STATUS_LABEL, type VocabWord, type WordFilter } from "../types";
import { WordStatusPill } from "./WordStatusPill";

const FILTER_ORDER: WordFilter[] = ["all", "new", "learning", "mastered"];

/** Rows enter in sequence, but a 200-word set shouldn't wait 8s for the tail. */
const STAGGER_MS = 40;
const STAGGER_CAP = 12;

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
        <span className="ds-num rounded-full bg-surface-3 px-1.5 py-px text-[11px] font-bold text-muted-foreground">
          {counts[key]}
        </span>
      </span>
    ),
  }));

  return (
    <Card className="cr-cardrise">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Type className="h-5 w-5" />
            </span>
            <div>
              <h2 className="ds-h3">Words</h2>
              <p className="ds-small mt-0.5">
                <span className="ds-num font-bold text-foreground">{shown.length}</span>
                {filter === "all" ? " in this set" : ` of ${words.length} shown`}
              </p>
            </div>
          </div>
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
          <ul className="flex flex-col gap-2">
            {shown.map((w, i) => (
              // Keyed by filter too, so switching buckets replays the entrance
              // rather than silently swapping row contents in place.
              <li
                key={`${filter}-${w.id}`}
                className="cr-rowin rounded-2xl border border-border bg-surface-1 p-4 transition-colors hover:border-border-strong"
                style={{ animationDelay: `${Math.min(i, STAGGER_CAP) * STAGGER_MS}ms` }}
              >
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className="ds-h4">{w.word}</span>
                      {w.part_of_speech ? <span className="ds-overline">{w.part_of_speech}</span> : null}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-foreground">{w.definition}</p>
                    {w.example ? (
                      <p className="mt-2.5 rounded-r-xl border-l-2 border-primary/40 bg-surface-2 px-3 py-2 text-[13px] italic leading-relaxed text-muted-foreground">
                        &ldquo;{w.example}&rdquo;
                      </p>
                    ) : null}
                    {w.synonyms.length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <span className="ds-overline mr-0.5">Synonyms</span>
                        {w.synonyms.map((s, si) => (
                          <span
                            key={`${s}-${si}`}
                            className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-muted-foreground"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <WordStatusPill status={w.status} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
