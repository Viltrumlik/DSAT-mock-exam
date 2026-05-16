"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { classesApi } from "@/lib/api";
import AssignmentDrawer, {
  type DrawerMode,
  type DrawerResult,
} from "@/components/ops/AssignmentDrawer";
import { ClassroomOverviewPanel } from "@/components/ops/ClassroomOverviewPanel";
import { AssignmentListSection } from "@/components/ops/AssignmentListSection";
import { AssessmentClassroomAssignPanel } from "@/components/bulk-assign/AssessmentClassroomAssignPanel";
import { StudentRosterSection } from "@/components/ops/StudentRosterSection";
import { ActivityFeedSection } from "@/components/ops/ActivityFeedSection";
import { OpsPageHeader } from "@/components/ops/ui";
import type {
  AssignmentSummary,
  ClassroomSummary,
  PersonSummary,
} from "@/components/ops/ClassroomOverviewPanel";
import {
  Activity,
  BookOpen,
  Loader2,
  RefreshCw,
  School,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "overview" | "assignments" | "students" | "activity";

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
        <TabButton value="activity" current={tab} icon={Activity} label="Activity" onClick={setTab} />
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
      {tab === "activity" && <ActivityFeedSection classroomId={classroomId} />}

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
