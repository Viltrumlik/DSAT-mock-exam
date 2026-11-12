"use client";

/**
 * /ops/journals/[journalId] — one journal: its state and progress, the journal's actions, and its sessions
 * (search, filters, bulk actions, add, edit, delete).
 *
 * In the console's look (design handoff v0.3). The words and the calls are the page's own; deleting a
 * session asks in the console's dialog instead of the browser's.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  SearchField,
  StatTile,
  chipClass,
  type BadgeTone,
} from "@/features/console/ui";
import { journalsApi } from "@/features/journals/api";
import { BACK_LINK, LoadingLine, Medallion } from "@/features/journals/journalParts";
import type { JournalDetail, LessonSummary } from "@/features/journals/types";
import type { MidtermOption } from "@/features/journals/types";
import { cn } from "@/lib/cn";

type FilterKey = "all" | "published" | "draft" | "missing" | "midterm" | "has_files" | "has_assessment" | "has_pastpaper";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "published", label: "Published" },
  { key: "draft", label: "Draft" },
  { key: "missing", label: "Missing" },
  { key: "midterm", label: "Midterm" },
  { key: "has_files", label: "Has files" },
  { key: "has_assessment", label: "Has assessment" },
  { key: "has_pastpaper", label: "Has past paper" },
];

const MIDTERM_PICKER_TITLE = "journal-midterm-picker-title";

/**
 * A refusal the page words itself from the server's data — "Fix incomplete lessons first: 3, 7" from a publish's
 * `blocking_lessons`. It carries no `response`, so it is shown as it is rather than looked for in `detail`.
 */
class JournalActionError extends Error {}

/** The server's own words for a refusal, when it sent any. */
function serverDetail(e: unknown): string | undefined {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : undefined;
}

