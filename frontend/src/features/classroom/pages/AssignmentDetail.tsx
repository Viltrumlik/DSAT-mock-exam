"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Clock, Upload, Play, RotateCcw, MessageSquare, CheckCircle2,
  FileText, ExternalLink, GraduationCap, X, Eye,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeApiError } from "@/lib/apiError";
import { Card, CardHeader, Button, Pill, LoadingState, ErrorState } from "../ui";
import { useClassroom } from "../hooks";
import { capabilitiesFor } from "../capabilities";
import { useAssignment, useMySubmission, useSubmitHomework } from "../homeworkHooks";
import { assignmentKind, contentActions, KIND_LABEL, type AssignmentDetail, type AssignmentKind, type MySubmission } from "../homeworkApi";
import { spawnRipple } from "../ui/ripple";
import { examsStudentApi } from "@/features/examsStudent/api";
import { SubmissionStatusPill } from "./statusPill";
import { materialMeta, formatBytes } from "./materialMeta";
import { Download } from "lucide-react";

/** Short, friendly date — "Jun 30" — matching the design's meta tiles. */
function shortDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Human section label from the raw backend subject code. */
function sectionLabel(subject?: string | null): string {
  if (!subject) return "—";
  const s = subject.toUpperCase();
  if (s === "READING_WRITING" || s === "ENGLISH" || s === "RW") return "Reading & Writing";
  if (s === "MATH") return "Math";
  return subject;
}

/** Countdown text derived from the due date (Past due / Due today / N days left). */
function countdown(due?: string | null): string {
  if (!due) return "No deadline";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "No deadline";
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - startOfToday.getTime()) / 86_400_000);
  if (days < 0) return "Past due";
  if (days === 0) return "Due today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

export function AssignmentDetailPage({ classId, assignmentId, basePath }: { classId: number; assignmentId: number; basePath?: string }) {
  const classroom = useClassroom(classId);
  const a = useAssignment(classId, assignmentId);
  // On the teacher portal (teacher.mastersat.uz) every link must stay under
  // `/teacher/*` (middleware bounces `/classes/...` to the dashboard), so callers
  // there pass basePath=`/teacher/classrooms/<id>`. Defaults to the student site.
  const base = basePath ?? `/classes/${classId}`;

  if (a.isLoading || classroom.isLoading) return <LoadingState label="Opening assignment…" />;
  if (a.isError || !a.data) return <ErrorState title="Assignment not available" onRetry={() => a.refetch()} />;

  const caps = capabilitiesFor(classroom.data?.my_role);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:px-6">
      <Link href={base} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to class
      </Link>
      {caps.isStaff
        ? <TeacherView base={base} assignment={a.data} />
        : <StudentView classId={classId} base={base} assignment={a.data} />}
    </div>
  );
}

function TeacherView({ base, assignment }: { base: string; assignment: AssignmentDetail }) {
  const router = useRouter();
  const kind = assignmentKind(assignment);
  return (
    <div className="cr-section mt-4 space-y-5">
      <header>
        <div className="flex items-center gap-2">
          <Pill tone="primary">{KIND_LABEL[kind]}</Pill>
          {assignment.status === "DRAFT" && <Pill tone="neutral">Draft</Pill>}
          {assignment.status === "ARCHIVED" && <Pill tone="neutral">Archived</Pill>}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{assignment.title}</h1>
      </header>
      {assignment.instructions && (
        <Card className="cr-card"><CardHeader title="Instructions" /><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{assignment.instructions}</p></Card>
      )}
      <Card className="cr-card">
        <CardHeader title="Grading" description={assignment.category === "HOMEWORK" || kind === "FILE" ? "Manual grading" : "Auto-graded"} />
        <Button className="mt-4" icon={GraduationCap} onClick={() => router.push(`${base}?tab=grading`)}>
          Open in gradebook
        </Button>
      </Card>
    </div>
  );
}

