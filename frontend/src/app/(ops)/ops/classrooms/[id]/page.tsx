"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { classesApi } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentsTeacherApi } from "@/features/assessmentsStudent/api";
import type { SubmissionQueueItem } from "@/features/assessmentsStudent/api";
import AssignmentDrawer, {
  type DrawerMode,
  type DrawerResult,
} from "@/components/ops/AssignmentDrawer";
import { ClassroomOverviewPanel } from "@/components/ops/ClassroomOverviewPanel";
import { AssignmentListSection } from "@/components/ops/AssignmentListSection";
import { AssessmentClassroomAssignPanel } from "@/components/bulk-assign/AssessmentClassroomAssignPanel";
import { StudentRosterSection } from "@/components/ops/StudentRosterSection";
import { ActivityFeedSection } from "@/components/ops/ActivityFeedSection";
import { InterventionPanel } from "@/components/ops/InterventionPanel";
import { OpsPageHeader } from "@/components/ops/ui";
import type {
  AssignmentSummary,
  ClassroomSummary,
  PersonSummary,
} from "@/components/ops/ClassroomOverviewPanel";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  Inbox,
  Loader2,
  MessageSquare,
  RefreshCw,
  School,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "overview" | "assignments" | "students" | "activity" | "interventions" | "submissions";

// ─── Submissions Panel ────────────────────────────────────────────────────────

