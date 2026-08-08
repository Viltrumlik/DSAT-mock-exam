"use client";

import { useCallback, useMemo, useState } from "react";
import { Filter, Highlighter, Type } from "lucide-react";

import { Card, CardContent, EmptyState, SegmentedControl, type Segment } from "@/components/ui";
import { AnnotatableText } from "@/features/annotations/AnnotatableText";
import { useAnnotationSync } from "@/features/annotations/useAnnotationSync";
import { useAnnotator } from "@/features/testing-simulation/tools/highlight/useAnnotator";
import { AnnotationToolbar } from "@/features/testing-simulation/tools/highlight/AnnotationToolbar";

import { WORD_STATUS_LABEL, type VocabWord, type WordFilter } from "../types";
import { WordStatusPill } from "./WordStatusPill";

const FILTER_ORDER: WordFilter[] = ["all", "new", "learning", "mastered"];

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

export function WordList({ words, setId }: { words: VocabWord[]; setId: number }) {
  const [filter, setFilter] = useState<WordFilter>("all");
  // Off by default, and that is not timidity. On a reading page people select text to copy
  // it; auto-highlighting every selection the way the exam runner does would fight the most
  // ordinary thing a student does on this screen.
  const [highlighterActive, setHighlighterActive] = useState(false);

  const counts = useMemo(() => {
    const c: Record<WordFilter, number> = { all: words.length, new: 0, learning: 0, mastered: 0 };
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHighlighterActive((on) => !on)}
              aria-pressed={highlighterActive}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-bold transition-colors ${
                highlighterActive
                  ? "border-amber-400 bg-amber-100 text-amber-900"
                  : "border-border text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <Highlighter className="h-4 w-4" aria-hidden />
              {highlighterActive ? "Highlighting" : "Highlight"}
            </button>
            <SegmentedControl
              options={options}
              value={filter}
              onChange={setFilter}
              size="sm"
              ariaLabel="Filter words by status"
            />
          </div>
        </div>

        {highlighterActive ? (
          <p className="ds-small rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            Select any text on a word to highlight it. Your marks are saved and will be here
            next time.
          </p>
        ) : null}

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
                    {/* AnnotatableText, not a plain text node: the annotator inserts <mark>
                        elements into these, and React must not own children it did not
                        render — see the component's own note. */}
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <AnnotatableText
                        as="span"
                        id={containerElementId(w.id, "word")}
                        className="ds-h4"
                        text={w.word}
                      />
                      {w.part_of_speech ? <span className="ds-overline">{w.part_of_speech}</span> : null}
                    </div>
                    <AnnotatableText
                      id={containerElementId(w.id, "definition")}
                      className="mt-1.5 text-sm leading-relaxed text-foreground"
                      text={w.definition}
                    />
                    {w.example ? (
                      <AnnotatableText
                        id={containerElementId(w.id, "example")}
                        className="mt-2.5 rounded-r-xl border-l-2 border-primary/40 bg-surface-2 px-3 py-2 text-[13px] italic leading-relaxed text-muted-foreground"
                        text={`“${w.example}”`}
                      />
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

      {annotator.toolbar ? (
        <AnnotationToolbar
          toolbar={annotator.toolbar}
          onColor={annotator.applyColor}
          onUnderline={annotator.applyUnderline}
          onDelete={annotator.deleteAnnotation}
          onClose={annotator.dismiss}
        />
      ) : null}
    </Card>
  );
}
