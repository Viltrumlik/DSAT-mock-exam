"use client";

import { useCallback, useMemo, useState } from "react";
import { Filter, Highlighter, Type } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { Tabs, type TabItem } from "@/features/classroom/ui";
import { AnnotatableText } from "@/features/annotations/AnnotatableText";
import { useAnnotationSync } from "@/features/annotations/useAnnotationSync";
import { useAnnotator } from "@/features/testing-simulation/tools/highlight/useAnnotator";
import { AnnotationToolbar } from "@/features/testing-simulation/tools/highlight/AnnotationToolbar";
import { cn } from "@/lib/cn";

import { WORD_STATUS_LABEL, type VocabWord, type WordFilter } from "../types";
import { WordStatusPill } from "./WordStatusPill";

const FILTER_ORDER: WordFilter[] = ["all", "new", "mastered"];

/** Rows enter in sequence, but a 200-word set shouldn't wait 8s for the tail. */
const STAGGER_MS = 40;
const STAGGER_CAP = 12;

/**
 * One annotator serves the whole set rather than one per row: `useAnnotator` binds a
 * document-level listener and repaints on every commit, and a 200-word set would mean 200 of
 * each. The word therefore rides in the **container key** (`w12:definition`) and the target
 * id stays 0 — the set is the unit being annotated, and a row is a region inside it, exactly
 * as a passage and a prompt are regions of one question.
 */
const VOCAB_TARGET_ID = 0;
const containerKey = (wordId: number, region: "word" | "definition" | "example") =>
  `w${wordId}:${region}`;
const containerElementId = (wordId: number, region: string) => `vocab-${wordId}-${region}`;

/**
 * The set's words, with the All / New / Mastered filter.
 *
 * Laid out the way the vocabulary hub is: the heading and the house pill tabs on the page,
 * then each word as its own block of white quartz with continuous corners, instead of one
 * bordered card of bordered rows under a segmented control. The filter, the counts and the
 * highlighter behave exactly as before.
 */
export function WordList({
  words,
  setId,
  iconClassName,
}: {
  words: VocabWord[];
  setId: number;
  /** The glyph tile's tint — the section's colour, so the list belongs to the set above it. */
  iconClassName?: string;
}) {
  const [filter, setFilter] = useState<WordFilter>("all");
  // Off by default, and that is not timidity. On a reading page people select text to copy
  // it; auto-highlighting every selection the way the exam runner does would fight the most
  // ordinary thing a student does on this screen.
  const [highlighterActive, setHighlighterActive] = useState(false);

  const counts = useMemo(() => {
    const c: Record<WordFilter, number> = { all: words.length, new: 0, mastered: 0 };
    for (const w of words) c[w.status] += 1;
    return c;
  }, [words]);

  const shown = useMemo(
    () => (filter === "all" ? words : words.filter((w) => w.status === filter)),
    [words, filter],
  );

  useAnnotationSync("vocab", `vocab-${setId}`);
  // Only the rows currently on screen: a filter hides DOM, and asking for an element that is
  // not there is just a wasted lookup.
  const getContainers = useCallback(
    () =>
      shown.flatMap((w) =>
        (["word", "definition", "example"] as const).map((region) => ({
          key: containerKey(w.id, region),
          el: document.getElementById(containerElementId(w.id, region)),
        })),
      ),
    [shown],
  );
  const annotator = useAnnotator({
    getContainers,
    attemptId: `vocab-${setId}`,
    questionId: VOCAB_TARGET_ID,
    active: highlighterActive,
  });

  const tabs: TabItem[] = FILTER_ORDER.map((key) => ({
    id: key,
    label: key === "all" ? "All" : WORD_STATUS_LABEL[key],
    count: counts[key],
  }));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "squircle flex h-11 w-11 shrink-0 items-center justify-center [--sq:7px]",
              iconClassName ?? "bg-primary-soft text-primary",
            )}
          >
            <Type className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-[20px] font-extrabold tracking-[-0.015em] text-foreground">Words</h2>
            <p className="ds-small mt-0.5">
              <span className="ds-num font-bold text-foreground">{shown.length}</span>
              {filter === "all" ? " in this set" : ` of ${words.length} shown`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setHighlighterActive((on) => !on)}
            aria-pressed={highlighterActive}
            className={cn(
              "ds-ring inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-[inherit] text-[13.5px] font-bold transition-colors",
              highlighterActive
                ? "bg-amber-100 text-amber-900 shadow-[0_6px_14px_-8px_rgba(217,119,6,.8)]"
                : "quartz text-muted-foreground hover:text-foreground",
            )}
          >
            <Highlighter className="h-4 w-4" aria-hidden />
            {highlighterActive ? "Highlighting" : "Highlight"}
          </button>
          <Tabs items={tabs} active={filter} onChange={(id) => setFilter(id as WordFilter)} />
        </div>
      </div>

      {highlighterActive ? (
        <p className="ds-small squircle bg-amber-50 px-4 py-2.5 text-amber-900 [--sq:8px] dark:bg-amber-500/10 dark:text-amber-200">
          Select any text on a word to highlight it. Your marks are saved and will be here
          next time.
        </p>
      ) : null}

      {shown.length === 0 ? (
        <div className="quartz squircle [--sq:13px]">
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
                : "A word is mastered once every game has had it right."
            }
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((w, i) => (
            // Keyed by filter too, so switching buckets replays the entrance
            // rather than silently swapping row contents in place.
            <li
              key={`${filter}-${w.id}`}
              className="quartz squircle cr-rowin p-5 [--sq:11px]"
              style={{ animationDelay: `${Math.min(i, STAGGER_CAP) * STAGGER_MS}ms` }}
            >
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  {/* AnnotatableText, not a plain text node: the annotator inserts <mark>
                      elements into these, and React must not own children it did not
                      render — see the component's own note. */}
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <AnnotatableText
                      as="span"
                      id={containerElementId(w.id, "word")}
                      className="text-[18px] font-extrabold tracking-[-0.01em] text-foreground"
                      text={w.word}
                    />
                    {w.part_of_speech ? <span className="ds-overline">{w.part_of_speech}</span> : null}
                  </div>
                  <AnnotatableText
                    id={containerElementId(w.id, "definition")}
                    className="mt-1.5 text-[14.5px] leading-relaxed text-foreground"
                    text={w.definition}
                  />
                  {w.example ? (
                    <AnnotatableText
                      id={containerElementId(w.id, "example")}
                      className="squircle mt-3 bg-surface-2 px-3.5 py-2.5 text-[13.5px] italic leading-relaxed text-muted-foreground [--sq:7px]"
                      text={`“${w.example}”`}
                    />
                  ) : null}
                  {w.synonyms.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="ds-overline mr-0.5">Synonyms</span>
                      {w.synonyms.map((s, si) => (
                        <span
                          key={`${s}-${si}`}
                          className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold text-muted-foreground"
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

      {annotator.toolbar ? (
        <AnnotationToolbar
          toolbar={annotator.toolbar}
          onColor={annotator.applyColor}
          onUnderline={annotator.applyUnderline}
          onDelete={annotator.deleteAnnotation}
          onClose={annotator.dismiss}
        />
      ) : null}
    </section>
  );
}
