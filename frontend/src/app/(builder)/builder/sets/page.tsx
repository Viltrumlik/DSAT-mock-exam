"use client";

/**
 * /builder/sets — Assessments: subject → level → the sets in that bucket.
 *
 * In the console's look (design handoff v0.3, PR 17a), the Builder library's header, chips, badges and dialogs:
 * the words, the drill-down and every action (review status, Import CSV, delete with the 409 force delete) are
 * the page's own.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ToastProvider";
import { useAssessmentSetsList, useDeleteAssessmentSet, useSetReviewStatus } from "@/features/assessments/hooks";
import { REVIEW_STATUS_LABELS, type AssessmentSet, type ReviewStatus, type Subject } from "@/features/assessments/types";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import { FIELD, FIELD_HINT, FIELD_LABEL, LibraryError, LibraryHeader } from "@/features/builderLibrary/sectionParts";
import {
  Badge,
  Button,
  ChipCount,
  ConfirmDialog,
  Dialog,
  EmptyState,
  SearchField,
  Select,
  StatTile,
  buttonClass,
  chipClass,
  type BadgeTone,
} from "@/features/console/ui";
import { normalizeApiError } from "@/lib/apiError";
import { allowedSourcesForSubject, sourceLabel } from "@/lib/assessmentSources";
import { cn } from "@/lib/cn";
import { levelLabel, levelsForSubject, setHasLevel, setLevelsLabel, type LevelKey } from "@/lib/levels";
import { getRole, getSubject } from "@/lib/permissions";

type SubjectKey = "english" | "math";
const SUBJECTS: { code: SubjectKey; label: string }[] = [
  { code: "english", label: "English" },
  { code: "math", label: "Math" },
];
// Sentinel for the "Unassigned" bucket (legacy sets with a blank level).
const UNASSIGNED_LEVEL = "__unassigned__";

const REVIEW_STATUS_TONE: Record<ReviewStatus, BadgeTone> = {
  draft: "neutral",
  needs_review: "attention",
  approved: "positive",
};

const REVIEW_STATUS_ORDER: ReviewStatus[] = ["draft", "needs_review", "approved"];

type VisibilityFilter = "all" | "active" | "inactive";

const subjectName = (code: string | null | undefined) => SUBJECTS.find((s) => s.code === code)?.label ?? code ?? "";

/** The delete hook rethrows the normalized error; anything else (an axios error) is normalized here. */
function apiErrorOf(e: unknown): { status: number; message: string } {
  const r = e as { response?: unknown; status?: unknown; message?: unknown } | null;
  if (r && typeof r === "object" && !r.response && typeof r.status === "number") {
    return { status: r.status, message: typeof r.message === "string" ? r.message : "" };
  }
  return normalizeApiError(e);
}

