"use client";

/**
 * The Grading tab's third level: what one student turned in, and the place to mark it.
 *
 * The two levels above this one — the homework, then the class list on it — could take a grade
 * without ever showing the work it was for, so the mark was entered blind. This is the only
 * screen in the classroom that draws the uploaded pdf or jpg, and the only place the manual
 * share is explained, because it is the only place the manual mark is entered.
 *
 * The file is drawn IN the page at the size of the page — the image inline, the pdf in its
 * viewer — with the open-in-a-new-tab link kept for what a browser will not render. The three
 * kinds are decided by `lib/homeworkFileDisplay`, the same helpers every other file tile uses,
 * so "this is a pdf" cannot come to mean two different things in two places.
 */

import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, FileText, Inbox, Paperclip, Bot, User2 } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { fileNameFromUrl, isImageMimeOrName, isPdfMimeOrName } from "@/lib/homeworkFileDisplay";
import { Card, CardHeader, Button, Pill, EmptyState, LoadingState, ErrorState } from "../ui";
import type { AssignmentMeta, RosterRow } from "../gradebookApi";
import { useSubmittedWork } from "../submissionsHooks";
import {
  describeManualShare,
  nextStudentIn,
  previousStudentIn,
  submissionFor,
  type ManualShare,
  type SubmissionAttempt,
  type SubmissionFile,
} from "../submissionsApi";
import { STATUS_META } from "./gradebookStatus";
import { GradeForm } from "./GradeForm";

function fileLabel(f: SubmissionFile): string {
  return (f.file_name || fileNameFromUrl(f.url) || "File").trim() || "File";
}

function OneFile({ file }: { file: SubmissionFile }) {
  const name = fileLabel(file);
  const mime = file.file_type ?? "";
  const image = isImageMimeOrName(mime, name);
  const pdf = !image && isPdfMimeOrName(mime, name);

  return (
    <figure className="m-0 overflow-hidden rounded-xl border border-border">
      <figcaption className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2">
        {pdf ? <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> : <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
        <span className="min-w-0 flex-1 break-words text-xs font-semibold text-foreground">{name}</span>
        <a href={file.url} target="_blank" rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline">
          Open <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </figcaption>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.url} alt={`Work turned in: ${name}`} loading="lazy"
          className="block max-h-[38rem] w-full bg-surface-2 object-contain" />
      ) : pdf ? (
        <iframe src={file.url} title={name} className="block h-[38rem] w-full border-0 bg-surface-2" />
      ) : (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          This kind of file can&apos;t be shown here. Open it to read the work.
        </p>
      )}
    </figure>
  );
}

function AttemptCard({ attempt }: { attempt: SubmissionAttempt }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <p className="text-sm font-semibold text-foreground">
        {attempt.practice_test_name || attempt.practice_test_title || "Practice test"}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Attempt #{attempt.id}
        {attempt.is_completed ? " · finished" : " · still open"}
        {attempt.score != null ? ` · scored ${attempt.score}` : ""}
      </p>
    </div>
  );
}

const pct = (n: number) => `${+n.toFixed(2)}%`;

/**
 * What the teacher's mark is worth, said where they type it.
 *
 * Every state `composed_grade` can report has somewhere to appear here: the share the teacher
 * set, the share that was flipped to 100 because nothing on the homework is auto-graded, a share
 * of 0, and the composition that could not be read — which says so rather than showing a blank
 * where a number belongs.
 */
