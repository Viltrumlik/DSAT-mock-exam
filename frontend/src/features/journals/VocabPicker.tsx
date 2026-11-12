"use client";

import { useMemo, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { VocabSectionOpt } from "./types";

/**
 * Two-level vocabulary picker: section cards → set cards, mirroring the classroom
 * AssignmentForm's vocab picker. Vocabulary is not subject/level scoped, so the section
 * list can be large — hence the drill-down + search rather than one flat list.
 *
 * In the console's look (design handoff v0.3); the search field takes the editor's own control class.
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
    return <p className="text-[14px] text-ms-fg-2">No published vocabulary sets yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Icon name="search" size="sm" className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-ms-fg-3" />
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
                data-vocab-section={sec.id}
                onClick={() => {
                  setOpenSectionId(sec.id);
                  setSearch("");
                }}
                className="ms-transition flex items-center gap-3 rounded-ms-ctl border border-ms-border bg-ms-card px-4 py-3 text-left hover:border-ms-border-strong hover:bg-ms-surface"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-ms-surface-2 text-ms-fg-3">
                  <Icon name="ms-vocab" size="sm" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ms-fg">{sec.title}</p>
                  <p className="text-[13px] text-ms-fg-2">
                    {sec.sets.length} sets · {words} words
                  </p>
                </div>
                {picked > 0 && (
                  <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-ms-primary-soft px-[9px] text-[13px] font-semibold leading-none text-ms-primary-text">
                    {picked} selected
                  </span>
                )}
                <Icon name="right" size="sm" className="text-ms-fg-3" />
              </button>
            );
          })}
          {filteredSections.length === 0 && (
            <p className="text-[14px] text-ms-fg-2">No sections match “{search}”.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setOpenSectionId(null);
                setSearch("");
              }}
              className="ms-transition inline-flex items-center gap-1.5 rounded-[6px] text-[14px] font-semibold text-ms-primary-text hover:underline"
            >
              <Icon name="left" size="sm" /> All sections
            </button>
            <span className="text-[13px] font-medium tabular-nums text-ms-fg-2">
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
                  data-vocab-set={v.id}
                  onClick={() => onToggle(v.id)}
                  className={cn(
                    "ms-transition flex items-center gap-3 rounded-ms-ctl border px-4 py-3 text-left",
                    on ? "border-ms-primary bg-ms-primary-soft" : "border-ms-border bg-ms-card hover:border-ms-border-strong hover:bg-ms-surface",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "ms-transition grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] text-white",
                      on ? "border-ms-primary bg-ms-primary" : "border-ms-border-input bg-ms-card",
                    )}
                  >
                    {on && <Icon name="check" size="sm" className="animate-ms-check-pop size-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-ms-fg">{v.title}</p>
                    <p className="text-[13px] text-ms-fg-2">{v.word_count} words</p>
                  </div>
                </button>
              );
            })}
            {filteredSets.length === 0 && (
              <p className="text-[14px] text-ms-fg-2">No sets match “{search}”.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