export default function BuilderSetsPage() {
  // Backend already enforces teacher subject scoping.
  // For global staff (admin/test_admin/super_admin), default to "all subjects".
  const role = getRole();
  const scopedSubject = (role === "teacher" ? getSubject() : null) as SubjectKey | null;
  const canApprove = role === "admin" || role === "super_admin" || role === "test_auditor";
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<VisibilityFilter>("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | ReviewStatus>("all");
  // Drill-down: subject (English/Math) → level → the sets in that bucket. A scoped teacher
  // has one subject, so step 1 is pre-selected and skipped. New sets inherit this context.
  const [selectedSubject, setSelectedSubject] = useState<SubjectKey | null>(scopedSubject);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const setStatus = useSetReviewStatus();
  const toast = useToast();
  const router = useRouter();

  // Create a new set directly from a CSV of questions (subject+level from the bucket).
  const csvId = useId();
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvTitle, setCsvTitle] = useState("");
  const [csvSource, setCsvSource] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const csvFileRef = useRef<HTMLInputElement>(null);

  const changeStatus = (id: number, status: ReviewStatus) => {
    setStatus.mutate(
      { id, status },
      {
        onSuccess: () =>
          toast.push({ message: `Status set to “${REVIEW_STATUS_LABELS[status]}”.`, tone: "success" }),
        onError: (e: unknown) => {
          // Surface the specific approval blockers (e.g. "must have a category") rather
          // than a bare "400". The backend puts the reasons in detail; findings[] carries
          // the per-issue breakdown when detail is generic.
          const resp = (e as { response?: { data?: { detail?: string; findings?: { message?: string }[] } } })?.response?.data;
          const findingMsgs = (resp?.findings ?? []).map((f) => f?.message).filter(Boolean).join("; ");
          const msg =
            resp?.detail ||
            (findingMsgs ? `Cannot approve — fix these first: ${findingMsgs}` : null) ||
            (e as { message?: string })?.message ||
            "Could not change status.";
          toast.push({ message: msg, tone: "error" });
        },
      },
    );
  };

  // Delete: the confirm dialog asks; a 409 (the set is published/assigned) reveals the force
  // delete, which removes it along with student attempts & grades. The target outlives the
  // dialog so its words stay while it leaves.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const [forceError, setForceError] = useState<string | null>(null);
  const [forcing, setForcing] = useState(false);
  const deleteSet = useDeleteAssessmentSet();

  const { data, isLoading, error, refetch } = useAssessmentSetsList(
    scopedSubject ? { subject: scopedSubject } : undefined,
  );

  const askDelete = (s: { id: number; title: string }) => {
    setDeleteTarget(s);
    setDeleteBlocked(false);
    setForceError(null);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSet.mutateAsync({ setId: deleteTarget.id, force: false });
    } catch (e) {
      const err = apiErrorOf(e);
      if (err.status === 409) setDeleteBlocked(true);
      throw new Error(err.message || "Could not delete this set.");
    }
  };

  const forceDelete = async () => {
    if (!deleteTarget) return;
    setForceError(null);
    setForcing(true);
    try {
      await deleteSet.mutateAsync({ setId: deleteTarget.id, force: true });
      setDeleteOpen(false);
    } catch (e) {
      setForceError(apiErrorOf(e).message || "Could not delete this set.");
    } finally {
      setForcing(false);
    }
  };

  const openCsv = () => {
    setCsvTitle("");
    setCsvSource("");
    if (csvFileRef.current) csvFileRef.current.value = "";
    setCsvOpen(true);
  };

  const submitCsvImport = async () => {
    const file = csvFileRef.current?.files?.[0];
    if (!selectedSubject || !csvTitle.trim() || !csvSource || !file) return;
    setCsvBusy(true);
    try {
      const res = await assessmentsAdminApi.importSetCsv(
        {
          subject: selectedSubject as Subject,
          source: csvSource,
          level: selectedLevel && selectedLevel !== UNASSIGNED_LEVEL ? selectedLevel : undefined,
          title: csvTitle.trim(),
        },
        file,
      );
      toast.push({ tone: "success", message: `Created “${csvTitle.trim()}” with ${res.created_count} question${res.created_count === 1 ? "" : "s"}.` });
      router.push(`/builder/sets/${res.id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string; errors?: { row: number }[] } } };
      const data = err?.response?.data;
      const msg = data?.errors?.length
        ? `${data.detail ?? "Some rows are invalid."} (row ${data.errors[0].row})`
        : data?.detail || "Could not import the CSV.";
      toast.push({ tone: "error", message: msg });
    } finally {
      setCsvBusy(false);
    }
  };

  const sets = useMemo(() => data?.results ?? (Array.isArray(data) ? data : []), [data]);

  // Drill-down slices + counts.
  const countForSubject = (code: SubjectKey) => sets.filter((s) => s.subject === code).length;
  const subjectSets = useMemo(
    () => (selectedSubject ? sets.filter((s) => s.subject === selectedSubject) : []),
    [sets, selectedSubject],
  );
  // A set with an optional second level (2026-10-11, the school's request) sits in BOTH
  // level buckets — the same "either level" rule the server applies to classrooms and
  // journals — so a Junior+Middle set is counted, and listed, under Junior and Middle.
  // "Unassigned" stays primary-only: a set with no primary has no second level either.
  const countForLevel = (lv: string) =>
    subjectSets.filter((s) => (lv === UNASSIGNED_LEVEL ? !s.level : setHasLevel(s, lv))).length;
  const hasUnassigned = subjectSets.some((s) => !s.level);

  // The sets of the level bucket, before the search and the chips.
  const bucketSets = useMemo(() => {
    if (selectedLevel === UNASSIGNED_LEVEL) return subjectSets.filter((s) => !s.level);
    if (selectedLevel) return subjectSets.filter((s) => setHasLevel(s, selectedLevel));
    return subjectSets;
  }, [subjectSets, selectedLevel]);

  const filtered = useMemo(() => {
    let result = bucketSets;
    const term = search.trim().toLowerCase();
    if (term.length >= 1) {
      result = result.filter(
        (s) => `${s.title} ${s.category} ${s.description}`.toLowerCase().includes(term),
      );
    }
    if (statusFilter === "active") result = result.filter((s) => s.is_active);
    if (statusFilter === "inactive") result = result.filter((s) => !s.is_active);
    if (reviewFilter !== "all")
      result = result.filter((s) => (s.review_status ?? "draft") === reviewFilter);
    return result;
  }, [bucketSets, search, statusFilter, reviewFilter]);

  const reviewCount = (rs: ReviewStatus) => bucketSets.filter((s) => (s.review_status ?? "draft") === rs).length;
  const activeInBucket = bucketSets.filter((s) => s.is_active).length;

  const activeCount = sets.filter((s) => s.is_active).length;
  const draftCount = sets.filter((s) => !s.is_active).length;
  const canCreate = Boolean(selectedSubject && selectedLevel);
  const selectedLevelLabel =
    selectedLevel === UNASSIGNED_LEVEL ? "Unassigned" : selectedLevel ? levelLabel(selectedLevel) : "";
  // New-set link carries the current bucket so the create form can prefill + lock it.
  const newSetHref =
    selectedSubject && selectedLevel
      ? `/builder/sets/new?subject=${selectedSubject}${selectedLevel !== UNASSIGNED_LEVEL ? `&level=${selectedLevel}` : ""}`
      : "/builder/sets/new";

  const newSetLink = (
    <Link href={newSetHref} className={buttonClass({ variant: "primary" })}>
      <Icon name="plus" size="sm" />
      New set
    </Link>
  );

  return (
    <div className="flex flex-col gap-5">
      <LibraryHeader
        eyebrow="Learning"
        title="Assessments"
        description="Assessment sets group reusable questions into a deliverable unit. Approve a set to make it assignable to classrooms."
        actions={
          <>
            <Button variant="secondary" icon="refresh" onClick={() => void refetch()}>
              Refresh
            </Button>
            <Link href="/builder/bank" className={buttonClass({ variant: "secondary" })}>
              Question Bank
            </Link>
            {canCreate && (
              <Button variant="secondary" icon="upload" onClick={openCsv}>
                Import CSV
              </Button>
            )}
            {canCreate && newSetLink}
          </>
        }
      />

      {/* Breadcrumb — subject → level drill-down */}
      <nav aria-label="Subject and level" className="animate-ms-fade-in flex flex-wrap items-center gap-1 text-[14px]">
        {scopedSubject ? (
          <Crumb current={!selectedLevel} onClick={() => setSelectedLevel(null)}>
            {subjectName(scopedSubject)}
          </Crumb>
        ) : (
          <Crumb
            current={!selectedSubject}
            onClick={() => {
              setSelectedSubject(null);
              setSelectedLevel(null);
            }}
          >
            All subjects
          </Crumb>
        )}
        {selectedSubject && !scopedSubject && (
          <>
            <Icon name="right" size="sm" className="text-ms-fg-3" />
            <Crumb current={!selectedLevel} onClick={() => setSelectedLevel(null)}>
              {subjectName(selectedSubject)}
            </Crumb>
          </>
        )}
        {selectedSubject && selectedLevel && (
          <>
            <Icon name="right" size="sm" className="text-ms-fg-3" />
            <Crumb current>{selectedLevelLabel}</Crumb>
          </>
        )}
      </nav>

      {/* Stats */}
      {!isLoading && sets.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Total" value={sets.length} />
          <StatTile label="Active" value={activeCount} tone="positive" delay={40} />
          <StatTile label="Draft" value={draftCount} delay={80} />
        </div>
      )}

      {/* Search + filter — only in the set list (subject & level are the drill-down) */}
      {canCreate && (
        <div className="flex flex-col gap-3">
          <SearchField value={search} placeholder="Search sets…" onSearch={setSearch} className="max-w-[640px]" />
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <ChipGroup
              label="Review status"
              value={reviewFilter}
              onChange={setReviewFilter}
              options={[
                { v: "all", l: "All review statuses", n: bucketSets.length },
                ...REVIEW_STATUS_ORDER.map((rs) => ({ v: rs, l: REVIEW_STATUS_LABELS[rs], n: reviewCount(rs) })),
              ]}
            />
            <ChipGroup
              label="Visibility"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { v: "all", l: "All visibility", n: bucketSets.length },
                { v: "active", l: "Active only", n: activeInBucket },
                { v: "inactive", l: "Archived only", n: bucketSets.length - activeInBucket },
              ]}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error ? (
        <LibraryError>
          <span className="flex flex-wrap items-center justify-between gap-2">
            {String((error as { message?: string })?.message || error)}
            <Button variant="ghost" size="sm" onClick={() => void refetch()} className="-my-1 text-ms-primary-text">
              Retry
            </Button>
          </span>
        </LibraryError>
      ) : null}

      {/* Content — drill-down: subject → level → sets */}
      {isLoading ? (
        <div aria-busy="true" aria-label="Loading" className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-[100px] animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
          ))}
        </div>
      ) : error && sets.length === 0 ? null : selectedSubject === null ? (
        /* Step 1 — choose a subject */
        <div className="grid gap-4 sm:grid-cols-2">
          {SUBJECTS.map((s, i) => {
            const n = countForSubject(s.code);
            const math = s.code === "math";
            return (
              <BucketCard
                key={s.code}
                delay={i * 40}
                big
                onClick={() => {
                  setSelectedSubject(s.code);
                  setSelectedLevel(null);
                }}
                lead={
                  <span className={cn("grid size-12 shrink-0 place-items-center rounded-[14px]", math ? "bg-ms-math-soft text-ms-math-fg" : "bg-ms-rw-soft text-ms-rw-fg")}>
                    <Icon name={math ? "sigma" : "book"} />
                  </span>
                }
                title={s.label}
                sub={`${n} set${n !== 1 ? "s" : ""}`}
              />
            );
          })}
        </div>
      ) : selectedLevel === null ? (
        /* Step 2 — choose a level */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {levelsForSubject(selectedSubject).map((code: LevelKey, i) => {
            const n = countForLevel(code);
            return (
              <BucketCard
                key={code}
                delay={i * 40}
                onClick={() => setSelectedLevel(code)}
                lead={<span aria-hidden="true" className={cn("h-9 w-1 shrink-0 rounded-full", selectedSubject === "math" ? "bg-ms-math-fg" : "bg-ms-rw-fg")} />}
                title={levelLabel(code)}
                sub={`${n} set${n !== 1 ? "s" : ""}`}
              />
            );
          })}
          {hasUnassigned && (
            <BucketCard
              dashed
              delay={levelsForSubject(selectedSubject).length * 40}
              onClick={() => setSelectedLevel(UNASSIGNED_LEVEL)}
              title="Unassigned"
              sub={`${countForLevel(UNASSIGNED_LEVEL)} without a level`}
            />
          )}
        </div>
      ) : (
        /* Step 3 — sets in this subject+level */
        <section aria-label="Sets" className="animate-ms-fade-in rounded-ms-card bg-ms-card shadow-ms-1">
          <div className="border-b border-ms-line px-5 py-3.5 text-[15px] font-semibold text-ms-fg">
            {`${filtered.length} set${filtered.length === 1 ? "" : "s"}`}
          </div>

          {filtered.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="layers"
                title={
                  subjectSets.length === 0 || countForLevel(selectedLevel) === 0
                    ? `No sets in ${subjectName(selectedSubject)} · ${selectedLevelLabel} yet.`
                    : "No sets match your filters."
                }
                action={newSetLink}
              />
            </div>
          ) : (
            <ul className="divide-y divide-ms-line">
              {filtered.map((s, i) => (
                <SetRow
                  key={s.id}
                  set={s}
                  delay={Math.min(i, 8) * 30}
                  showCreator={role === "super_admin"}
                  canApprove={canApprove}
                  statusBusy={setStatus.isPending}
                  onStatus={(rs) => changeStatus(s.id, rs)}
                  onDelete={() => askDelete({ id: s.id, title: s.title })}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={csvOpen && Boolean(selectedSubject)} onClose={() => setCsvOpen(false)} labelledBy={csvId} width={480} locked={csvBusy}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCsvImport();
          }}
        >
          <div className="flex flex-col gap-4 px-[22px] pb-2 pt-[22px]">
            <div>
              <h2 id={csvId} className="text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
                Import set from CSV
              </h2>
              <p className="mt-1 text-[14px] text-ms-fg-2">
                {subjectName(selectedSubject)}
                {selectedLevelLabel ? ` · ${selectedLevelLabel}` : ""} — one question per row.
              </p>
            </div>
            <div>
              <label htmlFor={`${csvId}-title`} className={FIELD_LABEL}>
                Title
              </label>
              <input
                id={`${csvId}-title`}
                data-autofocus
                value={csvTitle}
                onChange={(e) => setCsvTitle(e.target.value)}
                placeholder="e.g. Algebra — Unit 1"
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor={`${csvId}-source`} className={FIELD_LABEL}>
                Source
              </label>
              <select id={`${csvId}-source`} value={csvSource} onChange={(e) => setCsvSource(e.target.value)} className={FIELD}>
                <option value="">Select a source…</option>
                {selectedSubject
                  ? allowedSourcesForSubject(selectedSubject as Subject, [selectedLevel === UNASSIGNED_LEVEL ? "" : selectedLevel]).map((s) => (
                      <option key={s} value={s}>
                        {sourceLabel(s)}
                      </option>
                    ))
                  : null}
              </select>
            </div>
            <div>
              <label htmlFor={`${csvId}-file`} className={FIELD_LABEL}>
                CSV file
              </label>
              <input
                id={`${csvId}-file`}
                ref={csvFileRef}
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-[14px] text-ms-fg-2 file:mr-3 file:h-9 file:cursor-pointer file:rounded-[10px] file:border-0 file:bg-ms-primary-soft file:px-3 file:text-[14px] file:font-semibold file:text-ms-primary-text"
              />
              <p className={FIELD_HINT}>Columns: question_type, prompt, option_a–d, correct_answer, points, explanation.</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-ms-border bg-ms-surface px-5 py-3.5">
            <Button variant="secondary" onClick={() => setCsvOpen(false)} disabled={csvBusy}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon="upload"
              state={csvBusy ? "busy" : "idle"}
              busyLabel="Importing…"
              disabled={csvBusy || !csvTitle.trim() || !csvSource}
            >
              Import
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        tone="critical"
        icon="trash"
        title="Delete assessment set?"
        confirmLabel="Delete set"
        busyLabel="Deleting…"
        onConfirm={confirmDelete}
        afterError={
          deleteBlocked ? (
            <div className="animate-ms-fade-in rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft p-3.5">
              <p className="text-[14px] font-semibold text-ms-critical-fg">Force delete?</p>
              <p className="mt-1 text-[13px] leading-[19px] text-ms-critical-fg">
                This permanently deletes the set together with every student attempt, grade, and
                result on it, and removes it from any classroom homework. This can’t be undone.
              </p>
              {forceError ? (
                <p role="alert" className="mt-2 text-[13px] font-semibold text-ms-critical-fg">
                  {forceError}
                </p>
              ) : null}
              <Button
                variant="danger"
                size="sm"
                icon="trash"
                className="mt-2.5"
                state={forcing ? "busy" : "idle"}
                busyLabel="Deleting…"
                onClick={() => void forceDelete()}
              >
                Force delete (removes attempts & grades)
              </Button>
            </div>
          ) : null
        }
      >
        {deleteTarget ? `“#${deleteTarget.id} · ${deleteTarget.title}” and its draft questions will be permanently removed.` : null}
      </ConfirmDialog>
    </div>
  );
}

/** One step of "All subjects › Math › Junior": the earlier steps go back, the last one is where you are. */
function Crumb({ current, onClick, children }: { current: boolean; onClick?: () => void; children: ReactNode }) {
  return current && !onClick ? (
    <span aria-current="page" className="rounded-[8px] px-2 py-1 font-semibold text-ms-fg">
      {children}
    </span>
  ) : (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      className={cn(
        "ms-transition rounded-[8px] px-2 py-1 font-semibold hover:bg-ms-surface-2",
        current ? "text-ms-fg" : "text-ms-primary-text",
      )}
    >
      {children}
    </button>
  );
}

/** A subject or a level to open: its name and how many sets are in it. */
function BucketCard({
  lead,
  title,
  sub,
  big = false,
  dashed = false,
  delay = 0,
  onClick,
}: {
  lead?: ReactNode;
  title: string;
  sub: string;
  big?: boolean;
  dashed?: boolean;
  delay?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "group animate-ms-card-in ms-hover-lift ms-press flex items-center justify-between gap-4 rounded-ms-card text-left",
        big ? "p-6" : "p-5",
        dashed ? "border border-dashed border-ms-border-strong bg-transparent" : "bg-ms-card shadow-ms-1",
      )}
    >
      <span className="flex min-w-0 items-center gap-4">
        {lead}
        <span className="min-w-0">
          <span className={cn("block font-bold text-ms-fg", big ? "text-[18px] leading-6" : "text-[16px] leading-[22px]")}>{title}</span>
          <span className="mt-0.5 block text-[14px] text-ms-fg-2">{sub}</span>
        </span>
      </span>
      <Icon name="right" className="shrink-0 text-ms-fg-3 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

/** A filter as chips with their counts in this level. */
function ChipGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { v: T; l: string; n: number }[];
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={chipClass(value === o.v, o.n === 0 && o.v !== "all")}
        >
          {o.l}
          <ChipCount n={o.n} on={value === o.v} />
        </button>
      ))}
    </div>
  );
}

