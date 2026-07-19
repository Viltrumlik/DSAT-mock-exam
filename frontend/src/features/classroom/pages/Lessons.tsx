"use client";

/**
 * The teacher's lesson plan for one classroom.
 *
 * The admin authors a Journal per (subject, level); this is where a teacher delivers it.
 * A lesson opens into two panels that mirror the admin editor — Homework (hand it out)
 * and Classwork (the in-room timetable, with a button per item to open it to the class).
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  GraduationCap,
  Timer,
} from "lucide-react";
import { midtermApi } from "@/lib/midtermApi";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Button, Card, CardHeader, EmptyState, ErrorState, LoadingState, Pill, Tabs } from "../ui";
import { capabilitiesFor } from "../capabilities";
import { classroomKeys } from "../queryKeys";
import {
  useGrantItem,
  useGrantMidterm,
  useLessonDetail,
  useLessonPlan,
  useReleaseHomework,
  useRescheduleLessons,
  useRevokeGrant,
} from "../lessonsHooks";
import type { LessonItem, LessonRow } from "../lessonsApi";
import type { ClassroomWithRole } from "../types";

function formatDate(iso: string | null): string {
  if (!iso) return "No date";
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function itemLabel(item: LessonItem): string {
  if (item.title) return item.title;
  if (item.resource_type === "practice_test") return `Past paper #${item.resource_id}`;
  if (item.resource_type === "practice_test_pack") return `Pack #${item.resource_id}`;
  return `Assessment #${item.resource_id}`;
}

/** One openable item + its "give the class access" button. */
function ItemRow({
  item,
  classId,
  lessonId,
  disabled,
  grantId,
}: {
  item: LessonItem;
  classId: number;
  lessonId: number;
  disabled: boolean;
  /** Present once the item has been opened — lets the teacher undo a mis-press. */
  grantId?: number;
}) {
  const grant = useGrantItem(classId, lessonId);
  const revoke = useRevokeGrant(classId, lessonId);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{itemLabel(item)}</span>
      {item.given ? (
        <span className="flex items-center gap-2">
          <Pill tone="success">
            <Check className="mr-1 h-3 w-3" aria-hidden />
            Given
          </Pill>
          {grantId != null && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || revoke.isPending}
              onClick={() => revoke.mutate(grantId)}
              title="Remove this from the class's list. Students already working on it keep their progress."
            >
              {revoke.isPending ? "Undoing…" : "Undo"}
            </Button>
          )}
        </span>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || grant.isPending}
          onClick={() =>
            grant.mutate({
              block: item.block,
              resource_type: item.resource_type,
              resource_id: item.resource_id,
            })
          }
        >
          {grant.isPending ? "Opening…" : "Access to class"}
        </Button>
      )}
    </li>
  );
}

