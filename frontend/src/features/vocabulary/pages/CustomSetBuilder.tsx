"use client";

/**
 * /vocabulary/new-set — build a custom set out of bank words.
 *
 * `?set=<id>` switches the same screen into edit mode for one of the student's
 * own sets: the PATCH replaces membership wholesale, which is exactly what the
 * tray already holds, so create and edit share every control.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Library, ListChecks, Plus, Search, Sparkles, Trash2, X } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Field,
  IconButton,
  Input,
  Progress,
  Select,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useDebounce } from "@/hooks/useDebounce";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import { VocabErrorState, vocabErrorMessage } from "../components/VocabStates";
import { useCreateMySet, useUpdateMySet, useVocabSections, useVocabSet, useWordSearch } from "../hooks";

/** Mirrors `VocabSet.TARGET_WORD_COUNT` — a guide on the tray, never a hard cap. */
const TARGET_WORD_COUNT = 25;

const JAKARTA = "var(--font-plus-jakarta), system-ui, sans-serif";

/** Rows enter in sequence; the tail of a long result list shouldn't crawl in. */
const STAGGER_MS = 40;
const STAGGER_CAP = 12;

/** The tray has to render words that arrived from two shapes (search hit / set word). */
type SelectedWord = {
  id: number;
  word: string;
  definition: string;
  part_of_speech: string;
};

