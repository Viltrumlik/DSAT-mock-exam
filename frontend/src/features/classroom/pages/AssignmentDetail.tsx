"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Clock, Upload, Play, RotateCcw, MessageSquare, CheckCircle2,
  FileText, ExternalLink, GraduationCap, X, Eye, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import VideoPlayer from "@/components/VideoPlayer";
import { normalizeApiError } from "@/lib/apiError";
import { Card, CardHeader, Button, Pill, LoadingState, ErrorState } from "../ui";
import { useClassroom } from "../hooks";
import { capabilitiesFor, type Capabilities } from "../capabilities";
import { useAssignment, useMySubmission, useSubmitHomework } from "../homeworkHooks";
import { assignmentKind, contentActions, homeworkAnalysisScope, KIND_LABEL, launcherLabel, type AssignmentDetail, type AssignmentKind, type MySubmission } from "../homeworkApi";
import { HomeworkQuestionStatistics } from "@/features/questionAnalysis/HomeworkQuestionStatistics";
import { MostMissed } from "@/features/teacher/mistakes";
import { spawnRipple } from "../ui/ripple";
import { examsStudentApi } from "@/features/examsStudent/api";
import { SubmissionStatusPill } from "./statusPill";
import { materialMeta, formatBytes } from "./materialMeta";
import {
  acceptAttribute, checkSubmissionBatch, fileExtension, fileIdentity, fileTypeList,
  resolveSubmissionLimits, sizeLabel,
} from "../submissionLimits";
import { describeManualShare, type ManualShare } from "../submissionsApi";
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
        ? <TeacherView base={base} assignment={a.data} caps={caps} />
        : <StudentView classId={classId} base={base} assignment={a.data} />}
    </div>
  );
}

function TeacherView({ base, assignment, caps }: { base: string; assignment: AssignmentDetail; caps: Capabilities }) {
  const router = useRouter();
  const kind = assignmentKind(assignment);
  // What there is to analyse: assessment sets, past papers, both, or — for an essay, a video
  // or a mock — neither, in which case no section is drawn at all rather than an empty card
  // apologising for itself on every such homework in the school.
  const scope = homeworkAnalysisScope(assignment);
  // The standalone console lives on the teacher portal, and the middleware there bounces
  // anything outside `/teacher/*`. Offered only from a render that can actually reach it.
  const fullAnalysisHref = base.startsWith("/teacher") ? "/teacher/question-analysis" : null;
  const isClasswork = String(assignment.category || "").toUpperCase() === "CLASSWORK";
  return (
    <div className="cr-section mt-4 space-y-5">
      <header>
        <div className="flex items-center gap-2">
          <Pill tone="primary">{isClasswork ? "Classwork" : KIND_LABEL[kind]}</Pill>
          {assignment.status === "DRAFT" && <Pill tone="neutral">Draft</Pill>}
          {assignment.status === "ARCHIVED" && <Pill tone="neutral">Archived</Pill>}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{assignment.title}</h1>
      </header>
      {assignment.instructions && (
        <Card className="cr-card"><CardHeader title="Instructions" /><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{assignment.instructions}</p></Card>
      )}
      {isClasswork ? (
        // Classwork is not in the gradebook — it has nothing to hand in and is not homework.
        // What a teacher does with it is give XP, which happens on the Classwork tab.
        <Card className="cr-card">
          <CardHeader title="XP" description="Classwork is not graded. You give XP for it on the Classwork tab." />
          <Button className="mt-4" icon={Sparkles} onClick={() => router.push(`${base}?tab=classwork`)}>
            Open Classwork
          </Button>
        </Card>
      ) : (
        <Card className="cr-card">
          <CardHeader title="Grading" description={assignment.category === "HOMEWORK" || kind === "FILE" ? "Manual grading" : "Auto-graded"} />
          {assignment.status === "DRAFT" ? (
            // A draft reaches no student, so nothing on it can be handed in or graded yet. A button into
            // the gradebook opened a list that leaves the draft out or counts the whole class as missing
            // it; say what comes first instead.
            <p className="mt-4 text-sm text-muted-foreground">
              Students cannot see a draft, so there is nothing to grade yet. You publish it on the Assignments tab.
            </p>
          ) : (
            // Straight to this homework's grades. The gradebook's list leaves archived homework out, so on an
            // archived homework's page the list alone was a dead end.
            <Button className="mt-4" icon={GraduationCap} onClick={() => router.push(`${base}?tab=grading&assignment=${assignment.id}`)}>
              Open in gradebook
            </Button>
          )}
        </Card>
      )}
      {/* What the class got wrong most, worst first, and a pop-up to read any of those
          questions in full and work it — the owner asked for this inside the homework, where a
          teacher already is, rather than on a console page they never open. It leads the
          statistics below it: the ranked five are the work, the breakdowns are the reference.

          Gated on the CAPABILITY, not on this branch. `AssignmentDetail` is the same page on
          the student route and the teacher route, and a row here carries a question prompt
          while the pop-up behind it carries the recorded answer key. Reading the capability
          means a future refactor that moves this render cannot quietly open it to a class. */}
      {caps.canViewClassAnalytics && scope.hasAny && (
        <MostMissed
          assignmentId={assignment.id}
          hasAssessments={scope.hasAssessments}
          hasPastPapers={scope.hasPastPapers}
        />
      )}
      {/* Staff only, and only from this branch. The flagged cards carry question prompts,
          recorded answer keys and exactly which questions the class fell over — none of which
          a student may read, least of all one who can still hand this homework in. */}
      {caps.canViewClassAnalytics && scope.hasAny && (
        <HomeworkQuestionStatistics
          assignmentId={assignment.id}
          hasAssessments={scope.hasAssessments}
          hasPastPapers={scope.hasPastPapers}
          pastPaperCount={scope.pastPaperCount}
          fullAnalysisHref={fullAnalysisHref}
        />
      )}
    </div>
  );
}