function ClassworkPanel({
  detail,
  classId,
  canManage,
}: {
  detail: NonNullable<ReturnType<typeof useLessonDetail>["data"]>;
  classId: number;
  canManage: boolean;
}) {
  const cw = detail.classwork;
  // (resource_type, resource_id) -> grant id, so a given item can offer Undo.
  const grantIdFor = new Map(
    (detail.grants || []).map((g) => [`${g.resource_type}:${g.resource_id}`, g.id]),
  );
  if (!cw) {
    return <EmptyState title="No classwork" description="This session has no in-class plan." />;
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Lesson timetable"
          description="Follow this during the lesson."
          actions={<span className="text-sm font-semibold">{cw.total_minutes} min total</span>}
        />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <tbody>
              <tr className="border-b border-border">
                {cw.timetable.map((b) => (
                  <th key={b.key} className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    {b.label}
                  </th>
                ))}
              </tr>
              <tr>
                {cw.timetable.map((b) => (
                  <td key={b.key} className="px-3 py-2 font-semibold text-foreground">
                    {b.minutes} <span className="text-xs font-normal text-muted-foreground">min</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="New topic"
          description={cw.new_topic.title || "No title set"}
          actions={<span className="text-sm text-muted-foreground">{cw.new_topic.minutes} min</span>}
        />
        {cw.new_topic.instructions && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
            {cw.new_topic.instructions}
          </p>
        )}
        {cw.new_topic.items.length > 0 ? (
          <ul className="mt-3 divide-y divide-border">
            {cw.new_topic.items.map((it) => (
              <ItemRow
                key={`${it.resource_type}-${it.resource_id}`}
                item={it}
                classId={classId}
                lessonId={detail.lesson_id}
                disabled={!canManage}
                grantId={grantIdFor.get(`${it.resource_type}:${it.resource_id}`)}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No content attached.</p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Exercises"
          description="In-class practice — open each item when the class reaches it."
          actions={<span className="text-sm text-muted-foreground">{cw.exercises.minutes} min</span>}
        />
        {cw.exercises.items.length > 0 ? (
          <ul className="mt-3 divide-y divide-border">
            {cw.exercises.items.map((it) => (
              <ItemRow
                key={`${it.resource_type}-${it.resource_id}`}
                item={it}
                classId={classId}
                lessonId={detail.lesson_id}
                disabled={!canManage}
                grantId={grantIdFor.get(`${it.resource_type}:${it.resource_id}`)}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No exercises attached.</p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Revision"
          description="Work through mistakes on the exercises above."
          actions={<span className="text-sm text-muted-foreground">{cw.revision.minutes} min</span>}
        />
        {cw.revision.notes && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{cw.revision.notes}</p>
        )}
      </Card>
    </div>
  );
}

function HomeworkPanel({
  detail,
  classId,
  canManage,
}: {
  detail: NonNullable<ReturnType<typeof useLessonDetail>["data"]>;
  classId: number;
  canManage: boolean;
}) {
  const release = useReleaseHomework(classId, detail.lesson_id);
  const hw = detail.homework;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Homework"
          description={
            detail.homework_released
              ? "Given to the class — due at the start of the next lesson."
              : "Not given yet."
          }
          actions={
            detail.homework_released ? (
              <Pill tone="success">
                <Check className="mr-1 h-3 w-3" aria-hidden />
                Given
              </Pill>
            ) : (
              <Button
                disabled={!canManage || release.isPending || hw.validation.length > 0}
                onClick={() => release.mutate()}
              >
                {release.isPending ? "Giving…" : "Give to class"}
              </Button>
            )
          }
        />
        {hw.instructions ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{hw.instructions}</p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No instructions written.</p>
        )}
        {hw.validation.length > 0 && (
          <p className="mt-3 text-sm text-warning">
            An admin still has to finish this homework: {hw.validation.join("; ")}
          </p>
        )}
      </Card>

      {hw.assessments.length > 0 && (
        <Card>
          <CardHeader title="Assessments in this homework" />
          <ul className="mt-2 divide-y divide-border">
            {hw.assessments.map((a) => (
              <li key={a.resource_id} className="flex items-center gap-3 py-2.5">
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm">{a.title}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(hw.practice_test_ids.length > 0 || hw.practice_test_pack_ids.length > 0) && (
        <Card>
          <CardHeader
            title="Past papers in this homework"
            description="Students get access when the homework is given."
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {hw.practice_test_ids.length + hw.practice_test_pack_ids.length} item(s) attached.
          </p>
        </Card>
      )}
    </div>
  );
}

function MidtermPanel({
  row,
  classId,
  canManage,
}: {
  row: LessonRow;
  classId: number;
  canManage: boolean;
}) {
  const grant = useGrantMidterm(classId, row.lesson_id);
  const qc = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const m = row.midterm;

  // Reuses the existing midterms-v2 start-code endpoint rather than duplicating it.
  const onStart = async () => {
    if (!m) return;
    setStarting(true);
    try {
      const res = await midtermApi.generateStartCode(classId, m.exam_id);
      setCode(res.access_code);
      qc.invalidateQueries({ queryKey: classroomKeys.lesson(classId, row.lesson_id) });
      qc.invalidateQueries({ queryKey: classroomKeys.lessons(classId) });
      pushGlobalToast({ tone: "success", message: "Midterm started — read the code to the class." });
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    } finally {
      setStarting(false);
    }
  };

  if (!m) return <EmptyState title="No midterm" description="This session has no exam attached." />;
  return (
    <Card>
      <CardHeader
        title={m.title}
        description={`Class gets access ${m.access_days_before} day(s) before the session.`}
        actions={
          m.granted ? (
            <Pill tone="success">
              <Check className="mr-1 h-3 w-3" aria-hidden />
              Access given
            </Pill>
          ) : (
            <Button disabled={!canManage || grant.isPending} onClick={() => grant.mutate()}>
              {grant.isPending ? "Granting…" : "Access to class"}
            </Button>
          )
        }
      />
      {m.granted && !m.has_start_code && (
        // Access is not enough — can_start_midterm refuses with `midterm_no_code` until
        // a code exists. Generating it here keeps the teacher in the room rather than
        // sending them off to the Midterms tab mid-lesson.
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-warning">
            Students can&apos;t begin yet — they need the start code.
          </p>
          <Button disabled={!canManage || starting} onClick={onStart}>
            {starting ? "Starting…" : "Start midterm"}
          </Button>
        </div>
      )}
      {code && (
        <p className="mt-3 text-sm text-foreground">
          Read this code out to the class:{" "}
          <span className="font-mono text-lg font-bold tracking-widest">{code}</span>
        </p>
      )}
    </Card>
  );
}

function LessonDetailView({
  classId,
  lessonId,
  row,
  canManage,
  onBack,
}: {
  classId: number;
  lessonId: number;
  row: LessonRow;
  canManage: boolean;
  onBack: () => void;
}) {
  const { data, isLoading, isError, refetch } = useLessonDetail(classId, lessonId);
  const [tab, setTab] = useState<"homework" | "classwork">("homework");

  if (isLoading) return <LoadingState label="Opening lesson…" />;
  if (isError || !data)
    return <ErrorState title="Lesson not available" message="Try again." onRetry={() => refetch()} />;

  const isMidterm = data.lesson_type === "MIDTERM";

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All lessons
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold text-foreground">
          {isMidterm ? data.midterm?.title || "Midterm" : `Lesson ${data.lesson_number}`}
        </h2>
        <span className="text-sm text-muted-foreground">{formatDate(data.scheduled_for)}</span>
      </div>

      {isMidterm ? (
        <MidtermPanel row={row} classId={classId} canManage={canManage} />
      ) : (
        <>
          <Tabs
            items={[
              { id: "homework", label: "Homework" },
              { id: "classwork", label: "Classwork" },
            ]}
            active={tab}
            onChange={(id) => setTab(id as "homework" | "classwork")}
          />
          {tab === "homework" ? (
            <HomeworkPanel detail={data} classId={classId} canManage={canManage} />
          ) : (
            <ClassworkPanel detail={data} classId={classId} canManage={canManage} />
          )}
        </>
      )}
    </div>
  );
}

export function Lessons({ classroom }: { classroom: ClassroomWithRole }) {
  const classId = classroom.id;
  const { data, isLoading, isError, refetch } = useLessonPlan(classId);
  const [openId, setOpenId] = useState<number | null>(null);
  const reschedule = useRescheduleLessons(classId);

  // Derive from capabilities, never by comparing role strings inline — capabilities.ts
  // is the single source of truth and already normalises legacy ADMIN/CO_TEACHER roles.
  const caps = capabilitiesFor(classroom.my_role);
  const canManage = caps.canManageAssignments;

  if (isLoading) return <LoadingState label="Loading lesson plan…" />;
  if (isError || !data)
    return <ErrorState title="Lessons unavailable" message="Try again." onRetry={() => refetch()} />;

  if (!data.bound) {
    return (
      <EmptyState
        title="No lesson plan for this class"
        description={
          data.reason === "no_level"
            ? "This classroom has no level set, so it can't be matched to a course plan. An admin can set it in Settings."
            : "The course plan for this subject and level hasn't been published yet. An admin publishes it from the Journals console."
        }
      />
    );
  }

  const open = openId != null ? data.lessons.find((l) => l.lesson_id === openId) : undefined;
  if (open) {
    return (
      <LessonDetailView
        classId={classId}
        lessonId={open.lesson_id}
        row={open}
        canManage={canManage}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={data.journal?.title || "Lesson plan"}
          description={`${data.lessons.length} session${data.lessons.length === 1 ? "" : "s"} · homework is due at the start of the next lesson`}
          actions={
            // Rescheduling is manager-only server-side (can_manage_class); showing it to
            // a TA would offer a control that always 403s.
            caps.canManageClass ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Starts
                <input
                  type="date"
                  defaultValue={data.starts_on ?? ""}
                  disabled={reschedule.isPending}
                  // onBlur, not onChange: a date input emits a change per keystroke while
                  // the year is typed, which would fire a whole-term reschedule per digit.
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v && v !== (data.starts_on ?? "")) reschedule.mutate(v);
                  }}
                  className="rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none"
                  title="Move the whole plan. Lessons already given keep the date they happened on."
                />
              </label>
            ) : undefined
          }
        />
      </Card>

      {data.lessons.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          description="An admin hasn't added any sessions to this course plan."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {data.lessons.map((l) => (
              <li key={l.lesson_id}>
                <button
                  onClick={() => setOpenId(l.lesson_id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-muted-foreground">
                    {l.lesson_number}
                  </span>
                  {l.lesson_type === "MIDTERM" ? (
                    <Timer className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {l.lesson_type === "MIDTERM"
                        ? l.midterm?.title || "Midterm"
                        : l.title || `Lesson ${l.lesson_number}`}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" aria-hidden />
                      {formatDate(l.scheduled_for)}
                    </span>
                  </span>
                  {l.lesson_type === "MIDTERM"
                    ? l.midterm?.granted && <Pill tone="success">Access given</Pill>
                    : l.homework_released && <Pill tone="success">Homework given</Pill>}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