/** The set's subject in the Builder's colours: English (R&W) rose, Math violet. */
function SubjectTag({ subject }: { subject: string }) {
  const math = subject === "math";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-[9px] text-[13px] font-semibold leading-none",
        math ? "bg-ms-math-soft text-ms-math-fg" : "bg-ms-rw-soft text-ms-rw-fg",
      )}
    >
      <Icon name={math ? "sigma" : "book"} size="sm" className="size-3.5" />
      {subjectName(subject)}
    </span>
  );
}

/** What the set holds and whether it can still change: "12 questions (10 active) · immutable" / "· updated …". */
function SetFacts({ set }: { set: AssessmentSet }) {
  const questions = set.questions ?? [];
  const total = questions.length;
  const active = questions.filter((q: { is_active?: boolean }) => q.is_active).length;
  const updated = set.updated_at
    ? new Date(set.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ms-fg-3">
      <span className="inline-flex items-center gap-1">
        <Icon name="layers" size="sm" className="size-3.5" />
        {total} question{total === 1 ? "" : "s"}
        {total - active > 0 ? <span className="font-semibold text-ms-attention-fg">({active} active)</span> : null}
      </span>
      {set.is_active ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1 font-semibold text-ms-attention-fg">
            <Icon name="lock" size="sm" className="size-3.5" />
            immutable
          </span>
        </>
      ) : updated ? (
        <>
          <span aria-hidden="true">·</span>
          <span>updated {updated}</span>
        </>
      ) : null}
    </p>
  );
}