export default function JournalDetailPage() {
  const params = useParams<{ journalId: string }>();
  const journalId = Number(params.journalId);
  const router = useRouter();

  const [journal, setJournal] = useState<JournalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Midterm picker — sessions are added explicitly, and a midterm needs an exam chosen
  // from the midterms available for THIS journal's level.
  const [midtermPickerOpen, setMidtermPickerOpen] = useState(false);
  const [midtermOptions, setMidtermOptions] = useState<MidtermOption[]>([]);
  const [midtermLoading, setMidtermLoading] = useState(false);
  // The session waiting on "Delete session N?".
  const [pendingDelete, setPendingDelete] = useState<{ id: number; number: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setJournal(await journalsApi.get(journalId));
    } catch {
      setError("Could not load this journal.");
    } finally {
      setLoading(false);
    }
  }, [journalId]);

  useEffect(() => {
    if (Number.isFinite(journalId)) void load();
  }, [journalId, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lessons = journal?.lessons ?? [];
    return lessons.filter((l) => {
      if (q && !`${l.lesson_number} ${l.title}`.toLowerCase().includes(q)) return false;
      switch (filter) {
        case "published": return l.status === "PUBLISHED";
        case "draft": return l.status === "DRAFT";
        case "missing": return l.lesson_type === "HOMEWORK" && !l.is_ready;
        case "midterm": return l.lesson_type === "MIDTERM";
        case "has_files": return l.has_files;
        case "has_assessment": return l.has_assessment;
        case "has_pastpaper": return l.has_pastpaper;
        default: return true;
      }
    });
  }, [journal, search, filter]);

  const runJournalAction = async (name: string, fn: () => Promise<JournalDetail>) => {
    setBusy(name);
    setError(null);
    try {
      setJournal(await fn());
    } catch (e: unknown) {
      // The page's own wording first (it was lost here before: a plain Error has no `response`, so a publish
      // blocked by incomplete lessons always read "Could not publish."), then the server's `detail`.
      const detail =
        e instanceof JournalActionError ? e.message : (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || `Could not ${name}.`);
    } finally {
      setBusy(null);
    }
  };

  /** "New session" — append an empty homework session (homework brief + classwork plan). */
  const addHomeworkSession = async () => {
    setBusy("add-session");
    setError(null);
    try {
      await journalsApi.addSession(journalId, "HOMEWORK");
      await load();
    } catch {
      setError("Could not add a session.");
    } finally {
      setBusy(null);
    }
  };

  const openMidtermPicker = async () => {
    if (!journal) return;
    setMidtermPickerOpen(true);
    setMidtermLoading(true);
    try {
      const d = await journalsApi.midtermOptions(journal.subject, journal.level);
      setMidtermOptions(d.midterms ?? []);
    } catch {
      setMidtermOptions([]);
    } finally {
      setMidtermLoading(false);
    }
  };

  const addMidtermSession = async (examId: number) => {
    setBusy("add-midterm");
    setError(null);
    try {
      await journalsApi.addSession(journalId, "MIDTERM", examId);
      setMidtermPickerOpen(false);
      await load();
    } catch {
      setError("Could not add the midterm session.");
    } finally {
      setBusy(null);
    }
  };

  /** "Delete session N?" said yes: a refusal stays in the dialog, in the server's words when it sent any. */
  const deleteSession = async () => {
    if (!pendingDelete) return;
    const lessonId = pendingDelete.id;
    setBusy(`del-${lessonId}`);
    setError(null);
    try {
      await journalsApi.deleteSession(journalId, lessonId);
      setPendingDelete(null);
      await load();
    } catch (e: unknown) {
      throw new Error(serverDetail(e) || "Could not delete that session.");
    } finally {
      setBusy(null);
    }
  };

  const doPublish = () =>
    runJournalAction("publish", async () => {
      try {
        return await journalsApi.publish(journalId);
      } catch (e: unknown) {
        const data = (e as { response?: { data?: { blocking_lessons?: Array<{ lesson_number: number }> } } })?.response?.data;
        if (data?.blocking_lessons?.length) {
          const nums = data.blocking_lessons.map((b) => b.lesson_number).join(", ");
          throw new JournalActionError(`Fix incomplete lessons first: ${nums}`);
        }
        throw e;
      }
    });

  const doExport = async () => {
    setBusy("export");
    try {
      const data = await journalsApi.exportJournal(journalId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `journal-${journal?.subject}-${journal?.level}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  };

  const doImport = async (file: File) => {
    setBusy("import");
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = await journalsApi.importJournal(parsed);
      // The backend picks the destination from the file's subject/level. If that is a
      // different journal than this route, navigate there so the URL and every later
      // publish/archive/bulk call target the journal the user is actually looking at.
      if (imported.id !== journalId) {
        router.push(`/ops/journals/${imported.id}`);
      } else {
        setJournal(imported);
      }
    } catch {
      setError("Import failed — check the file format.");
    } finally {
      setBusy(null);
    }
  };

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async (action: string) => {
    if (selected.size === 0) return;
    setBusy(`bulk-${action}`);
    setError(null);
    try {
      await journalsApi.bulk(journalId, action, [...selected]);
      setSelected(new Set());
      await load();
    } catch {
      setError(`Bulk ${action} failed.`);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <LoadingLine card className="mx-auto max-w-5xl">Loading journal…</LoadingLine>;
  }
  if (!journal) {
    return (
      <div className="mx-auto max-w-5xl">
        <BackLink />
        <LibraryError>{error || "Journal not found."}</LibraryError>
      </div>
    );
  }

  const p = journal.progress;
  const archived = journal.status === "ARCHIVED";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div>
        <BackLink />

        {/* Header */}
        <div className="animate-ms-fade-in flex min-w-0 items-center gap-3">
          <Medallion icon="ms-journal" size="lg" />
          <div className="min-w-0">
            <h1 className="text-ms-title break-words text-ms-fg">{journal.display_title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-ms-fg-2">
              <StatusBadge status={journal.status} />
              <span>{journal.duration_months} mo</span>
              <span aria-hidden="true" className="text-ms-fg-3">·</span>
              <span>{journal.total_lessons} lessons</span>
              <span aria-hidden="true" className="text-ms-fg-3">·</span>
              <span>{p.homework_total} homework</span>
              <span aria-hidden="true" className="text-ms-fg-3">·</span>
              <span>{p.midterm_total} midterm{p.midterm_total !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>
      </div>

      {error && <LibraryError>{error}</LibraryError>}

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        {archived ? (
          <Button size="sm" icon="undo" state={busy === "unarchive" ? "busy" : "idle"} onClick={() => runJournalAction("unarchive", () => journalsApi.unarchive(journalId))}>
            Restore to draft
          </Button>
        ) : (
          <>
            <Button variant="primary" size="sm" icon="send" state={busy === "publish" ? "busy" : "idle"} onClick={doPublish}>
              Publish
            </Button>
            {journal.status === "PUBLISHED" && (
              <Button size="sm" icon="undo" state={busy === "unarchive" ? "busy" : "idle"} onClick={() => runJournalAction("unarchive", () => journalsApi.unarchive(journalId))}>
                Revert to draft
              </Button>
            )}
            <Button size="sm" icon="archive" state={busy === "archive" ? "busy" : "idle"} onClick={() => runJournalAction("archive", () => journalsApi.archive(journalId))}>
              Archive
            </Button>
          </>
        )}
        <Button size="sm" icon="download" state={busy === "export" ? "busy" : "idle"} onClick={doExport}>
          Export
        </Button>
        <Button size="sm" icon="upload" state={busy === "import" ? "busy" : "idle"} onClick={() => fileInputRef.current?.click()}>
          Import
        </Button>
        <input
          ref={fileInputRef} type="file" accept="application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }}
        />
      </div>

      {/* Progress panel */}
      <section aria-label="Progress" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Completion" value={`${p.completion_pct}%`} tone={p.completion_pct >= 100 ? "positive" : "attention"} />
        <StatTile label="Homework ready" value={`${p.homework_ready}/${p.homework_total}`} tone={p.homework_missing === 0 ? "positive" : "attention"} delay={40} />
        <StatTile label="Classwork ready" value={`${p.classwork_ready}/${p.homework_total}`} tone={p.classwork_missing === 0 ? "positive" : "attention"} delay={80} />
        <StatTile label="Midterms set" value={`${p.midterm_configured}/${p.midterm_total}`} tone={p.midterm_total > 0 && p.midterm_configured === p.midterm_total ? "positive" : undefined} delay={120} />
        <StatTile label="Published / Draft" value={`${p.published_count} / ${p.draft_count}`} delay={160} />
      </section>

      {/* Add session — nothing is pre-provisioned; the admin decides the course shape. */}
      {!archived && (
        <div className="flex flex-wrap items-center gap-2 rounded-ms-card border border-dashed border-ms-border-strong bg-ms-card px-4 py-3">
          <div className="mr-auto min-w-0">
            <div className="text-[15px] font-semibold text-ms-fg">
              {p.sessions_total} session{p.sessions_total === 1 ? "" : "s"}
            </div>
            {journal.recommended && (
              <p className="text-[13px] text-ms-fg-2">
                Recommended for {journal.level_label}: {journal.recommended.lessons} lessons
                {" · "}midterm every {journal.recommended.midterm_every}
              </p>
            )}
          </div>
          <Button variant="primary" size="sm" icon="plus" state={busy === "add-session" ? "busy" : "idle"} onClick={addHomeworkSession}>
            New session
          </Button>
          <Button size="sm" icon="ms-midterm" onClick={openMidtermPicker}>
            New midterm
          </Button>
        </div>
      )}

      {/* Midterm picker — only midterms matching this journal's subject + level. */}
      <Dialog open={midtermPickerOpen} onClose={() => setMidtermPickerOpen(false)} labelledBy={MIDTERM_PICKER_TITLE} width={512}>
        <div className="flex items-center gap-2 border-b border-ms-line py-3 pl-5 pr-3">
          <h2 id={MIDTERM_PICKER_TITLE} className="flex-1 text-[18px] font-bold leading-6 text-ms-fg">
            Add a midterm session
          </h2>
          <Button variant="ghost" size="sm" icon="x" aria-label="Close" tooltip={false} onClick={() => setMidtermPickerOpen(false)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-[14px] text-ms-fg-2">
            Showing published midterms for {journal.subject_label} · {journal.level_label}.
            The class gets access 2 days before this session.
          </p>
          {midtermLoading ? (
            <div role="status" className="flex items-center gap-2 py-6 text-[14px] text-ms-fg-2">
              <Icon name="loader" size="sm" className="animate-ms-spin text-ms-primary-text" /> Loading midterms…
            </div>
          ) : midtermOptions.length === 0 ? (
            <p className="rounded-ms-ctl border border-dashed border-ms-border-strong px-4 py-6 text-center text-[14px] text-ms-fg-2">
              No published midterms are tagged for this level yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {midtermOptions.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => addMidtermSession(m.id)}
                    disabled={busy === "add-midterm"}
                    className="ms-transition flex w-full items-center gap-3 rounded-ms-ctl border border-ms-border bg-ms-card px-4 py-3 text-left hover:border-ms-primary hover:bg-ms-surface disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-ms-fg">{m.title}</span>
                      <span className="mt-0.5 block text-[13px] text-ms-fg-2">
                        {m.level || "untagged"}
                        {m.question_count != null ? ` · ${m.question_count} questions` : ""}
                        {m.duration_minutes ? ` · ${m.duration_minutes} min` : ""}
                      </span>
                    </span>
                    <Icon name="plus" size="sm" className="text-ms-fg-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>

      {/* Filter + search bar */}
      <div className="flex flex-col gap-3">
        <SearchField value={search} placeholder="Search lessons…" onSearch={setSearch} />
        <div role="group" aria-label="Filter sessions" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={chipClass(filter === f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div role="toolbar" aria-label="Bulk actions" className="animate-ms-fade-in flex flex-wrap items-center gap-2 rounded-ms-card border border-ms-primary bg-ms-primary-soft px-4 py-2.5">
          <span aria-live="polite" className="text-[15px] font-semibold tabular-nums text-ms-fg">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" state={busy === "bulk-publish" ? "busy" : "idle"} onClick={() => runBulk("publish")}>Publish</Button>
            <Button variant="primary" size="sm" state={busy === "bulk-draft" ? "busy" : "idle"} onClick={() => runBulk("draft")}>Draft</Button>
            <Button variant="primary" size="sm" state={busy === "bulk-clear" ? "busy" : "idle"} onClick={() => runBulk("clear")}>Clear content</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Lesson timeline */}
      <ol className="flex flex-col gap-2.5">
        {filtered.map((l) => (
          <LessonRow
            key={l.id}
            lesson={l}
            checked={selected.has(l.id)}
            onToggle={() => toggle(l.id)}
            onEdit={() => router.push(`/ops/journals/${journalId}/lessons/${l.id}`)}
            onDelete={() => setPendingDelete({ id: l.id, number: l.lesson_number })}
            deleting={busy === `del-${l.id}`}
            disabled={archived}
          />
        ))}
        {filtered.length === 0 && (
          <li className="rounded-ms-card border border-dashed border-ms-border-strong bg-ms-card">
            <EmptyState
              icon={(journal.lessons?.length ?? 0) === 0 ? "ms-journal" : "search"}
              title={
                (journal.lessons?.length ?? 0) === 0
                  ? "No sessions yet — add the first one with “New session”."
                  : "No sessions match."
              }
            />
          </li>
        )}
      </ol>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        tone="critical"
        icon="trash"
        title={pendingDelete ? `Delete session ${pendingDelete.number}?` : ""}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        onConfirm={deleteSession}
      >
        Later sessions are renumbered.
      </ConfirmDialog>
    </div>
  );
}

function LessonRow({
  lesson, checked, onToggle, onEdit, onDelete, deleting, disabled,
}: {
  lesson: LessonSummary;
  checked: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  disabled: boolean;
}) {
  const isMidterm = lesson.lesson_type === "MIDTERM";
  return (
    <li
      data-lesson={lesson.id}
      className={cn(
        "animate-ms-card-in ms-transition flex flex-wrap items-center gap-x-3 gap-y-2 rounded-ms-card border p-4",
        isMidterm
          ? "border-ms-info-line bg-ms-card"
          : lesson.is_ready
            ? "border-ms-border bg-ms-card"
            : "border-ms-attention-line bg-ms-card",
      )}
    >
      {!isMidterm && !disabled && (
        <Checkbox checked={checked} onChange={onToggle} label={`Select lesson ${lesson.lesson_number}`} />
      )}
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-[12px] text-[14px] font-bold tabular-nums",
          isMidterm ? "bg-ms-info-soft text-ms-info-fg" : "bg-ms-primary-soft text-ms-primary-text",
        )}
      >
        {lesson.lesson_number}
      </span>

      <div className="min-w-0 flex-1 basis-[14rem]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-[15px] font-semibold text-ms-fg">
            {isMidterm
              ? lesson.midterm?.title || "Midterm — no exam selected"
              : lesson.title || lesson.new_topic_title || `Session ${lesson.lesson_number}`}
          </span>
          {isMidterm ? (
            <Badge tone="info" icon="ms-midterm">Midterm</Badge>
          ) : lesson.status === "PUBLISHED" ? (
            <Badge tone="positive" icon="ok">Published</Badge>
          ) : lesson.is_ready ? (
            <Badge tone="info" dot>Ready</Badge>
          ) : (
            <Badge tone="attention" icon="warn">Missing</Badge>
          )}
        </div>
        {isMidterm ? (
          <div className="mt-0.5 text-[13px] text-ms-fg-2">
            Class gets access {lesson.midterm?.access_days_before ?? 2} days before · no homework
          </div>
        ) : (
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-ms-fg-2">
            <span>{lesson.content_count} item{lesson.content_count !== 1 ? "s" : ""}</span>
            <span className={cn("font-semibold", lesson.homework_ready ? "text-ms-positive-fg" : "text-ms-attention-fg")}>
              · Homework {lesson.homework_ready ? "✓" : "—"}
            </span>
            <span className={cn("font-semibold", lesson.classwork_ready ? "text-ms-positive-fg" : "text-ms-attention-fg")}>
              · Classwork {lesson.classwork_ready ? "✓" : "—"}
            </span>
            {!lesson.is_ready && lesson.validation.length > 0 && (
              <span className="inline-flex items-center gap-1 text-ms-attention-fg">
                <Icon name="warn" size="sm" className="size-3.5" /> {lesson.validation[0]}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {!isMidterm && (
          <Button size="sm" icon="pencil" onClick={onEdit} disabled={disabled}>
            Edit
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon="trash"
          aria-label={`Delete session ${lesson.lesson_number}`}
          state={deleting ? "busy" : "idle"}
          disabled={disabled || deleting}
          onClick={onDelete}
        />
      </div>
    </li>
  );
}

const STATUS_TONE: Record<JournalDetail["status"], BadgeTone> = {
  PUBLISHED: "positive",
  ARCHIVED: "neutral",
  DRAFT: "attention",
};

function StatusBadge({ status }: { status: JournalDetail["status"] }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "attention"} dot>
      {status}
    </Badge>
  );
}

function BackLink() {
  return (
    <Link href="/ops/journals" className={BACK_LINK}>
      <Icon name="left" size="sm" /> All journals
    </Link>
  );
}
