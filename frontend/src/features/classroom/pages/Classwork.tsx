"use client";

/**
 * What the class did in the room, and the points a teacher recorded for it.
 *
 * A separate surface rather than a student-shaped Lessons tab, deliberately. The lesson
 * plan endpoints are staff-gated server-side (`deny_unless_staff` on both the plan and the
 * detail route), so un-gating that tab would render a 403 for every student; and the plan
 * is the teaching team's working document — timings, validation warnings, which items are
 * still unapproved — none of which a student should read. The carrier Assignment, by
 * contrast, is exactly the authored block the class was given, and every member can
 * already read it.
 *
 * Classwork has no deadline and nothing to hand in, so there is no submission state here
 * and never a "you are late". The teacher's award is the whole of the outcome.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ExternalLink, Paperclip, Plus, Presentation, Sparkles } from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import { buttonClassName, Card, CardHeader, EmptyState, ErrorState, LoadingState, Pill } from "../ui";
import { capabilitiesFor } from "../capabilities";
import { useStudentClasswork } from "../classworkHooks";
import type { StudentClasswork, StudentClassworkAward } from "../classworkApi";
import type { ClassroomWithRole } from "../types";

/**
 * Base path for this classroom's routes. The teacher portal is scoped by middleware to
 * `/teacher/*`, so a `/classes/...` link there bounces to the dashboard. Same rule the
 * Assignments page follows; it keeps its own copy of this helper, which is where the
 * shared one should eventually live.
 */
function useClassBase(classId: number): string {
  const pathname = usePathname() || "";
  return pathname.startsWith("/teacher/")
    ? `/teacher/classrooms/${classId}`
    : `/classes/${classId}`;
}

function givenOn(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The student's outcome for one classwork. Encouraging in every branch, including zero. */
function AwardLine({
  award,
  isStudent,
}: {
  award: StudentClassworkAward | null;
  isStudent: boolean;
}) {
  if (!isStudent) {
    // Staff have no award of their own — `classwork_award` is always null for them, and
    // showing them a student's waiting-message would be a lie about their own state.
    return <span className="text-xs text-muted-foreground">Each student sees their own points here.</span>;
  }
  if (award == null) {
    return <Pill tone="neutral">Your teacher adds points after the lesson</Pill>;
  }
  return (
    <Pill tone="success">
      <Sparkles className="mr-1 h-3 w-3" aria-hidden />
      {/* A recorded zero is not "nothing yet" — it is a teacher who looked. Say that, and
          never dress it up as a score the student lost. */}
      {award.points > 0 ? `+${award.points} points` : "Reviewed by your teacher"}
    </Pill>
  );
}

function ClassworkCard({ row, classBase, isStudent }: { row: StudentClasswork; classBase: string; isStudent: boolean }) {
  const date = givenOn(row.assigned_at);
  const activities = row.contents.length + row.vocabulary.length;
  return (
    <Card>
      <CardHeader
        title={row.title || "Classwork"}
        description={date ? `In class · ${date}` : "In class"}
        actions={<AwardLine award={row.award} isStudent={isStudent} />}
      />

      {row.award?.note && (
        <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-foreground">
          {row.award.note}
        </p>
      )}

      {row.instructions && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{row.instructions}</p>
      )}

      {row.external_urls.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {row.external_urls.map((url, i) => (
            <li key={i}>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-2 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{url}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {row.files.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {row.files.map((file, i) => (
            <li key={i}>
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-2 text-sm text-primary hover:underline"
              >
                <Paperclip className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{file.file_name || "Lesson file"}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {row.video_url && (
        <div className="mt-3 max-w-md">
          <VideoPlayer url={row.video_url} />
        </div>
      )}

      {activities > 0 && (
        <>
          <ul className="mt-3 divide-y divide-border">
            {row.contents.map((c, i) => (
              <li key={`c-${i}`} className="flex items-center gap-3 py-2.5">
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.title}</span>
                {c.item_count != null && c.item_count > 0 && (
                  <span className="shrink-0 text-xs text-muted-foreground">{c.item_count} questions</span>
                )}
              </li>
            ))}
            {row.vocabulary.map((v) => (
              <li key={`v-${v.set_id}`} className="flex items-center gap-3 py-2.5">
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{v.set_title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{v.word_count} words</span>
              </li>
            ))}
          </ul>
          {/* One link out, to the launcher that already deep-links into every bundled
              activity — rather than a per-activity route this page would have to keep in
              step with the assignment detail page. */}
          <Link href={`${classBase}/assignments/${row.id}`} className={buttonClassName({ variant: "secondary", size: "sm", className: "mt-3" })}>
            Open activities
          </Link>
        </>
      )}
    </Card>
  );
}

export function Classwork({ classroom }: { classroom: ClassroomWithRole }) {
  const classId = Number(classroom.id);
  const caps = capabilitiesFor(classroom.my_role);
  const classBase = useClassBase(classId);
  const { rows, isLoading, isError, refetch } = useStudentClasswork(classId);

  return (
    <div className="cr-section space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-[28px]">Classwork</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {caps.isStudent
              ? "What you worked on in class, and the points your teacher recorded"
              : "In-class work. No deadline — you award the points yourself."}
          </p>
        </div>
        {/* Authoring lives here rather than beside "New homework" on Assignments: the two
            are different kinds of work with different rules, and the section a teacher is
            standing in is the one that should offer to add to it. */}
        {caps.canManageAssignments && (
          <Link href={`${classBase}/assignments/new?kind=classwork`}>
            <button type="button" className={buttonClassName({ variant: "primary" })}>
              <Plus className="h-4 w-4" aria-hidden /> New classwork
            </button>
          </Link>
        )}
      </div>

      {isLoading ? (
        <LoadingState label="Loading classwork…" />
      ) : isError ? (
        // A failed fetch is never "no classwork yet" — that would tell a student their
        // lessons were never given.
        <ErrorState
          title="Classwork not available"
          message="We couldn't load this class's work just now."
          onRetry={refetch}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Presentation}
          title="No classwork yet"
          description={
            caps.isStudent
              ? "Work you do during lessons shows up here, along with the points your teacher gives you."
              : "Add classwork here, or give a lesson's classwork from the Lessons tab — both appear in this list."
          }
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <ClassworkCard key={row.id} row={row} classBase={classBase} isStudent={caps.isStudent} />
          ))}
        </div>
      )}
    </div>
  );
}