function SetRow({
  set: s,
  delay,
  showCreator,
  canApprove,
  statusBusy,
  onStatus,
  onDelete,
}: {
  set: AssessmentSet;
  delay: number;
  showCreator: boolean;
  canApprove: boolean;
  statusBusy: boolean;
  onStatus: (rs: ReviewStatus) => void;
  onDelete: () => void;
}) {
  const reviewStatus = (s.review_status ?? "draft") as ReviewStatus;
  const href = `/builder/sets/${s.id}`;
  return (
    <li
      data-set={s.id}
      style={{ animationDelay: `${delay}ms` }}
      className="animate-ms-fade-in ms-transition flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 hover:bg-ms-surface"
    >
      {/* A basis, so on a narrow screen the actions wrap under the set instead of squeezing it. */}
      <div className="min-w-0 flex-1 basis-[22rem]">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href} className="min-w-0 break-words text-[16px] font-semibold leading-[22px] text-ms-fg hover:text-ms-primary-text">
            #{s.id} · {s.title}
          </Link>
          {s.subject ? <SubjectTag subject={s.subject} /> : null}
          <Badge tone={REVIEW_STATUS_TONE[reviewStatus]}>{REVIEW_STATUS_LABELS[reviewStatus]}</Badge>
          {s.is_active ? (
            <Badge tone="positive" dot>
              Published
            </Badge>
          ) : (
            <Badge tone="line">Draft</Badge>
          )}
          {s.level ? <Badge tone="line">{setLevelsLabel(s.level, s.secondary_level)}</Badge> : null}
        </div>
        {s.category ? <p className="mt-1 text-[13px] text-ms-fg-2">{s.category}</p> : null}
        {showCreator && (s.created_by_name || s.created_by_email) ? (
          <p className="mt-0.5 text-[13px] text-ms-fg-3">
            Created by <span className="font-semibold text-ms-fg-2">{s.created_by_name || s.created_by_email}</span>
            {s.created_by_name && s.created_by_email ? ` · ${s.created_by_email}` : ""}
          </p>
        ) : null}
        <SetFacts set={s} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Select<ReviewStatus>
          aria-label={`Review status of #${s.id}`}
          className="w-[160px]"
          value={reviewStatus}
          disabled={statusBusy}
          onChange={(rs) => {
            if (rs !== reviewStatus) onStatus(rs);
          }}
          options={REVIEW_STATUS_ORDER.map((rs) => ({
            value: rs,
            label: REVIEW_STATUS_LABELS[rs],
            disabledReason: rs === "approved" && !canApprove ? "Only an admin can approve" : undefined,
          }))}
        />
        <Link href={href} className={buttonClass({ variant: "ghost", size: "sm" })}>
          Open editor →
        </Link>
        <Button
          variant="ghost"
          size="sm"
          icon="trash"
          aria-label={`Delete set ${s.title}`}
          onClick={onDelete}
          className="text-ms-fg-3 hover:text-ms-critical-fg"
        />
      </div>
    </li>
  );
}