function ManualShareNote({ share }: { share: ManualShare }) {
  const frame = "rounded-lg border border-border bg-card p-3";

  if (share.unavailable) {
    return (
      <div className={frame}>
        <p className="text-sm font-semibold text-foreground">The combined grade couldn&apos;t be read</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your mark still saves and still counts. It is only the single number adding it to the automatic
          part that is missing here.
        </p>
      </div>
    );
  }

  if (share.automaticWeight === 0) {
    return (
      <div className={frame}>
        <p className="text-sm font-semibold text-foreground">Your mark is the whole grade.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {share.automaticPercent == null
            ? "Nothing on this homework is graded automatically, so the grade is exactly what you enter."
            : "The full 100% is yours to award."}
        </p>
      </div>
    );
  }

  if (share.manualWeight === 0) {
    return (
      <div className={frame}>
        <p className="text-sm font-semibold text-foreground">This grade is worked out automatically.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your review reaches the student, and it does not change the number.
          {share.percent != null ? ` The homework stands at ${pct(share.percent)}.` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className={frame}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">
          Your mark is worth {share.manualWeight}% of this grade.
        </p>
        {share.awaiting
          ? <Pill tone="warning">Waiting on your mark</Pill>
          : <Pill tone="success">Marked</Pill>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        The other {share.automaticWeight}% is graded automatically
        {share.automaticPercent != null ? `, and it is already settled at ${pct(share.automaticPercent)}.` : "."}
        {share.awaiting && share.percent != null
          ? ` That puts the homework at ${pct(share.percent)} so far — it can only go up once your mark goes in.`
          : ""}
        {!share.awaiting && share.percent != null
          ? ` With your mark, the homework stands at ${pct(share.percent)}.`
          : ""}
      </p>
    </div>
  );
}

export function StudentWork({
  classId,
  assignment,
  row,
  students,
  readOnly,
  onBack,
  onOpenStudent,
}: {
  classId: number;
  assignment: AssignmentMeta;
  /** The student being marked. Read from the whole class list, so a filter cannot hide them. */
  row: RosterRow;
  /** The class list as the teacher has it filtered — the walk from one student to the next. */
  students: RosterRow[];
  readOnly: boolean;
  onBack: () => void;
  onOpenStudent: (studentId: number) => void;
}) {
  // A student the class list calls "not turned in" has nothing here to read — including one
  // whose row is a DRAFT the upload panel opened, which carries files the student has not handed
  // over. Drawing those would have this level contradict the one above it, and the work would
  // sit under a "Not turned in" chip. Nothing is read for them either.
  const turnedIn = row.status !== "MISSING";
  const { data, isLoading, isError, refetch } = useSubmittedWork(classId, assignment.id, turnedIn);

  const submission = data ? submissionFor(data, { submissionId: row.submission_id, studentId: row.student_id }) : null;
  const share = describeManualShare(submission?.composed_grade);
  const meta = STATUS_META[row.status];
  // The same rule the class list grades by: manual work, turned in, on homework that is not
  // archived. Opening a student changes what the teacher can SEE, never what they may do.
  const canGrade = !readOnly && !assignment.is_auto_graded && turnedIn && submission != null;

  const ids = students.map((s) => s.student_id);
  const at = ids.indexOf(row.student_id);
  const next = nextStudentIn(ids, row.student_id);
  const previous = previousStudentIn(ids, row.student_id);

  const nothingIn = (
    <EmptyState icon={Inbox} title="Not turned in yet" description={`Nothing has come in from ${row.name} for this homework.`} />
  );

  let body: React.ReactNode;
  if (!turnedIn) {
    body = nothingIn;
  } else if (isLoading) {
    body = <LoadingState label="Opening the work…" />;
  } else if (isError) {
    // Never the empty state: a read that failed is not a student who handed nothing in, and the
    // difference decides whether a teacher chases the student or the teacher retries.
    body = <ErrorState title="The work didn't load" message="Nothing has been lost. Try again." onRetry={() => refetch()} />;
  } else if (!submission) {
    // The class list counted them in and the work is not in the answer: the list is the older of
    // the two reads, so this says what the newer one found rather than showing a blank panel.
    body = nothingIn;
  } else {
    const files = submission.files ?? [];
    body = (
      <div className="space-y-3">
        {submission.attempt && <AttemptCard attempt={submission.attempt} />}
        {submission.return_note && (
          <p className="text-xs text-muted-foreground">
            Sent back for another go: “{submission.return_note}”
          </p>
        )}
        {files.length === 0 ? (
          // A homework that locks file upload is turned in as the attempt above, so no file is
          // the normal state there and must not read as a student who handed in nothing.
          <p className="text-sm text-muted-foreground">
            {submission.attempt
              ? "No files with this one — the work is the test attempt above."
              : "Nothing was uploaded with this one."}
          </p>
        ) : (
          files.map((f, i) => <OneFile key={f.id ?? `${f.url}-${i}`} file={f} />)
        )}
        {canGrade && (
          // Keyed on the student: walking to the next one must not carry the last one's score or
          // the words written for them into the next student's form.
          <GradeForm
            key={row.student_id}
            classId={classId}
            assignmentId={assignment.id}
            submissionId={submission.id}
            studentName={row.name}
            maxScore={row.max_score ?? assignment.max_score}
            initialScore={row.grade}
          >
            {share && <ManualShareNote share={share} />}
          </GradeForm>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* The way back names where it goes, from a level the teacher reached in two clicks. */}
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {assignment.title}
      </button>
      <Card>
        <CardHeader
          title={
            <span className="flex min-w-0 items-center gap-2">
              <Avatar src={row.profile_image_url} name={row.name} size={26} />
              <span className="min-w-0 truncate">{row.name}</span>
            </span>
          }
          description={at >= 0 ? `${at + 1} of ${students.length} in this view` : `${students.length} in this view`}
          actions={
            <>
              {row.status === "GRADED" && row.grade != null && (
                <span className="text-sm font-semibold text-foreground">
                  {row.grade}{row.max_score ? `/${row.max_score}` : assignment.max_score ? `/${assignment.max_score}` : ""}
                </span>
              )}
              {row.status === "GRADED" && row.source === "AUTO" && <Pill tone="primary"><Bot className="h-3 w-3" /> Auto</Pill>}
              {row.status === "GRADED" && row.source === "TEACHER" && <Pill tone="neutral"><User2 className="h-3 w-3" /> Teacher</Pill>}
              {row.status !== "GRADED" && <Pill tone={meta.tone}>{meta.label}</Pill>}
            </>
          }
        />
        <div className="mt-4">{body}</div>
        {/* Below the mark, where a teacher working down a class of thirty ends up — and outside
            every branch above, so a piece of work that would not load is still not a dead end. */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button size="sm" variant="secondary" icon={ChevronLeft}
            disabled={previous == null} onClick={() => previous != null && onOpenStudent(previous)}>
            Previous
          </Button>
          <Button size="sm" variant="secondary" iconRight={ChevronRight}
            disabled={next == null} onClick={() => next != null && onOpenStudent(next)}>
            Next student
          </Button>
        </div>
      </Card>
    </div>
  );
}