const pct = (n: number) => `${+n.toFixed(2)}%`;

/**
 * The number in the student's Feedback pill.
 *
 * On homework where the teacher's mark carries only a share of the grade, `review.grade` is that
 * mark and nothing more: with a 20% share, a teacher's 50 sits inside a grade the server composed
 * as 90. Drawing the mark here printed a bare "50" — no denominator, no share, and a different
 * number from the one the teacher's own screens were served. So once a share exists, the raw mark
 * never stands in for the grade again; the whole number, or an honest word about why there isn't
 * one yet, takes its place. The arithmetic is the server's and is never redone here.
 */
function gradePill(
  review: NonNullable<MySubmission["review"]>,
  share: ManualShare | null,
  tone: "success" | "warning",
) {
  if (share) {
    if (share.unavailable) return <Pill tone="warning">Total unavailable</Pill>;
    if (share.awaiting) return <Pill tone="warning">Waiting on your teacher&apos;s mark</Pill>;
    if (share.percent != null) return <Pill tone={tone}>{pct(share.percent)}</Pill>;
    // No composed number and nothing owed: the share is 0 AND nothing on the homework is graded
    // automatically, so the composition has nothing to add up. The mark below is the only number
    // there is, and it is what this page showed before the share existed — dropping the pill
    // here would blank the score under a line that says the score is shown above.
  }
  if (review.grade == null) return undefined;
  return (
    <Pill tone={tone}>
      {review.grade}{review.max_score ? `/${review.max_score}` : ""}
      {review.is_auto ? " · Auto" : ""}
    </Pill>
  );
}

