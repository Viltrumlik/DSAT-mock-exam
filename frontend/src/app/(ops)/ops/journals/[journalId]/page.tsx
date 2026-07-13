"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { journalsApi } from "@/features/journals/api";
import type { JournalDetail, LessonSummary } from "@/features/journals/types";
import {
  AlertTriangle,
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Download,
  Edit3,
  GraduationCap,
  Loader2,
  RotateCcw,
  Search,
  Send,
  Upload,
} from "lucide-react";

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
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || `Could not ${name}.`);
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
          throw new Error(`Fix incomplete lessons first: ${nums}`);
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
      setJournal(await journalsApi.importJournal(parsed));
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
    return (
      <div className="mx-auto flex max-w-5xl items-center gap-2 rounded-2xl border border-border bg-card px-6 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading journal…
      </div>
    );
  }
  if (!journal) {
    return (
      <div className="mx-auto max-w-5xl">
        <BackLink />
        <p className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {error || "Journal not found."}
        </p>
      </div>
    );
  }

  const p = journal.progress;
  const archived = journal.status === "ARCHIVED";

  return (
    <div className="mx-auto w-full max-w-5xl">
      <BackLink />

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <GraduationCap className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{journal.display_title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
              <StatusBadge status={journal.status} />
              <span>{journal.duration_months} mo</span>
              <span>·</span>
              <span>{journal.total_lessons} lessons</span>
              <span>·</span>
              <span>{p.homework_total} homework</span>
              <span>·</span>
              <span>{p.midterm_total} midterm{p.midterm_total !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Action bar */}
      <div className="mb-5 flex flex-wrap gap-2">
        {archived ? (
          <ActionBtn icon={ArchiveRestore} label="Restore to draft" busy={busy === "unarchive"} onClick={() => runJournalAction("unarchive", () => journalsApi.unarchive(journalId))} />
        ) : (
          <>
            <ActionBtn primary icon={Send} label="Publish" busy={busy === "publish"} onClick={doPublish} />
            {journal.status === "PUBLISHED" && (
              <ActionBtn icon={RotateCcw} label="Revert to draft" busy={busy === "unarchive"} onClick={() => runJournalAction("unarchive", () => journalsApi.unarchive(journalId))} />
            )}
            <ActionBtn icon={Archive} label="Archive" busy={busy === "archive"} onClick={() => runJournalAction("archive", () => journalsApi.archive(journalId))} />
          </>
        )}
        <ActionBtn icon={Download} label="Export" busy={busy === "export"} onClick={doExport} />
        <ActionBtn icon={Upload} label="Import" busy={busy === "import"} onClick={() => fileInputRef.current?.click()} />
        <input
          ref={fileInputRef} type="file" accept="application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }}
        />
      </div>

      {/* Progress panel */}
      <div className="mb-5 grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Completion" value={`${p.completion_pct}%`} tone={p.completion_pct >= 100 ? "good" : "warn"} />
        <Stat label="Homework ready" value={`${p.homework_ready}/${p.homework_total}`} tone={p.homework_missing === 0 ? "good" : "warn"} />
        <Stat label="Missing" value={String(p.homework_missing)} tone={p.homework_missing === 0 ? "good" : "bad"} />
        <Stat label="Published / Draft" value={`${p.published_count} / ${p.draft_count}`} tone="neutral" />
      </div>

      {/* Filter + search bar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lessons…"
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors",
                filter === f.key ? "bg-primary text-white" : "bg-surface-2 text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-bold text-foreground">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <BulkBtn label="Publish" busy={busy === "bulk-publish"} onClick={() => runBulk("publish")} />
            <BulkBtn label="Draft" busy={busy === "bulk-draft"} onClick={() => runBulk("draft")} />
            <BulkBtn label="Clear content" busy={busy === "bulk-clear"} onClick={() => runBulk("clear")} />
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs font-bold text-muted-foreground hover:text-foreground">
              Cancel
            </button>
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
            disabled={archived}
          />
        ))}
        {filtered.length === 0 && (
          <li className="rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
            No lessons match.
          </li>
        )}
      </ol>
    </div>
  );
}

function LessonRow({
  lesson, checked, onToggle, onEdit, disabled,
}: {
  lesson: LessonSummary;
  checked: boolean;
  onToggle: () => void;
  onEdit: () => void;
  disabled: boolean;
}) {
  const isMidterm = lesson.lesson_type === "MIDTERM";
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-4 shadow-sm transition-colors",
        isMidterm
          ? "border-[#6d4ec7]/40 bg-[#6d4ec7]/5"
          : lesson.is_ready
            ? "border-border bg-card"
            : "border-amber-300/60 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20",
      )}
    >
      {!isMidterm && !disabled && (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary"
          aria-label={`Select lesson ${lesson.lesson_number}`}
        />
      )}
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold",
          isMidterm ? "bg-[#6d4ec7]/15 text-[#6d4ec7]" : "bg-primary/10 text-primary",
        )}
      >
        {lesson.lesson_number}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-extrabold text-foreground">
            {isMidterm ? "Midterm" : lesson.title || `Lesson ${lesson.lesson_number}`}
          </span>
          {isMidterm ? (
            <Badge className="bg-[#6d4ec7]/15 text-[#6d4ec7]">Midterm</Badge>
          ) : lesson.status === "PUBLISHED" ? (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Published</Badge>
          ) : lesson.is_ready ? (
            <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">Ready</Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Missing</Badge>
          )}
        </div>
        {!isMidterm && (
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] font-medium text-muted-foreground">
            <span>{lesson.content_count} item{lesson.content_count !== 1 ? "s" : ""}</span>
            {lesson.due_after_days != null && <span>· due +{lesson.due_after_days}d</span>}
            {!lesson.is_ready && lesson.validation.length > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" /> {lesson.validation[0]}
              </span>
            )}
          </div>
        )}
      </div>

      {isMidterm ? (
        <span className="text-xs font-semibold text-muted-foreground">No homework</span>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm font-bold text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <Edit3 className="h-4 w-4" /> Edit
        </button>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: JournalDetail["status"] }) {
  const style =
    status === "PUBLISHED"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : status === "ARCHIVED"
        ? "bg-surface-2 text-muted-foreground"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return <Badge className={style}>{status}</Badge>;
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide", className)}>
      {children}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" | "neutral" }) {
  const color =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad" ? "text-rose-600 dark:text-rose-400"
        : tone === "warn" ? "text-amber-600 dark:text-amber-400"
          : "text-foreground";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("text-xl font-extrabold", color)}>{value}</span>
    </div>
  );
}

function ActionBtn({
  icon: Icon, label, onClick, busy, primary,
}: {
  icon: typeof Send; label: string; onClick: () => void; busy?: boolean; primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors disabled:opacity-60",
        primary
          ? "bg-primary text-white hover:bg-primary/90"
          : "border border-border bg-card text-foreground hover:border-primary hover:text-primary",
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {label}
    </button>
  );
}

function BulkBtn({ label, onClick, busy }: { label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {label}
    </button>
  );
}

function BackLink() {
  return (
    <Link href="/ops/journals" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition-colors hover:text-primary">
      <ArrowLeft className="h-4 w-4" /> All journals
    </Link>
  );
}
