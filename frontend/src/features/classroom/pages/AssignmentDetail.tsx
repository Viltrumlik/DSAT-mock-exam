"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, CalendarClock, Upload, Play, RotateCcw, MessageSquare, CheckCircle2,
  FileText, ExternalLink, Paperclip, GraduationCap, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeApiError } from "@/lib/apiError";
import { Card, CardHeader, Button, Pill, LoadingState, ErrorState } from "../ui";
import { useClassroom } from "../hooks";
import { capabilitiesFor } from "../capabilities";
import { useAssignment, useMySubmission, useSubmitHomework } from "../homeworkHooks";
import { assignmentKind, contentActions, KIND_LABEL, startHref, type AssignmentDetail, type AssignmentKind, type MySubmission } from "../homeworkApi";
import { SubmissionStatusPill } from "./statusPill";

function dueLine(due: string | null, done: boolean): { text: string; tone: "neutral" | "warning" | "info" } {
  if (!due) return { text: "No deadline", tone: "neutral" };
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return { text: "No deadline", tone: "neutral" };
  const dateStr = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - startOfToday.getTime()) / 86_400_000);
  if (done) return { text: `Due ${dateStr}`, tone: "neutral" };
  if (days < 0) return { text: `Past due · was ${dateStr}`, tone: "warning" };
  if (days === 0) return { text: "Due today", tone: "info" };
  if (days === 1) return { text: "Due tomorrow", tone: "info" };
  return { text: `Due ${dateStr} · in ${days} days`, tone: "neutral" };
}

function whatToSubmit(kind: AssignmentKind): string {
  if (kind === "FILE") return "Upload your work as a file. Your teacher will review and grade it.";
  return `Complete the ${KIND_LABEL[kind].toLowerCase()}. Your score is recorded automatically when you finish — no upload needed.`;
}