/** Where the student's grade came from, said under the pill that shows it. */
function GradeBreakdown({ share }: { share: ManualShare }) {
  if (share.unavailable) {
    return (
      <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
        Your teacher&apos;s mark is saved and it counts. It is only the single number adding it to the
        automatically graded part that could not be worked out here — ask your teacher for the total.
      </p>
    );
  }
  // A review that carries no weight is worth saying out loud: the student is looking at a mark
  // and a grade that will not move with it, and silence here reads as the mark having counted.
  if (share.manualWeight === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        This grade is worked out automatically. Your teacher&apos;s comments are theirs, and they do
        not change the number.
      </p>
    );
  }
  // A share of 100 has no split to explain — the pill above is wholly the teacher's mark.
  if (share.automaticWeight === 0) return null;
  // The mark comes from the composition, never from `review.grade`: on a review the platform
  // wrote itself that key holds the automatic score, and printing it here would credit the
  // teacher with a number they never typed.
  const mark = share.manualPercent != null ? ` Your teacher marked it ${pct(share.manualPercent)}.` : "";
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Your teacher&apos;s mark is worth {share.manualWeight}% of this grade; the other{" "}
      {share.automaticWeight}% is graded automatically
      {share.automaticPercent != null ? ` and stands at ${pct(share.automaticPercent)}` : ""}.
      {mark}
    </p>
  );
}

/**
 * The part of the grade that is already decided, before the teacher has marked anything.
 *
 * Vocabulary mastered on Monday settles the automatic side immediately; the upload slot may not
 * be used until Friday. The server composes and serves that number with no submission row at all
 * — this is the screen that finally shows it, instead of leaving the student to guess.
 */
function SettledSoFar({ share }: { share: ManualShare }) {
  return (
    <Card>
      <CardHeader
        title="Part of this grade is already decided"
        actions={<Pill tone="info">{pct(share.automaticPercent as number)} so far</Pill>}
      />
      <p className="mt-2 text-sm text-muted-foreground">
        The automatically graded {share.automaticWeight}% of this homework is settled at{" "}
        {pct(share.automaticPercent as number)}. The remaining {share.manualWeight}% is your
        teacher&apos;s mark, and they are still checking your work — this grade can only go up.
      </p>
    </Card>
  );
}

