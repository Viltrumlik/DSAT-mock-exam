"use client";

import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/components/ui/Icon";
import {
  assessmentsAdminApi,
  type BankPickerRow,
} from "@/features/assessmentsAdmin/api";
import {
  Button,
  Dialog,
  EmptyState,
  SearchField,
  inputShell,
} from "@/features/console/ui";
import { cn } from "@/lib/cn";

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;

/** A filter select in the console shell (sized by its grid cell). */
const FILTER = inputShell({
  className:
    "outline-none disabled:cursor-not-allowed disabled:bg-ms-surface-2 disabled:text-ms-fg-disabled",
});

/**
 * M4 — pick an APPROVED Question Bank question and add it to the current set.
 * APPROVED-only is enforced server-side; the row is frozen on add (content +
 * images copied, bank link recorded). `subject` is the bank subject (MATH/ENGLISH).
 *
 * In the console's dialog (design handoff v0.3, PR 17c): search and the three filters, the rows with the picked
 * one in the primary's tint, Cancel / Add to set. The search waits 300 ms (the console SearchField's own pause).
 */
export function QuestionBankPickerModal({
  open,
  subject,
  onClose,
  onAdd,
  busy,
}: {
  open: boolean;
  subject: string;
  onClose: () => void;
  onAdd: (bankQuestionId: number) => void;
  busy?: boolean;
}) {
  const titleId = useId();
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<string>("");
  const [domainId, setDomainId] = useState<number | "">("");
  const [skillId, setSkillId] = useState<number | "">("");
  const [selected, setSelected] = useState<BankPickerRow | null>(null);

  const taxonomy = useQuery({
    queryKey: ["qbPickerTaxonomy", subject],
    queryFn: () => assessmentsAdminApi.qbTaxonomy(subject),
    enabled: open,
    staleTime: 60_000,
  });

  const select = useQuery({
    queryKey: [
      "qbPickerSelect",
      subject,
      difficulty,
      domainId,
      skillId,
      search,
    ],
    queryFn: () =>
      assessmentsAdminApi.qbSelect({
        subject,
        difficulty: difficulty || undefined,
        domain_id: domainId ? Number(domainId) : undefined,
        skill_id: skillId ? Number(skillId) : undefined,
        search: search || undefined,
        limit: 50,
      }),
    enabled: open,
  });

  const skills = useMemo(
    () =>
      (taxonomy.data?.skills ?? []).filter(
        (s) => !domainId || s.domain === Number(domainId),
      ),
    [taxonomy.data, domainId],
  );
  const rows = select.data?.results ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      width={760}
      locked={busy}
    >
      <div className="flex max-h-[min(85dvh,760px)] flex-col">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ms-border px-[22px] py-4">
          <h2
            id={titleId}
            className="flex items-center gap-2 text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg"
          >
            <Icon name="library" className="text-ms-primary-text" /> Add from
            Question Bank
          </h2>
          <Button
            variant="ghost"
            size="sm"
            icon="x"
            aria-label="Close"
            tooltip={false}
            onClick={onClose}
          />
        </div>

        {/* Filters */}
        <div className="flex shrink-0 flex-col gap-2 border-b border-ms-line px-[22px] py-3">
          <SearchField
            value={search}
            placeholder="Search QB-ID or text…"
            onSearch={setSearch}
          />
          {/* The three filters side by side, each a third of the row. */}
          <div className="grid gap-2 sm:grid-cols-3">
            <select
              aria-label="Domain"
              value={domainId}
              onChange={(e) => {
                setDomainId(e.target.value ? Number(e.target.value) : "");
                setSkillId("");
              }}
              className={cn(FILTER, "w-full min-w-0")}
            >
              <option value="">All domains</option>
              {(taxonomy.data?.domains ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Skill"
              value={skillId}
              disabled={!domainId}
              onChange={(e) =>
                setSkillId(e.target.value ? Number(e.target.value) : "")
              }
              className={cn(FILTER, "w-full min-w-0")}
            >
              <option value="">All skills</option>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Difficulty"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className={cn(FILTER, "w-full min-w-0")}
            >
              <option value="">Any difficulty</option>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d.charAt(0) + d.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Results */}
        <div className="min-h-[200px] flex-1 overflow-y-auto px-3 py-3">
          {select.isLoading ? (
            <div
              aria-busy="true"
              aria-label="Loading…"
              className="flex flex-col gap-1.5"
            >
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-[68px] animate-ms-shimmer rounded-[12px] bg-ms-surface-2"
                />
              ))}
            </div>
          ) : select.error ? (
            <p
              role="alert"
              className="flex items-center justify-center gap-2 py-10 text-[14px] font-medium text-ms-critical-fg"
            >
              <Icon name="alert" size="sm" /> Failed to load bank questions.
            </p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon="search"
              title="No approved questions match these filters."
            />
          ) : (
            <ul
              className="flex flex-col gap-1.5"
              aria-label="Approved bank questions"
            >
              {rows.map((q) => {
                const on = selected?.id === q.id;
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSelected(q)}
                      className={cn(
                        "ms-transition w-full rounded-[12px] border-[1.5px] p-3 text-left",
                        on
                          ? "border-ms-primary bg-ms-primary-soft"
                          : "border-ms-border bg-ms-card hover:bg-ms-surface",
                      )}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="shrink-0 font-ms-mono text-[13px] font-semibold text-ms-primary-text">
                          {q.qb_id}
                        </span>
                        <span className="min-w-0 text-right text-[13px] text-ms-fg-3">
                          {q.domain ?? "—"}
                          {q.skill ? ` › ${q.skill}` : ""} ·{" "}
                          {q.difficulty || "—"}
                        </span>
                      </span>
                      <span className="mt-1 line-clamp-2 block font-ms-serif text-[15px] leading-[22px] text-ms-fg">
                        {q.question_text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-ms-border bg-ms-surface px-5 py-3.5">
          <span className="text-[13px] text-ms-fg-2">
            {selected
              ? `Selected ${selected.qb_id}`
              : "Select a question to add"}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="plus"
              state={busy ? "busy" : "idle"}
              busyLabel="Adding…"
              disabled={!selected || busy}
              onClick={() => selected && onAdd(selected.id)}
            >
              Add to set
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