export function CustomSetBuilder() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();

  const rawSetId = Number(params.get("set"));
  const editingId = Number.isFinite(rawSetId) && rawSetId > 0 ? rawSetId : null;
  const existing = useVocabSet(editingId ?? 0);

  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedWord[]>([]);

  const [rawQuery, setRawQuery] = useState("");
  const query = useDebounce(rawQuery.trim(), 250);
  const [sectionFilter, setSectionFilter] = useState<number | undefined>(undefined);

  const sections = useVocabSections();
  const results = useWordSearch(query, sectionFilter);

  const create = useCreateMySet();
  const update = useUpdateMySet(editingId ?? 0);
  const saving = create.isPending || update.isPending;

  // Seed once per loaded set: re-seeding on every render of `existing.data`
  // would stomp the student's edits after any background refetch.
  const seededFor = useRef<number | null>(null);
  useEffect(() => {
    const set = existing.data;
    if (!editingId || !set || seededFor.current === set.id) return;
    seededFor.current = set.id;
    setTitle(set.title);
    setSelected(
      set.words.map((w) => ({
        id: w.id,
        word: w.word,
        definition: w.definition,
        part_of_speech: w.part_of_speech,
      })),
    );
  }, [editingId, existing.data]);

  const selectedIds = useMemo(() => new Set(selected.map((w) => w.id)), [selected]);

  function addWord(w: SelectedWord) {
    setSelected((prev) => (prev.some((s) => s.id === w.id) ? prev : [...prev, w]));
  }

  function removeWord(id: number) {
    setSelected((prev) => prev.filter((s) => s.id !== id));
  }

  async function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError("Give your set a name.");
      return;
    }
    if (selected.length === 0) {
      toast.push({ tone: "error", message: "Add at least one word before saving." });
      return;
    }
    setTitleError(null);

    const word_ids = selected.map((w) => w.id);
    try {
      if (editingId) {
        await update.mutateAsync({ title: trimmed, word_ids });
        toast.push({ tone: "success", message: "Set updated." });
        router.push(`/vocabulary/sets/${editingId}`);
      } else {
        const created = await create.mutateAsync({ title: trimmed, word_ids });
        toast.push({ tone: "success", message: `“${created.title}” is ready to study.` });
        router.push(`/vocabulary/sets/${created.id}`);
      }
    } catch (e) {
      toast.push({ tone: "error", message: vocabErrorMessage(e) });
    }
  }

  // `sets/<id>/` only serves a custom set to its owner, so 403/404 means "not
  // yours to edit" — a dead end, not something a retry button can fix. Anything
  // else is a transport failure and does get a retry.
  const loadStatus = editingId && existing.isError ? normalizeApiError(existing.error).status : null;
  const notEditable =
    Boolean(editingId) && (loadStatus === 403 || loadStatus === 404 || (existing.data ? !existing.data.is_custom : false));

  if (notEditable) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12" style={{ fontFamily: JAKARTA }}>
        <BackLink />
        <EmptyState
          icon={Sparkles}
          title="That set can't be edited"
          description="Only sets you built yourself can be changed. Start a fresh one and pick the words you want."
          action={
            <Link href="/vocabulary/new-set" className="ds-ring rounded-xl">
              <Button className="cr-press" tabIndex={-1}>
                Build a new set
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (editingId && existing.isError) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12" style={{ fontFamily: JAKARTA }}>
        <BackLink />
        <VocabErrorState title="Couldn't open that set" onRetry={() => void existing.refetch()} />
      </div>
    );
  }

  const hits = results.data ?? [];
  const pct = Math.min(100, Math.round((selected.length / TARGET_WORD_COUNT) * 100));
  const remaining = TARGET_WORD_COUNT - selected.length;
  const trayHint =
    selected.length === 0
      ? `Aim for about ${TARGET_WORD_COUNT} — that's one full set.`
      : remaining > 0
        ? `${remaining} more to hit a full set.`
        : "Full set — add more if you want a longer drill.";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12" style={{ fontFamily: JAKARTA }}>
      <BackLink />

      <header className="cr-section">
        <p className="ds-overline text-primary">My sets</p>
        <h1 className="ds-display mt-1">{editingId ? "Edit set" : "Build a set"}</h1>
        <p className="ds-lead mt-1.5 max-w-xl">
          Search the question bank, add the words you want to drill, and study them with all four modes.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Bank search ─────────────────────────────────────────────── */}
        <Card className="cr-cardrise">
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <Library className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="ds-h3">Word bank</h2>
                <p className="ds-small mt-0.5">
                  {query.length === 0 || results.isLoading || results.isError ? (
                    "Every published section, searchable by word or definition."
                  ) : (
                    <>
                      <span className="ds-num font-bold text-foreground">{hits.length}</span>
                      {hits.length === 1 ? " match for " : " matches for "}
                      <span className="font-bold text-foreground">“{query}”</span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={rawQuery}
                onChange={(e) => setRawQuery(e.target.value)}
                placeholder="Search words or definitions…"
                aria-label="Search the vocabulary bank"
                leftIcon={<Search />}
                rightSlot={
                  rawQuery ? (
                    <button
                      type="button"
                      onClick={() => setRawQuery("")}
                      aria-label="Clear search"
                      className="ds-ring rounded-md p-0.5 hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : undefined
                }
              />
              <Select
                value={sectionFilter === undefined ? "" : String(sectionFilter)}
                onChange={(e) => setSectionFilter(e.target.value ? Number(e.target.value) : undefined)}
                aria-label="Filter by section"
                className="sm:max-w-[220px]"
              >
                <option value="">All sections</option>
                {(sections.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </Select>
            </div>

            {query.length === 0 ? (
              <EmptyState
                compact
                icon={Search}
                title="Search the word bank"
                description="Type a word or part of a definition to pull matches from every published section."
              />
            ) : results.isLoading ? (
              <div className="flex flex-col gap-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : results.isError ? (
              <VocabErrorState
                title="Search failed"
                description="The word bank didn't answer. Try that search again."
                onRetry={() => void results.refetch()}
              />
            ) : hits.length === 0 ? (
              <EmptyState
                compact
                icon={Search}
                title={`No matches for “${query}”`}
                description="Try a shorter search, or clear the section filter to look across the whole bank."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {hits.map((w, i) => {
                  const added = selectedIds.has(w.id);
                  return (
                    <li
                      key={w.id}
                      className={cn(
                        "cr-rowin flex items-start gap-3 rounded-xl border p-3 transition-colors",
                        added
                          ? "border-primary/30 bg-primary-soft"
                          : "border-border bg-surface-1 hover:border-border-strong",
                      )}
                      style={{ animationDelay: `${Math.min(i, STAGGER_CAP) * STAGGER_MS}ms` }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-bold text-foreground">{w.word}</span>
                          {w.part_of_speech ? <span className="ds-overline">{w.part_of_speech}</span> : null}
                          <Badge variant="outline">{w.section_title}</Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{w.definition}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={added ? "subtle" : "secondary"}
                        className={added ? undefined : "cr-press"}
                        leftIcon={added ? <Check /> : <Plus />}
                        disabled={added}
                        onClick={() =>
                          addWord({
                            id: w.id,
                            word: w.word,
                            definition: w.definition,
                            part_of_speech: w.part_of_speech,
                          })
                        }
                      >
                        {added ? "Added" : "Add"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Tray ────────────────────────────────────────────────────── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card className="cr-cardrise">
            <CardContent className="flex flex-col gap-4">
              <Field label="Set name" htmlFor="vocab-set-title" required error={titleError}>
                <Input
                  id="vocab-set-title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (titleError) setTitleError(null);
                  }}
                  placeholder="Words I keep missing"
                  invalid={Boolean(titleError)}
                  maxLength={200}
                />
              </Field>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <ListChecks className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <span className="ds-h4">Selected</span>
                    <p className="ds-num text-[13px] font-bold text-muted-foreground">
                      {selected.length} / {TARGET_WORD_COUNT}
                    </p>
                  </div>
                </div>
                {selected.length > 0 ? (
                  <Button variant="ghost" size="sm" leftIcon={<Trash2 />} onClick={() => setSelected([])}>
                    Clear
                  </Button>
                ) : null}
              </div>

              {editingId && existing.isLoading ? (
                <div className="flex flex-col gap-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-11 rounded-xl" />
                  ))}
                </div>
              ) : selected.length === 0 ? (
                <EmptyState compact icon={Sparkles} title="No words yet" description={trayHint} />
              ) : (
                <ul className="flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto pr-1">
                  {selected.map((w, i) => (
                    <li
                      key={w.id}
                      className="cr-rowin flex items-center gap-2 rounded-xl bg-surface-2 py-2 pl-3 pr-2 transition-colors hover:bg-surface-3"
                      style={{ animationDelay: `${Math.min(i, STAGGER_CAP) * STAGGER_MS}ms` }}
                    >
                      <span className="ds-num w-6 shrink-0 text-[12px] font-bold text-label-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{w.word}</span>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${w.word}`}
                        onClick={() => removeWord(w.id)}
                        className="text-muted-foreground hover:text-danger"
                      >
                        <X className="h-4 w-4" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Sticky save bar — running count against the 25-word target ─ */}
      <div className="sticky bottom-4 z-20">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-border bg-card/95 p-3.5 shadow-pop backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <ListChecks className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="ds-num text-[22px] font-extrabold leading-none text-foreground">{selected.length}</span>
                <span className="ds-num text-[13px] font-bold text-muted-foreground">/ {TARGET_WORD_COUNT} words</span>
              </div>
              <p className="ds-small mt-1 truncate">{trayHint}</p>
            </div>
          </div>

          <div className="min-w-[140px] flex-1">
            <Progress
              value={pct}
              size="sm"
              tone={selected.length >= TARGET_WORD_COUNT ? "success" : "primary"}
              label={`${selected.length} of ${TARGET_WORD_COUNT} words selected`}
            />
          </div>

          <Button
            className="cr-press"
            loading={saving}
            disabled={selected.length === 0}
            onClick={() => void save()}
          >
            {editingId ? "Save changes" : "Create set"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/vocabulary"
      className="ds-ring inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Back to vocabulary
    </Link>
  );
}