function StudentView({ classId, base, assignment }: { classId: number; base: string; assignment: AssignmentDetail }) {
  const router = useRouter();
  const sub = useMySubmission(classId, assignment.id);
  const kind = assignmentKind(assignment);
  const my = sub.data ?? null;
  const status = my?.workflow_status ?? my?.status ?? null;
  const done = status === "REVIEWED";
  // Null on nearly every homework — only one that gives the teacher's mark a share of the grade
  // composes at all. `my` itself can be a response with no submission in it, carrying this key
  // and nothing else, so it is read off `my` rather than off the review.
  const share = describeManualShare(my?.composed_grade);
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
  /**
   * Classwork is work the class already did, in the room. It has no deadline by rule (the
   * form refuses to set one), nothing to hand in, and no automatic score — the teacher's XP
   * is the whole of the outcome. The Classwork tab links here now, so this page has to stop
   * treating it as homework that happens to have a null `due_at`.
   */
  const isClasswork = String(assignment.category || "").toUpperCase() === "CLASSWORK";
  // Students may upload a file whenever the teacher allowed it (independent of any
  // pastpaper/assessment) — or when there's no auto-graded content at all. Classwork is the
  // exception: "no content to open" is its NORMAL shape (a written brief, a couple of
  // links), so the fallback would offer every such lesson a submission box for work that was
  // already done in class and that nothing on the platform grades.
  const canUpload =
    Boolean((assignment as { allow_file_upload?: boolean }).allow_file_upload) ||
    (actions.length === 0 && !isClasswork);
  const badgeLabel = isClasswork ? "Classwork" : actions.length > 1 ? "Bundle" : KIND_LABEL[kind];

  // Meta tiles (design's hero row): label + value, animated with stagger.
  const tiles: { label: string; value: string; countdown?: boolean }[] = isClasswork
    ? [
        { label: "In class", value: shortDate(assignment.assigned_at ?? assignment.created_at ?? assignment.published_at) },
        { label: "Section", value: sectionLabel(assignment.subject) },
        // Null and `{points: 0}` are different answers and stay different: null is "no
        // teacher has looked at this yet", zero is "a teacher marked it". Never test
        // `points > 0` to decide whether an award exists.
        {
          label: "XP",
          value:
            assignment.classwork_award == null
              ? "Not marked yet"
              : assignment.classwork_award.points > 0
                ? `+${assignment.classwork_award.points}`
                : "Reviewed",
        },
      ]
    : [
        { label: "Assigned", value: shortDate(assignment.assigned_at ?? assignment.created_at ?? assignment.published_at) },
        { label: "Due", value: assignment.due_at ? shortDate(assignment.due_at) : "No deadline" },
        { label: "Section", value: sectionLabel(assignment.subject) },
        { label: "Countdown", value: countdown(assignment.due_at), countdown: true },
      ];

  // Numbered instruction steps (split on newlines, drop blanks).
  const steps = (assignment.instructions ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const lessonVideo = assignment.video_file_url || assignment.video_url || "";

  // Instructions block, reused by both the video-first and the standard hero layouts.
  const instructionsBlock =
    steps.length > 0 ? (
      <div className="px-[34px] pb-[30px] pt-[22px]">
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
    ) : null;

  function startUpload() { setUploadOpen(true); }
  function runAction() {
    if (action.mode === "upload") { setUploadOpen(true); return; }
    if (action.mode === "feedback") {
      document.getElementById("feedback-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <div className="mt-4 space-y-5" style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}>
      {lessonVideo ? (
        /* VIDEO-FIRST — the lesson video is big and fills the top of the card; only the
           title + deadline sit between it and the instructions (the meta tiles are dropped).
           One connected card: video → title/deadline → instructions. */
        <Card pad="none" className="cr-card overflow-hidden">
          <VideoPlayer url={lessonVideo} />
          <div className="flex flex-wrap items-center justify-between gap-3 px-[34px] pt-[24px]">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.025em] text-foreground">{assignment.title}</h1>
            {/* Classwork has no deadline by rule, so a countdown chip could only ever read
                "No deadline" — a clock next to work that was already done in class. It gets
                its XP instead, which is the only outcome classwork has. */}
            {isClasswork ? (
              <div className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-[12px] py-[6px] text-[14px] font-extrabold text-primary">
                <Sparkles className="h-4 w-4" aria-hidden />
                {assignment.classwork_award == null
                  ? "Not marked yet"
                  : assignment.classwork_award.points > 0
                    ? `+${assignment.classwork_award.points} XP`
                    : "Reviewed"}
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-[12px] py-[6px] text-[14px] font-extrabold text-primary">
                <Clock className="h-4 w-4" aria-hidden /> {countdown(assignment.due_at)}
              </div>
            )}
          </div>
          {instructionsBlock}
        </Card>
      ) : (
        /* No video → the standard blue hero (title + meta tiles), unchanged. */
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
          {instructionsBlock}
        </Card>
      )}

      {/* CONTENT LAUNCHER — one card per openable content (replaces the old "Next step"). */}
      {actions.length > 0 && (
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
                {launcherLabel(c)}
              </Button>
            </Card>
          ))}
        </div>
      )}

      {/* STUDENT FILE SUBMISSION — shown whenever the teacher allows uploads; can
          coexist with a pastpaper/assessment launcher above (manual + auto grading). */}
      {canUpload && (done ? (
        <Card className="cr-card border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">File submitted</p>
              <p className="text-xs text-muted-foreground">Your teacher will review and grade it — see feedback below.</p>
            </div>
            <Button variant="secondary" icon={MessageSquare} onClick={runAction}>Feedback</Button>
          </div>
        </Card>
      ) : (
        <Card className="cr-card">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Turn in your work</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-foreground">Upload a file for your teacher to review and grade.</p>
            <Button
              size="lg"
              className="cr-press cr-ripple"
              icon={Upload}
              onPointerDown={spawnRipple}
              onClick={startUpload}
            >
              Upload work
            </Button>
          </div>
        </Card>
      ))}

      {/* File upload panel */}
      {uploadOpen && canUpload && (
        <UploadPanel
          classId={classId}
          assignmentId={assignment.id}
          my={my}
          // What this submission may carry, as the server reports it on the assignment.
          limits={assignment.submission_limits}
          onClose={() => setUploadOpen(false)}
        />
      )}

      {/* Teacher materials — links + attachments. (Instructions render as numbered
          steps in the hero above, so they're not repeated here.) */}
      {(assignment.attachment_file_url ||
        (assignment.attachment_urls?.length) ||
        assignment.external_urls?.length ||
        assignment.external_url) && (
        <Card className="cr-card">
          <CardHeader title="Materials" />
          <div className="mt-3 space-y-2">
            {/* Prefer the multi `external_urls` list; fall back to the legacy single link.
                Each link shows the name its teacher gave it, or the URL when unnamed. */}
            {(assignment.external_urls?.length
              ? assignment.external_urls.map((url, i) => ({
                  url,
                  label: assignment.external_url_labels?.[i] ?? "",
                }))
              : assignment.external_url
                ? [{ url: assignment.external_url, label: "" }]
                : []
            ).map((link, i) => (
              <a key={i} href={link.url} target="_blank" rel="noreferrer"
                title={link.label ? link.url : undefined}
                className="flex items-center gap-2 text-sm text-primary hover:underline">
                <ExternalLink className="h-4 w-4 shrink-0" />
                <span className="truncate">{link.label || link.url}</span>
              </a>
            ))}
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
              actions={gradePill(my.review, share, status === "RETURNED" ? "warning" : "success")}
            />
            {status === "RETURNED" && my.return_note && (
              <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{my.return_note}</p>
            )}
            {share && <GradeBreakdown share={share} />}
            {my.review.feedback ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{my.review.feedback}</p>
            ) : status === "REVIEWED" && (
              <p className="mt-2 text-sm text-muted-foreground">No written feedback — your score is shown above.</p>
            )}
          </Card>
        ) : share && share.awaiting && !share.unavailable
            && share.automaticWeight > 0 && share.automaticPercent != null ? (
          // `automaticWeight > 0` is load-bearing: where the teacher's mark is the whole grade,
          // an automatic score can still be recorded and it carries nothing. Calling that number
          // "already decided" would promise a student a part of their grade that does not exist.
          <SettledSoFar share={share} />
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

function UploadPanel({ classId, assignmentId, my, limits: served, onClose }: {
  classId: number; assignmentId: number; my: MySubmission | null;
  limits?: AssignmentDetail["submission_limits"]; onClose: () => void;
}) {
  const submit = useSubmitHomework(classId, assignmentId);
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const limits = useMemo(() => resolveSubmissionLimits(served), [served]);
  // Files already on this submission hold slots against the count: a resubmit adds to what is
  // there rather than replacing it, and the server counts attached plus arriving. The batch total
  // is the queued files alone — what is already stored does not travel again.
  const attached = my?.files?.length ?? 0;
  const check = useMemo(() => checkSubmissionBatch(files, attached, limits), [files, attached, limits]);

  /**
   * A second pick ADDS to the queue.
   *
   * An operating-system picker only reaches into one folder at a time, so "four images and six
   * PDFs" is naturally two trips. Replacing the list on the second trip threw the first four away
   * without a word, and the student found out when their teacher did.
   */
  function addPicked(picked: FileList | null) {
    setErr(null);
    const incoming = Array.from(picked ?? []);
    if (incoming.length === 0) return;
    setFiles((current) => {
      const seen = new Set(current.map(fileIdentity));
      const added: File[] = [];
      for (const f of incoming) {
        const id = fileIdentity(f);
        if (seen.has(id)) continue;
        seen.add(id);
        added.push(f);
      }
      return added.length > 0 ? [...current, ...added] : current;
    });
  }

  function removeAt(index: number) {
    setErr(null);
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  async function send() {
    setErr(null);
    if (files.length === 0) return setErr("Choose at least one file to turn in.");
    // Stop here rather than at the end of the upload: the server applies these same limits, but
    // only once every byte has already gone over the wire — and the proxy in front of it answers
    // an oversized body with an HTML page no student can read.
    if (check.problem) return setErr(check.problem);
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
        <input
          ref={inputRef}
          type="file"
          multiple
          // A hint to the file dialog, which usually offers "All files" anyway — the real check
          // is `checkSubmissionBatch`, because the server refuses the whole batch on one bad file.
          accept={acceptAttribute(limits)}
          className="hidden"
          onChange={(e) => {
            addPicked(e.target.files);
            // Clearing the input lets the same file fire `change` again, so a file removed by
            // mistake can be picked straight back.
            e.target.value = "";
          }}
        />
        <button onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-6 text-sm text-muted-foreground hover:bg-surface-2">
          <Upload className="h-4 w-4" /> {files.length > 0 ? "Add more files" : "Choose files"}
        </button>
        <p className="text-xs text-muted-foreground">
          Pick from one folder then another — everything you choose is kept. Up to{" "}
          {limits.maxFiles} files in a submission, {sizeLabel(limits.maxFileBytes)} per file,
          {" "}{sizeLabel(limits.maxBatchBytes)} in one upload.
          {attached > 0 && (
            ` ${attached} ${attached === 1 ? "file is" : "files are"} already turned in and will stay.`
          )}
        </p>
        <p className="text-xs text-muted-foreground">Files that work: {fileTypeList(limits)}.</p>
        {files.length > 0 && (
          <ul className="space-y-2">
            {files.map((f, i) => {
              const meta = materialMeta(f.name);
              const Icon = meta.Icon;
              const over = check.tooBig.includes(f);
              const wrongKind = check.disallowed.includes(f);
              // Either one loses the whole batch at the server, so both read the same here: this
              // is the file to swap out before pressing Submit.
              const flagged = over || wrongKind;
              return (
                <li
                  key={fileIdentity(f)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5",
                    flagged
                      ? "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/15"
                      : "border-border",
                  )}
                >
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", meta.iconWrap)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{f.name}</span>
                    <span className={cn(
                      "block text-[11px]",
                      flagged ? "text-amber-700 dark:text-amber-200" : "text-muted-foreground",
                    )}>
                      <span className={cn("rounded px-1 py-0.5 text-[9px] font-bold", meta.badge)}>{meta.label}</span>
                      <span className="ml-1.5">{sizeLabel(f.size)}</span>
                      {wrongKind && (
                        <span className="ml-1.5">· {fileExtension(f.name) || "this kind"} isn’t taken here</span>
                      )}
                      {over && <span className="ml-1.5">· over {sizeLabel(limits.maxFileBytes)}</span>}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    aria-label={`Remove ${f.name}`}
                    className="cr-press inline-flex shrink-0 items-center justify-center rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {files.length > 0 && (
          <p className="text-xs font-medium text-muted-foreground">
            {files.length} {files.length === 1 ? "file" : "files"} ready ·{" "}
            {sizeLabel(check.totalBytes)} of {sizeLabel(limits.maxBatchBytes)}
            {attached > 0 && ` · ${check.totalFiles} of ${limits.maxFiles} files in all`}
          </p>
        )}
        {check.problem && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200">
            {check.problem}
          </p>
        )}
        <Button block loading={submit.isPending} disabled={files.length === 0} onClick={send}>Submit homework</Button>
      </div>
    </Card>
  );
}