export function AssignmentDetailPage({ classId, assignmentId }: { classId: number; assignmentId: number }) {
  const classroom = useClassroom(classId);
  const a = useAssignment(classId, assignmentId);

  if (a.isLoading || classroom.isLoading) return <LoadingState label="Opening assignment…" />;
  if (a.isError || !a.data) return <ErrorState title="Assignment not available" onRetry={() => a.refetch()} />;

  const caps = capabilitiesFor(classroom.data?.my_role);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:px-6">
      <Link href={`/classes/${classId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to class
      </Link>
      {caps.isStaff
        ? <TeacherView classId={classId} assignment={a.data} />
        : <StudentView classId={classId} assignment={a.data} />}
    </div>
  );
}

function TeacherView({ classId, assignment }: { classId: number; assignment: AssignmentDetail }) {
  const router = useRouter();
  const kind = assignmentKind(assignment);
  return (
    <div className="mt-4 space-y-5">
      <header>
        <div className="flex items-center gap-2">
          <Pill tone="primary">{KIND_LABEL[kind]}</Pill>
          {assignment.status === "DRAFT" && <Pill tone="neutral">Draft</Pill>}
          {assignment.status === "ARCHIVED" && <Pill tone="neutral">Archived</Pill>}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{assignment.title}</h1>
      </header>
      {assignment.instructions && (
        <Card><CardHeader title="Instructions" /><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{assignment.instructions}</p></Card>
      )}
      <Card>
        <CardHeader title="Grading" description={assignment.category === "HOMEWORK" || kind === "FILE" ? "Manual grading" : "Auto-graded"} />
        <Button className="mt-4" icon={GraduationCap} onClick={() => router.push(`/classes/${classId}?tab=grading`)}>
          Open in gradebook
        </Button>
      </Card>
    </div>
  );
}

function StudentView({ classId, assignment }: { classId: number; assignment: AssignmentDetail }) {
  const router = useRouter();
  const sub = useMySubmission(classId, assignment.id);
  const kind = assignmentKind(assignment);
  const my = sub.data ?? null;
  const status = my?.workflow_status ?? my?.status ?? null;
  const done = status === "REVIEWED";
  const due = dueLine(assignment.due_at, done);
  const [uploadOpen, setUploadOpen] = useState(false);

  const action = resolveAction(kind, status);
  const href = startHref(classId, assignment);
  const actions = contentActions(assignment);
  const multi = actions.length > 1;

  function runAction() {
    if (action.mode === "upload") { setUploadOpen(true); return; }
    if (action.mode === "start" && href) { router.push(href); return; }
    if (action.mode === "feedback") {
      document.getElementById("feedback-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <div className="mt-4 space-y-5">
      {/* 1. What is this? */}
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="primary">{multi ? "Bundle" : KIND_LABEL[kind]}</Pill>
          <SubmissionStatusPill status={status} />
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{assignment.title}</h1>
        {/* 2. When is it due? */}
        <p className={cn("mt-1.5 inline-flex items-center gap-1.5 text-sm",
          due.tone === "warning" ? "text-amber-600" : due.tone === "info" ? "text-sky-600" : "text-muted-foreground")}>
          <CalendarClock className="h-4 w-4" /> {due.text}
        </p>
      </header>

      {/* 5. What should I do next? */}
      {multi ? (
        /* Multi-content bundle: open each attached activity separately. */
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activities</p>
          <p className="mt-2 text-sm text-muted-foreground">
            This assignment includes several activities. Open each one — your score for each is recorded automatically.
          </p>
          <div className="mt-4 space-y-2">
            {actions.map((c) => (
              <Link
                key={`${c.kind}-${c.href}`}
                href={c.href}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Play className="h-4 w-4 text-primary" /> {c.label}
                </span>
                <Pill tone="neutral">{KIND_LABEL[c.kind]}</Pill>
              </Link>
            ))}
          </div>
        </Card>
      ) : done ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Completed</p>
              <p className="text-xs text-muted-foreground">Your work is graded — see your feedback below.</p>
            </div>
            <Button variant="secondary" icon={MessageSquare} onClick={runAction}>Feedback</Button>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next step</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-foreground">{whatToSubmit(kind)}</p>
            <Button size="lg" icon={action.icon} onClick={runAction} disabled={action.mode === "start" && !href}>
              {action.label}
            </Button>
          </div>
          {action.mode === "start" && !href && (
            <p className="mt-2 text-xs text-amber-600">This activity isn't linked yet — ask your teacher.</p>
          )}
        </Card>
      )}

      {/* File upload panel (FILE kind) */}
      {uploadOpen && kind === "FILE" && !multi && (
        <UploadPanel classId={classId} assignmentId={assignment.id} my={my} onClose={() => setUploadOpen(false)} />
      )}

      {/* 3. What is this / what to submit — details + teacher materials */}
      {(assignment.instructions || assignment.attachment_file_url || (assignment.attachment_urls?.length) || assignment.external_url) && (
        <Card>
          <CardHeader title="Details" />
          {assignment.instructions && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{assignment.instructions}</p>}
          <div className="mt-3 space-y-2">
            {assignment.external_url && (
              <a href={assignment.external_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                <ExternalLink className="h-4 w-4" /> Open linked resource
              </a>
            )}
            {(assignment.attachment_urls ?? []).map((f, i) => (
              <a key={i} href={f.url} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" /> {f.file_name || "Attachment"}
              </a>
            ))}
          </div>
        </Card>
      )}

      {/* 4. What feedback did I receive? */}
      <div id="feedback-card">
        {my?.review && (status === "REVIEWED" || status === "RETURNED") ? (
          <Card>
            <CardHeader
              title={status === "RETURNED" ? "Revision requested" : "Feedback"}
              actions={my.review.grade != null ? (
                <Pill tone={status === "RETURNED" ? "warning" : "success"}>
                  {my.review.grade}{my.review.max_score ? `/${my.review.max_score}` : ""}
                  {my.review.is_auto ? " · Auto" : ""}
                </Pill>
              ) : undefined}
            />
            {status === "RETURNED" && my.return_note && (
              <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{my.return_note}</p>
            )}
            {my.review.feedback ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{my.review.feedback}</p>
            ) : status === "REVIEWED" && (
              <p className="mt-2 text-sm text-muted-foreground">No written feedback — your score is shown above.</p>
            )}
          </Card>
        ) : null}
      </div>

      {/* Submitted files (FILE kind) */}
      {kind === "FILE" && (my?.files?.length ?? 0) > 0 && (
        <Card>
          <CardHeader title="Your submission" />
          <div className="mt-3 space-y-2">
            {my!.files!.map((f) => (
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-2">
                <FileText className="h-4 w-4 text-muted-foreground" /> {f.file_name || "File"}
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function resolveAction(kind: AssignmentKind, status: MySubmission["workflow_status"] | null):
  { label: string; icon: React.ElementType; mode: "start" | "upload" | "feedback" } {
  if (status === "REVIEWED") return { label: "Review feedback", icon: MessageSquare, mode: "feedback" };
  if (kind === "FILE") {
    if (status === "RETURNED") return { label: "Revise and resubmit", icon: RotateCcw, mode: "upload" };
    if (status === "SUBMITTED") return { label: "Edit submission", icon: Upload, mode: "upload" };
    return { label: "Upload submission", icon: Upload, mode: "upload" };
  }
  if (status === "RETURNED") return { label: `Start ${KIND_LABEL[kind]} again`, icon: RotateCcw, mode: "start" };
  if (status === "SUBMITTED") return { label: `Open ${KIND_LABEL[kind]}`, icon: Play, mode: "start" };
  return { label: `Start ${KIND_LABEL[kind]}`, icon: Play, mode: "start" };
}

function UploadPanel({ classId, assignmentId, my, onClose }: {
  classId: number; assignmentId: number; my: MySubmission | null; onClose: () => void;
}) {
  const submit = useSubmitHomework(classId, assignmentId);
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function send() {
    setErr(null);
    if (files.length === 0) return setErr("Choose at least one file.");
    const fd = new FormData();
    fd.append("submit", "true");
    if (typeof my?.revision === "number") fd.append("expected_revision", String(my.revision));
    const tokens: string[] = [];
    for (const f of files) { fd.append("files", f); tokens.push(crypto.randomUUID()); }
    fd.append("file_tokens", JSON.stringify(tokens));
    try {
      await submit.mutateAsync(fd);
      setFiles([]);
      onClose();
    } catch (e) {
      setErr(normalizeApiError(e).message);
    }
  }

  return (
    <Card>
      <CardHeader title="Upload your work" actions={<Button variant="ghost" size="sm" icon={X} onClick={onClose}>Cancel</Button>} />
      {err && <p className="mt-2 text-sm text-rose-500">{err}</p>}
      <div className="mt-3 space-y-3">
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        <button onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-6 text-sm text-muted-foreground hover:bg-surface-2">
          <Upload className="h-4 w-4" /> Choose files
        </button>
        {files.length > 0 && (
          <ul className="space-y-1 text-sm text-foreground">
            {files.map((f, i) => <li key={i} className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> {f.name}</li>)}
          </ul>
        )}
        <Button block loading={submit.isPending} disabled={files.length === 0} onClick={send}>Submit homework</Button>
      </div>
    </Card>
  );
}
