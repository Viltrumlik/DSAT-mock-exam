"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText, Paperclip, CheckCircle2, ClipboardPen, CornerDownLeft, ExternalLink,
  ChevronUp, ChevronDown, History,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Card, CardContent, Badge, Button, IconButton, Avatar, Textarea, Input, Field, EmptyState, Skeleton,
  ToastProvider, useToast,
} from "@/components/ui";
import { useGradingQueue, studentName, type QueueItem } from "./useGradingQueue";

function fmtWhen(iso?: string | null) {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Draft feedback recovery (localStorage) ──────────────────────────────────
type Draft = { score: string; feedback: string };
const draftKey = (id: number) => `mastersat.gradeDraft.${id}`;
function readDraft(id: number): Draft | null {
  try { const r = localStorage.getItem(draftKey(id)); return r ? (JSON.parse(r) as Draft) : null; } catch { return null; }
}
function writeDraft(id: number, d: Draft) { try { localStorage.setItem(draftKey(id), JSON.stringify(d)); } catch { /* quota */ } }
function clearDraft(id: number) { try { localStorage.removeItem(draftKey(id)); } catch { /* ignore */ } }

export function TeacherGrading({ previewItems }: { previewItems?: QueueItem[] }) {
  return (
    <ToastProvider>
      <GradingInner previewItems={previewItems} />
    </ToastProvider>
  );
}

function GradingInner({ previewItems }: { previewItems?: QueueItem[] }) {
  const { status, items, loading, grade } = useGradingQueue(previewItems);
  const toast = useToast();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [recovered, setRecovered] = useState(false);

  const selectedIdx = useMemo(() => items.findIndex((i) => i.key === selectedKey), [items, selectedKey]);
  const selected = selectedIdx >= 0 ? items[selectedIdx] : null;

  useEffect(() => {
    if (!selectedKey && items.length > 0) setSelectedKey(items[0].key);
    if (selectedKey && !items.some((i) => i.key === selectedKey)) setSelectedKey(items[0]?.key ?? null);
  }, [items, selectedKey]);

  // Load grade fields — recovered draft takes precedence over a prior review.
  useEffect(() => {
    if (!selected) { setScore(""); setFeedback(""); setRecovered(false); return; }
    const draft = readDraft(selected.submission.id);
    const r = selected.submission.review;
    if (draft && (draft.score || draft.feedback)) {
      setScore(draft.score); setFeedback(draft.feedback); setRecovered(true);
    } else {
      setScore(r?.grade != null ? String(r.grade) : ""); setFeedback(r?.feedback ?? ""); setRecovered(false);
    }
  }, [selected]);

  // Persist draft as the teacher types so feedback survives navigation / reload.
  useEffect(() => {
    if (!selected) return;
    if (!score && !feedback) { clearDraft(selected.submission.id); return; }
    writeDraft(selected.submission.id, { score, feedback });
  }, [score, feedback, selected]);

  const move = useCallback((dir: 1 | -1) => {
    setSelectedKey((cur) => {
      const idx = items.findIndex((i) => i.key === cur);
      const next = items[idx + dir];
      return next ? next.key : cur;
    });
  }, [items]);

  const saveAndNext = useCallback(async () => {
    if (!selected) return;
    const n = Number(score);
    if (!Number.isFinite(n) || n < 0 || n > 100) { toast({ title: "Enter a score 0–100", tone: "warning" }); return; }
    const nextKey = items[selectedIdx + 1]?.key ?? items[selectedIdx - 1]?.key ?? null;
    setSaving(true);
    const ok = await grade(selected, { grade: n, feedback });
    setSaving(false);
    if (ok) { clearDraft(selected.submission.id); toast({ title: `Graded ${studentName(selected.submission.student)}`, tone: "success" }); setSelectedKey(nextKey); }
    else toast({ title: "Couldn't save — try again", tone: "danger" });
  }, [selected, score, feedback, items, selectedIdx, grade, toast]);

  // Keyboard: ⌘/Ctrl+Enter save & next; ↑/↓ navigate (when not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void saveAndNext(); return; }
      if (!typing && (e.key === "ArrowDown" || e.key === "j")) { e.preventDefault(); move(1); }
      if (!typing && (e.key === "ArrowUp" || e.key === "k")) { e.preventDefault(); move(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveAndNext, move]);

  if (status === "booting" || (loading && items.length === 0)) {
    return <div className="mx-auto max-w-6xl"><Skeleton className="mb-4 h-10 w-48" /><div className="grid gap-4 lg:grid-cols-[340px_1fr]"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div></div>;
  }
  if (status === "unauthenticated") {
    return <div className="mx-auto max-w-md py-16"><Card><CardContent className="py-10 text-center"><p className="ds-h3">Grading</p><p className="mt-2 text-sm text-muted-foreground">Sign in with a teacher account.</p></CardContent></Card></div>;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="ds-overline text-primary">Teacher</p>
          <h1 className="ds-h1 mt-1">Grading</h1>
          <p className="ds-small mt-1">{items.length} awaiting a grade · <kbd className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold">⌘↵</kbd> save &amp; next · <kbd className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold">↑↓</kbd> navigate</p>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="All caught up" description="No submissions are waiting to be graded right now." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          {/* Queue */}
          <div className="flex max-h-[72vh] flex-col gap-2 overflow-y-auto pr-1">
            {items.map((it) => {
              const active = it.key === selectedKey;
              const hasDraft = !!readDraft(it.submission.id);
              return (
                <button key={it.key} type="button" onClick={() => setSelectedKey(it.key)} className={cn("ds-ring flex items-center gap-3 rounded-xl border p-3 text-left transition-colors", active ? "border-primary/30 bg-primary-soft" : "border-border bg-card hover:bg-surface-2")}>
                  <Avatar name={studentName(it.submission.student)} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{studentName(it.submission.student)}</p>
                    <p className="truncate text-[12px] text-muted-foreground">{it.assignmentTitle} · {it.className}</p>
                  </div>
                  {hasDraft ? <span title="Draft saved" className="shrink-0 text-warning"><History className="h-3.5 w-3.5" /></span> : null}
                  <span className="shrink-0 text-[11px] text-label-foreground">{fmtWhen(it.submission.submitted_at)}</span>
                </button>
              );
            })}
          </div>

          {/* Workspace */}
          {selected ? (
            <Card>
              <CardContent className="flex flex-col gap-5">
                <div className="flex items-center gap-3 border-b border-border pb-4">
                  <Avatar name={studentName(selected.submission.student)} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="ds-h4 truncate">{studentName(selected.submission.student)}</p>
                    <p className="truncate text-[13px] text-muted-foreground">{selected.assignmentTitle} · {selected.className}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="mr-1 text-[12px] text-label-foreground">{selectedIdx + 1} / {items.length}</span>
                    <IconButton variant="ghost" size="sm" aria-label="Previous" disabled={selectedIdx <= 0} onClick={() => move(-1)}><ChevronUp className="h-4 w-4" /></IconButton>
                    <IconButton variant="ghost" size="sm" aria-label="Next" disabled={selectedIdx >= items.length - 1} onClick={() => move(1)}><ChevronDown className="h-4 w-4" /></IconButton>
                  </div>
                </div>

                {/* Submission */}
                <div>
                  <p className="ds-overline mb-2">Submission</p>
                  {selected.submission.attempt ? (
                    <div className="mb-3 flex items-center gap-3 rounded-xl bg-surface-2 p-3">
                      <FileText className="h-5 w-5 text-primary" />
                      <div className="flex-1"><p className="text-sm font-semibold text-foreground">{selected.submission.attempt.practice_test_title || "Practice attempt"}</p>{typeof selected.submission.attempt.score === "number" ? <p className="text-[12px] text-muted-foreground">Score {selected.submission.attempt.score}</p> : null}</div>
                    </div>
                  ) : null}
                  {selected.submission.files && selected.submission.files.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {selected.submission.files.map((f, i) => (
                        <li key={i}><a href={f.url} target="_blank" rel="noopener noreferrer" className="ds-ring flex items-center gap-2.5 rounded-xl border border-border p-3 text-sm transition-colors hover:bg-surface-2"><Paperclip className="h-4 w-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-medium text-foreground">{f.file_name || "Attachment"}</span><ExternalLink className="h-4 w-4 text-label-foreground" /></a></li>
                      ))}
                    </ul>
                  ) : !selected.submission.attempt ? (
                    <p className="text-sm text-muted-foreground">No files attached.</p>
                  ) : null}
                </div>

                {/* Grade form */}
                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  {recovered ? (
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-warning-soft px-2.5 py-1 text-[12px] font-semibold text-warning-foreground"><History className="h-3.5 w-3.5" /> Recovered an unsaved draft</span>
                  ) : null}
                  <Field label="Score (0–100)" htmlFor="grade-score">
                    <Input id="grade-score" type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} placeholder="e.g. 85" className="max-w-[160px]" />
                  </Field>
                  <Field label="Feedback" htmlFor="grade-feedback">
                    <Textarea id="grade-feedback" rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What went well, what to work on…" />
                  </Field>
                  <div className="flex items-center gap-2">
                    <Button loading={saving} onClick={saveAndNext} leftIcon={<ClipboardPen />}>Save &amp; next</Button>
                    <span className="text-[12px] text-label-foreground"><CornerDownLeft className="mr-1 inline h-3.5 w-3.5" />⌘↵</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card><CardContent className="flex h-full items-center justify-center py-16"><EmptyState compact icon={ClipboardPen} title="Select a submission" description="Choose from the queue to start grading." /></CardContent></Card>
          )}
        </div>
      )}
    </div>
  );
}
