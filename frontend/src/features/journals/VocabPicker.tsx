"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Search } from "lucide-react";
import type { VocabSectionOpt } from "./types";

/**
 * Two-level vocabulary picker: section cards → set cards, mirroring the classroom
 * AssignmentForm's vocab picker. Vocabulary is not subject/level scoped, so the section
 * list can be large — hence the drill-down + search rather than one flat list.
 */
export default function VocabPicker({
  sections,
  selectedIds,
  onToggle,
  inputClassName = "",
  idPrefix = "vocab",
}: {
  sections: VocabSectionOpt[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  inputClassName?: string;
  idPrefix?: string;
}) {
  const [openSectionId, setOpenSectionId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();

  const openSection = useMemo(
    () => sections.find((s) => s.id === openSectionId) || null,
    [sections, openSectionId],
  );

  const filteredSections = useMemo(() => {
    if (!q) return sections;
    return sections.filter(
      (s) => s.title.toLowerCase().includes(q) || s.sets.some((v) => v.title.toLowerCase().includes(q)),
    );
  }, [sections, q]);

  const filteredSets = useMemo(() => {
    if (!openSection) return [];
    if (!q) return openSection.sets;
    return openSection.sets.filter((v) => v.title.toLowerCase().includes(q));
  }, [openSection, q]);

  const pickedIn = (sec: VocabSectionOpt) => sec.sets.filter((v) => selectedIds.has(v.id)).length;

  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground">No published vocabulary sets yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={`${idPrefix}-search`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={openSection ? `Search in ${openSection.title}…` : "Search vocabulary…"}
          className={`${inputClassName} pl-9`}
        />
      </div>

      {openSection === null ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {filteredSections.map((sec) => {
            const picked = pickedIn(sec);
            const words = sec.sets.reduce((n, v) => n + v.word_count, 0);
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => {
                  setOpenSectionId(sec.id);
                  setSearch("");
                }}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">{sec.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {sec.sets.length} sets · {words} words
                  </p>
                </div>
                {picked > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                    {picked} selected
                  </span>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            );
          })}
          {filteredSections.length === 0 && (
            <p className="text-sm text-muted-foreground">No sections match “{search}”.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setOpenSectionId(null);
                setSearch("");
              }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              <ArrowLeft className="h-4 w-4" /> All sections
            </button>
            <span className="text-xs font-semibold text-muted-foreground">
              {pickedIn(openSection)} of {openSection.sets.length} selected
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {filteredSets.map((v) => {
              const on = selectedIds.has(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onToggle(v.id)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                    on ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-surface-2"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                      on ? "border-primary bg-primary text-white" : "border-border"
                    }`}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">{v.title}</p>
                    <p className="text-xs text-muted-foreground">{v.word_count} words</p>
                  </div>
                </button>
              );
            })}
            {filteredSets.length === 0 && (
              <p className="text-sm text-muted-foreground">No sets match “{search}”.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