function StudentView({ classId, base, assignment }: { classId: number; base: string; assignment: AssignmentDetail }) {
  const router = useRouter();
  const sub = useMySubmission(classId, assignment.id);
  const kind = assignmentKind(assignment);
  const my = sub.data ?? null;
  const status = my?.workflow_status ?? my?.status ?? null;
  const done = status === "REVIEWED";
  const [uploadOpen, setUploadOpen] = useState(false);
  const [startingId, setStartingId] = useState<number | null>(null);

  // Past papers have no detail page: start (or resume) the section's attempt and
  // jump straight to the exam welcome — exactly like the /pastpapers library does,
  // so a pastpaper homework never lands on the practice-test page.
  async function startPastpaper(testId: number) {
    setStartingId(testId);
    try {
      const attempt = await examsStudentApi.startTest(testId);
      try {
        sessionStorage.setItem(`mastersat.attempt.bootstrap.${attempt.id}`, JSON.stringify(attempt));
      } catch {}
      router.push(`/exam/${attempt.id}?welcome=1`);
    } catch (e) {
      console.error("[homework] start pastpaper failed", e);
      setStartingId(null);
    }
  }

  const action = resolveAction(kind, status);
  const actions = contentActions(assignment);
  const isFile = kind === "FILE" || actions.length === 0;
  const badgeLabel = actions.length > 1 ? "Bundle" : KIND_LABEL[kind];

  // Meta tiles (design's hero row): label + value, animated with stagger.
  const tiles: { label: string; value: string; countdown?: boolean }[] = [
    { label: "Assigned", value: shortDate(assignment.assigned_at ?? assignment.created_at ?? assignment.published_at) },
    { label: "Due", value: assignment.due_at ? shortDate(assignment.due_at) : "No deadline" },
    { label: "Tasks", value: assignment.item_count != null ? `${assignment.item_count} items` : "—" },
    { label: "Section", value: sectionLabel(assignment.subject) },
    { label: "Countdown", value: countdown(assignment.due_at), countdown: true },
  ];

  // Numbered instruction steps (split on newlines, drop blanks).
  const steps = (assignment.instructions ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  function startUpload() { setUploadOpen(true); }
  function runAction() {
    if (action.mode === "upload") { setUploadOpen(true); return; }
    if (action.mode === "feedback") {
      document.getElementById("feedback-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <div className="mt-4 space-y-5" style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}>
      {/* HERO — type badge, title, meta tiles. (1:1 with homework.design.png) */}
      <Card pad="none" className="cr-card overflow-hidden">
        <div className="relative overflow-hidden bg-gradient-to-br from-primary to-primary-hover px-[34px] py-[30px] text-primary-foreground">
          <div aria-hidden className="pointer-events-none absolute -bottom-12 -right-8 h-52 w-52 rounded-full bg-white/[0.06]" />
          <div className="relative flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-[20px] bg-white/20 px-[13px] py-[5px] text-xs font-extrabold">{badgeLabel}</span>
            <SubmissionStatusPill status={status} />
          </div>
          <h1 className="relative my-[14px] text-[34px] font-extrabold leading-none tracking-[-0.025em]">{assignment.title}</h1>
          <div className="relative flex flex-wrap gap-x-[34px] gap-y-4">
            {tiles.map((t, i) => (
              <div key={t.label} className="cr-pillin" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] opacity-[0.72]">{t.label}</div>
                {t.countdown ? (
                  <div className="cr-daypop mt-[5px] inline-flex items-center gap-1.5 rounded-lg bg-white/[0.16] px-[11px] py-[3px] text-[15px] font-extrabold">
                    <Clock className="h-3.5 w-3.5" aria-hidden /> {t.value}
                  </div>
                ) : (
                  <div className="mt-[3px] text-[17px] font-extrabold">{t.value}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* INSTRUCTIONS — numbered steps (2-column). */}
        {steps.length > 0 && (
          <div className="px-[34px] pb-[30px] pt-[26px]">
            <h2 className="mb-4 text-base font-extrabold text-foreground">Instructions</h2>
            <ol className="grid gap-x-10 gap-y-3.5 sm:grid-cols-2">
              {steps.map((line, i) => (
                <li key={i} className="cr-rowin flex items-start gap-[15px]" style={{ animationDelay: `${i * 60}ms` }}>
                  <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-sm font-extrabold text-primary">{i + 1}</span>
                  <span className="pt-1 text-[16px] font-medium text-foreground">{line}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Card>

      {/* CONTENT LAUNCHER — one card per openable content (replaces the old "Next step"). */}
      {!isFile && (
        <div
          className={cn(
            "grid gap-3",
            actions.length === 2 ? "grid-cols-1 sm:grid-cols-2"
              : actions.length > 2 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              : "grid-cols-1",
          )}
        >
          {actions.map((c) => (
            <Card key={`${c.kind}-${c.href}`} className="cr-card cr-lift flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Pill tone="primary">{KIND_LABEL[c.kind]}</Pill>
              </div>
              <p className="flex-1 text-[15px] font-bold text-foreground">{c.name}</p>
              <Button
                className="cr-press cr-ripple"
                icon={c.mode === "review" ? Eye : Play}
                loading={c.startTestId != null && startingId === c.startTestId}
                onPointerDown={spawnRipple}
                onClick={() => {
                  // Only a fresh section POSTs a new attempt; resume/review follow href
                  // so a finished attempt is never overwritten.
                  if (c.mode === "start" && c.startTestId != null) return void startPastpaper(c.startTestId);
                  const href =
                    c.mode === "review" && c.kind === "PASTPAPER" && c.attemptId != null
                      ? `${c.href}?back=${encodeURIComponent(`${base}/assignments/${assignment.id}`)}`
                      : c.href;
                  router.push(href);
                }}
              >
                {c.mode === "review" ? "Review" : c.mode === "resume" ? "Resume" : "Start"}
              </Button>
            </Card>
          ))}
        </div>
      )}

      {/* FILE kind — completed banner / upload next-step, plus the upload panel. */}
      {isFile && (done ? (
        <Card className="cr-card border-emerald-500/30 bg-emerald-500/5">
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
        <Card className="cr-card">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next step</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-foreground">Upload your work as a file. Your teacher will review and grade it.</p>
            <Button
              size="lg"
              className="cr-press cr-ripple"
              icon={action.icon}
              onPointerDown={spawnRipple}
              onClick={action.mode === "feedback" ? runAction : startUpload}
            >
              {action.label}
            </Button>
          </div>
        </Card>
      ))}

      {/* File upload panel (FILE kind) */}
      {uploadOpen && isFile && (
        <UploadPanel classId={classId} assignmentId={assignment.id} my={my} onClose={() => setUploadOpen(false)} />
      )}

      {/* Teacher materials — links + attachments. (Instructions render as numbered
          steps in the hero above, so they're not repeated here.) */}
      {(assignment.attachment_file_url || (assignment.attachment_urls?.length) || assignment.external_url) && (
        <Card className="cr-card">
          <CardHeader title="Materials" />
          <div className="mt-3 space-y-2">
            {assignment.external_url && (
              <a href={assignment.external_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                <ExternalLink className="h-4 w-4" /> Open linked resource
              </a>
            )}
            {(assignment.attachment_urls ?? []).map((f, i) => {
              const name = f.file_name || decodeURIComponent(f.url.split("/").pop() || "") || "Attachment";
              const meta = materialMeta(name);
              const Icon = meta.Icon;
              const size = formatBytes(f.size);
              return (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 hover:bg-surface-2">
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", meta.iconWrap)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  {/* Click the name to open the file in a new tab. */}
                  <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      <span className={cn("rounded px-1 py-0.5 text-[9px] font-bold", meta.badge)}>{meta.label}</span>
                      {size ? <span className="ml-1.5">{size}</span> : null}
                    </p>
                  </a>
                  {/* Explicit download (same-origin /media ⇒ the download attribute saves the file). */}
                  <a
                    href={f.url}
                    download={name}
                    className="cr-press inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
                    aria-label={`Download ${name}`}
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                </div>
              );
            })}
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