function SubmissionsPanel({ classroomId }: { classroomId: number }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<"all" | "submitted" | "graded">("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["teacher-submission-queue", classroomId, statusFilter],
    queryFn: () => assessmentsTeacherApi.submissionQueue({ classroom_id: classroomId, status: statusFilter }),
    staleTime: 60_000,
  });

  const items = data?.items ?? [];

  const pendingGrading = items.filter((i) => i.status === "submitted").length;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Failed to load submissions.</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-bold text-foreground">{data?.count ?? 0} submissions</span>
        {pendingGrading > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
            <Loader2 className="h-3 w-3" />
            {pendingGrading} pending grading
          </span>
        )}
        {/* Status filter */}
        <div className="ml-auto flex gap-1">
          {(["all", "submitted", "graded"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-bold transition-colors capitalize",
                statusFilter === s
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:bg-surface-2",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <Inbox className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-semibold text-foreground">No submissions yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Submissions will appear here when students complete their assessments.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {items.map((item) => (
              <SubmissionRow
                key={item.attempt_id}
                item={item}
                classroomId={classroomId}
                onReview={() => router.push(`/assessments/review/${item.attempt_id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FeedbackButton({
  attemptId,
  hasFeedback,
  classroomId,
}: {
  attemptId: number;
  hasFeedback: boolean;
  classroomId: number;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => assessmentsTeacherApi.setFeedback(attemptId, body),
    onSuccess: () => {
      setSaved(true);
      setOpen(false);
      setBody("");
      // Refresh submission queue so has_feedback updates
      queryClient.invalidateQueries({ queryKey: ["teacher-submission-queue", classroomId] });
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors",
          hasFeedback || saved
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:bg-surface-2",
        )}
      >
        {saved ? (
          <span className="flex items-center gap-1">
            <Check className="h-3 w-3" /> Sent
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {hasFeedback ? "Edit feedback" : "Add feedback"}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-20 w-72 rounded-2xl border border-border bg-card shadow-xl p-4 space-y-3">
          <p className="text-xs font-bold text-foreground">Write feedback for student</p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add instructional feedback, encouragement, or guidance for this student…"
            rows={4}
            maxLength={2000}
            className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">{body.length}/2000</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!body.trim() || mutation.isPending}
                onClick={() => mutation.mutate()}
                className="rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-40 transition-colors"
              >
                {mutation.isPending ? "Saving…" : "Send feedback"}
              </button>
            </div>
          </div>
          {mutation.isError && (
            <p className="text-xs text-red-600">Failed to save feedback. Please try again.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SubmissionRow({
  item,
  onReview,
  classroomId,
}: {
  item: SubmissionQueueItem;
  onReview: () => void;
  classroomId: number;
}) {
  const isGraded = item.status === "graded";
  const percent = item.result_percent;

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50 transition-colors">
      {/* Score indicator */}
      <div
        className={cn(
          "shrink-0 flex h-9 w-9 items-center justify-center rounded-xl text-xs font-black",
          isGraded && percent !== null
            ? percent >= 80
              ? "bg-emerald-100 text-emerald-700"
              : percent >= 60
                ? "bg-amber-100 text-amber-700"
                : "bg-red-100 text-red-700"
            : "bg-surface-2 text-muted-foreground",
        )}
      >
        {isGraded && percent !== null ? `${Math.round(percent)}%` : "…"}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{item.student_name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {item.assignment_title ?? "Assessment"}
          {item.submitted_at && (
            <span className="ml-1">
              · {new Date(item.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {!isGraded && (
          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded-lg px-2 py-0.5">
            Grading…
          </span>
        )}
        <FeedbackButton
          attemptId={item.attempt_id}
          hasFeedback={item.has_feedback}
          classroomId={classroomId}
        />
        <button
          type="button"
          onClick={onReview}
          className="rounded-xl border border-border px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
        >
          Review
        </button>
      </div>
    </div>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabButton({
  value,
  current,
  icon: Icon,
  label,
  badge,
  onClick,
}: {
  value: Tab;
  current: Tab;
  icon: React.ElementType;
  label: string;
  badge?: number;
  onClick: (t: Tab) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors",
        value === current
          ? "bg-surface-2 text-foreground"
          : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700 tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Inner page ───────────────────────────────────────────────────────────────

function ClassroomOpsPageInner() {
  const { id } = useParams<{ id: string }>();
  const classroomId = Number(id);

  const [tab, setTab] = useState<Tab>("overview");
  const [classroom, setClassroom] = useState<ClassroomSummary | null>(null);
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);

  const load = async () => {
    if (!classroomId || !Number.isFinite(classroomId)) return;
    setLoading(true);
    setError(null);
    try {
      const [classroomData, assignmentsData, peopleData] = await Promise.all([
        classesApi.get(classroomId),
        classesApi.listAssignments(classroomId),
        classesApi.people(classroomId),
      ]);
      setClassroom(classroomData as ClassroomSummary);
      setAssignments((assignmentsData.items ?? []) as AssignmentSummary[]);
      // The /people/ endpoint returns ClassroomMembership objects with a nested
      // `user` field. Flatten them into PersonSummary shape for the UI.
      const rawArr: unknown[] = Array.isArray(peopleData)
        ? peopleData
        : Array.isArray((peopleData as { results?: unknown[] })?.results)
          ? (peopleData as { results: unknown[] }).results
          : Array.isArray((peopleData as { members?: unknown[] })?.members)
            ? (peopleData as { members: unknown[] }).members
            : [];
      const rawPeople: PersonSummary[] = rawArr.map((item) => {
        const m = item as {
          id: number;
          role: string;
          user?: { id?: number; email?: string; first_name?: string; last_name?: string };
          email?: string;
          first_name?: string;
          last_name?: string;
        };
        // If the item has a nested `user` object, flatten it.
        if (m.user && typeof m.user === "object") {
          return {
            id: m.user.id ?? m.id,
            email: m.user.email ?? "",
            first_name: m.user.first_name,
            last_name: m.user.last_name,
            role: m.role,
          };
        }
        return m as unknown as PersonSummary;
      });
      setPeople(rawPeople);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not load classroom.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId]);

  const handleSaved = (result: DrawerResult) => {
    setDrawer(null);
    setAssignments((prev) => {
      const idx = prev.findIndex((a) => a.id === result.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...result } as AssignmentSummary;
        return next;
      }
      return [result as unknown as AssignmentSummary, ...prev];
    });
  };

  const overdueCount = assignments.filter(
    (a) => a.due_at && new Date(a.due_at) < new Date(),
  ).length;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
      </div>
    );
  }

  if (error || !classroom) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="font-bold text-foreground mb-2">{error ?? "Classroom not found."}</p>
        <a href="/ops/classrooms" className="text-sm font-semibold text-primary hover:underline">
          ← Back to classrooms
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <OpsPageHeader
        title={classroom.name}
        subtitle={`Classroom #${classroom.id}${classroom.subject ? ` · ${classroom.subject}` : ""}`}
        back={{ href: "/ops/classrooms", label: "Classrooms" }}
        action={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        }
      />

      {/* Tab bar */}
      <div className="flex gap-1 flex-wrap">
        <TabButton value="overview" current={tab} icon={School} label="Overview" onClick={setTab} />
        <TabButton
          value="assignments"
          current={tab}
          icon={BookOpen}
          label="Assignments"
          badge={overdueCount}
          onClick={setTab}
        />
        <TabButton value="students" current={tab} icon={Users} label="Students" onClick={setTab} />
        <TabButton value="submissions" current={tab} icon={Inbox} label="Submissions" onClick={setTab} />
        <TabButton value="activity" current={tab} icon={Activity} label="Activity" onClick={setTab} />
        <TabButton value="interventions" current={tab} icon={AlertTriangle} label="Interventions" onClick={setTab} />
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <ClassroomOverviewPanel
          classroom={classroom}
          assignments={assignments}
          students={people}
        />
      )}
      {tab === "assignments" && (
        <div className="space-y-6">
          <AssignmentListSection
            classroomId={classroomId}
            assignments={assignments}
            onNewAssignment={() => setDrawer({ type: "create", classroomId })}
            onEditAssignment={(a) =>
              setDrawer({
                type: "edit",
                classroomId,
                assignment: {
                  id: a.id,
                  title: a.title,
                  instructions: (a as AssignmentSummary & { instructions?: string }).instructions,
                  due_at: a.due_at,
                  practice_test: a.practice_test,
                  mock_exam: a.mock_exam,
                  pastpaper_pack: a.pastpaper_pack,
                },
              })
            }
            onDeleteAssignment={(aid) =>
              setAssignments((prev) => prev.filter((a) => a.id !== aid))
            }
          />
          {/* Assessment homework assignment — directly from this classroom */}
          <AssessmentClassroomAssignPanel
            canAssign={true}
            defaultClassroomId={classroomId}
            showToast={(msg) => {
              /* simple inline feedback — assignments list reloads on success */
              console.info("[AssessmentAssign]", msg);
            }}
            onAssigned={() => void load()}
          />
        </div>
      )}
      {tab === "students" && <StudentRosterSection people={people} />}
      {tab === "submissions" && <SubmissionsPanel classroomId={classroomId} />}
      {tab === "activity" && <ActivityFeedSection classroomId={classroomId} />}
      {tab === "interventions" && <InterventionPanel classroomId={classroomId} />}

      {drawer && (
        <AssignmentDrawer mode={drawer} onClose={() => setDrawer(null)} onSaved={handleSaved} />
      )}
    </div>
  );
}

export default function ClassroomOpsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
        </div>
      }
    >
      <ClassroomOpsPageInner />
    </Suspense>
  );
}
