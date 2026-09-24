"use client";

/**
 * /teacher/midterms/[midtermId] — one paper: who has it, who has sat it.
 *
 * The three things a teacher does here are giving the paper to more students, letting one
 * student sit it again, and taking access back. Everything else on the screen is reading.
 *
 * No pass/fail line here, and that is a fact about the payload rather than a choice: the
 * classroom panel can paint a row green or red because `/classes/…/midterms-v2/` sends
 * `stats.pass_mark` from `summary_basis()` alongside a per-row `score_on_scale`. This page's
 * endpoint (`/midterms/teacher/midterms/<id>/results/`, views_teacher.py) sends neither, so
 * there is no mark to judge against and no converted score to judge. Inventing one from the
 * midterm's current `effective_pass_mark` would move the line under a room that has already
 * sat the paper — exactly the mistake `summary_basis` exists to prevent.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, UserMinus, UserPlus } from "lucide-react";
import { StudentMultiSelect } from "@/components/access/StudentMultiSelect";
import {
  midtermApi,
  midtermProgress,
  midtermStateLabel,
  summarizeStandalone,
  type MidtermProgress,
  type StandaloneResultRow,
} from "@/lib/midtermApi";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Avatar } from "@/components/ui/Avatar";
import {
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Pill,
  Skeleton,
  Stat,
  TeacherPage,
  type Column,
} from "@/features/teacher/ui";
import {
  Choice,
  FilterBar,
  MidtermMeta,
  PROGRESS_FILTERS,
  PROGRESS_TONE,
  SearchBox,
  ShowingLine,
  StatRow,
  Unknown,
} from "./shared";

type DetailSort = "score" | "name" | "status";

const SORTS: { value: DetailSort; label: string }[] = [
  { value: "score", label: "Highest score first" },
  { value: "name", label: "Name (A–Z)" },
  { value: "status", label: "Status" },
];

const BACK_TO_LIST = (
  <Link href="/teacher/midterms">
    <Button variant="ghost">
      <ArrowLeft size={15} aria-hidden />
      All midterms
    </Button>
  </Link>
);

export function StandaloneMidtermDetail({ midtermId }: { midtermId: number }) {
  const qc = useQueryClient();
  const key = useMemo(() => ["midterm", "standalone-results", midtermId], [midtermId]);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => midtermApi.standaloneResults(midtermId),
  });

  const [picked, setPicked] = useState<number[]>([]);
  const [pickerOpen, setPickerOpen] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<MidtermProgress | "all">("all");
  const [sort, setSort] = useState<DetailSort>("score");
  const [revoking, setRevoking] = useState<StandaloneResultRow | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    // The list page's roll-up is built from these rows, so it is stale the moment we change one.
    qc.invalidateQueries({ queryKey: ["midterm", "standalone-overview"] });
  };

  const grant = useMutation({
    mutationFn: () => midtermApi.grant(midtermId, picked),
    onSuccess: () => {
      pushGlobalToast({
        tone: "success",
        message: `Access given to ${picked.length} student${picked.length === 1 ? "" : "s"}.`,
      });
      setPicked([]);
      invalidate();
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });

  // A midterm is once-only. This is the exception: a student who failed a month, repeated it,
  // and has to sit that month's paper again. One click buys exactly one sitting.
  const resit = useMutation({
    mutationFn: async ({ userId, allow }: { userId: number; allow: boolean }) => {
      if (allow) await midtermApi.allowResit(midtermId, [userId], "repeated the month");
      else await midtermApi.withdrawResit(midtermId, [userId]);
    },
    onSuccess: (_res, vars) => {
      invalidate();
      pushGlobalToast({
        tone: "success",
        message: vars.allow ? "Re-sit allowed — they can sit this paper once more." : "Re-sit withdrawn.",
      });
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });

  const revoke = useMutation({
    mutationFn: (userId: number) => midtermApi.revoke(midtermId, [userId]),
    onSuccess: () => {
      setRevoking(null);
      invalidate();
      pushGlobalToast({ tone: "success", message: "Access removed." });
    },
    onError: (e) => {
      setRevoking(null);
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    },
  });

  const midterm = data?.midterm;
  const students = useMemo(() => data?.students ?? [], [data?.students]);
  const summary = useMemo(
    () => summarizeStandalone(students, midterm?.score_ceiling ?? 0),
    [students, midterm?.score_ceiling],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = students.filter(
      (s) =>
        (!q || s.student_name.toLowerCase().includes(q)) &&
        (statusFilter === "all" || midtermProgress(s) === statusFilter),
    );
    const order: MidtermProgress[] = ["completed", "scoring", "in_progress", "not_started", "voided"];
    return [...list].sort((a, b) => {
      if (sort === "name") return a.student_name.localeCompare(b.student_name);
      if (sort === "status") {
        const d = order.indexOf(midtermProgress(a)) - order.indexOf(midtermProgress(b));
        return d !== 0 ? d : a.student_name.localeCompare(b.student_name);
      }
      // Score, highest first; anyone who has not handed it in sorts to the bottom by name.
      const sa = a.submitted && a.score != null ? a.score : null;
      const sb = b.submitted && b.score != null ? b.score : null;
      if (sa == null && sb == null) return a.student_name.localeCompare(b.student_name);
      if (sa == null) return 1;
      if (sb == null) return -1;
      return sb - sa || a.student_name.localeCompare(b.student_name);
    });
  }, [students, query, statusFilter, sort]);

  // ── loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <TeacherPage title="Midterm" actions={BACK_TO_LIST}>
        <Card>
          <Skeleton height={40} count={6} />
        </Card>
      </TeacherPage>
    );
  }

  // ── error (never an empty state) ───────────────────────────────────────────
  if (isError || !data || !midterm) {
    return (
      <TeacherPage title="Midterm" actions={BACK_TO_LIST}>
        <Card>
          <ErrorState
            title="We couldn't load this midterm"
            detail="Its access list and results didn't come back. Nobody has lost access — this is the page failing to read it."
            onRetry={() => void refetch()}
          />
        </Card>
      </TeacherPage>
    );
  }

  // ── data (the results table carries its own empty branch) ──────────────────
  const showPicker = pickerOpen ?? students.length === 0;
  const filtering = query.trim() !== "" || statusFilter !== "all";

  return (
    <TeacherPage
      title={midterm.title}
      subtitle="Named students, sitting this paper on their own time — no class window and no access code."
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {BACK_TO_LIST}
          <Button variant={showPicker ? "ghost" : "primary"} onClick={() => setPickerOpen(!showPicker)}>
            <UserPlus size={15} aria-hidden />
            {showPicker ? "Close" : "Give access"}
          </Button>
        </div>
      }
    >
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <MidtermMeta m={midterm} />
          <StatRow>
            <Stat label="Students with access" value={summary.granted} tone="info" />
            <Stat
              label="Still to sit"
              value={summary.outstanding}
              tone="warning"
              hint={summary.in_progress > 0 ? `${summary.in_progress} in progress right now` : undefined}
            />
            <Stat label="Results in" value={summary.submitted} tone="success" />
            <Stat
              label="Average score"
              // A null average is "nobody has finished", never a zero — `Stat` draws it as an
              // em dash, and the hint below says which of the two the reader is looking at.
              value={summary.average_score != null ? `${summary.average_score} / ${summary.score_ceiling}` : null}
              hint={
                summary.average_score != null
                  ? `Across ${summary.submitted} finished paper${summary.submitted === 1 ? "" : "s"}`
                  : "Nobody has finished it yet"
              }
            />
          </StatRow>
        </div>
      </Card>

      {showPicker && (
        <Card
          title="Give access to students"
          subtitle="The midterm appears in their own list immediately, and their certificate is issued in your name."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <StudentMultiSelect value={picked} onChange={setPicked} showClassroomFilter={false} />
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Button busy={grant.isPending} disabled={picked.length === 0} onClick={() => grant.mutate()}>
                <UserPlus size={15} aria-hidden />
                Give access to {picked.length} student{picked.length === 1 ? "" : "s"}
              </Button>
              {picked.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--dz-mute)" }}>Choose at least one student first.</span>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card title="Results">
        {students.length === 0 ? (
          <EmptyState
            title="Nobody has this midterm yet"
            hint="Give it to the students who should sit it and they will appear here — with their status, score and re-sit permission — as they work through it."
            action={
              !showPicker ? (
                <Button onClick={() => setPickerOpen(true)}>
                  <UserPlus size={15} aria-hidden />
                  Give access
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <FilterBar>
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder="Search students by name"
                label="Search students"
              />
              <Choice
                value={statusFilter}
                onChange={setStatusFilter}
                label="Filter by status"
                options={PROGRESS_FILTERS.map((f) => ({ value: f.id, label: f.label }))}
              />
              <Choice value={sort} onChange={setSort} label="Sort students" options={SORTS} />
            </FilterBar>

            {visible.length > 0 && (
              <ShowingLine>
                Showing {visible.length} of {students.length} student{students.length === 1 ? "" : "s"} with access
                {filtering ? " (filtered)" : ""} · {summary.submitted} finished · {summary.outstanding} still to sit
                {summary.resit_open > 0 ? ` · ${summary.resit_open} holding a re-sit` : ""}
              </ShowingLine>
            )}

            <StudentTable
              rows={visible}
              resitBusyFor={resit.isPending ? resit.variables?.userId : undefined}
              onResit={(s) => resit.mutate({ userId: s.student_id, allow: !s.resit_open })}
              onRevoke={setRevoking}
              onClearFilters={() => {
                setQuery("");
                setStatusFilter("all");
              }}
            />
          </div>
        )}
      </Card>

      <Dialog
        open={revoking !== null}
        tone="danger"
        title="Remove access to this midterm?"
        description={
          revoking ? `${revoking.student_name} will no longer see “${midterm.title}” in their midterm list.` : undefined
        }
        confirmLabel="Remove access"
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.student_id)}
        onClose={() => setRevoking(null)}
      >
        {/* What removal costs depends entirely on whether they have already sat it, and a
            teacher deciding this needs the answer for THIS student, not the general rule. */}
        <p style={{ fontSize: 14, color: "var(--dz-mute)", margin: 0 }}>
          {revoking?.submitted
            ? "They have already sat it, so their score and certificate stay exactly as they are. You can give access back at any time."
            : "They have not sat it yet, so nothing is lost. You can give access back at any time."}
        </p>
      </Dialog>
    </TeacherPage>
  );
}

function StudentTable({ rows, resitBusyFor, onResit, onRevoke, onClearFilters }: {
  rows: StandaloneResultRow[];
  resitBusyFor: number | undefined;
  onResit: (s: StandaloneResultRow) => void;
  onRevoke: (s: StandaloneResultRow) => void;
  onClearFilters: () => void;
}) {
  const columns: Column<StandaloneResultRow>[] = [
    {
      key: "student",
      header: "Student",
      render: (s) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontWeight: 700 }}>
          <Avatar src={s.student_profile_image_url} name={s.student_name} size={26} />
          {s.student_name}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (s) => {
        const progress = midtermProgress(s);
        return (
          <span
            style={progress === "voided" ? { cursor: "help" } : undefined}
            title={
              progress === "voided"
                ? "An administrator voided this sitting so it can be re-graded or sat again."
                : undefined
            }
          >
            <Pill tone={PROGRESS_TONE[progress]}>{midtermStateLabel(s.state)}</Pill>
          </span>
        );
      },
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      render: (s) =>
        s.submitted && s.score != null ? (
          `${s.score} / ${s.score_ceiling}`
        ) : (
          <Unknown title="They have not handed this paper in yet, so there is no score." />
        ),
    },
    { key: "sittings", header: "Sittings", align: "right", render: (s) => s.sittings },
    {
      key: "resit",
      header: "Re-sit",
      render: (s) =>
        s.submitted ? (
          <Button
            variant="ghost"
            busy={resitBusyFor === s.student_id}
            onClick={() => onResit(s)}
            title={
              s.resit_open
                ? "They may sit this paper once more. Click to take that back."
                : "Let them sit this paper again — for a student who repeated the month."
            }
          >
            {s.resit_open && <Check size={14} aria-hidden />}
            {s.resit_open ? "Re-sit allowed" : "Allow re-sit"}
          </Button>
        ) : (
          <Unknown title="A re-sit is only for a paper they have already handed in." />
        ),
    },
    {
      key: "access",
      header: "Access",
      align: "right",
      render: (s) => (
        <Button variant="ghost" onClick={() => onRevoke(s)} title={`Remove ${s.student_name}'s access to this midterm`}>
          <UserMinus size={14} aria-hidden />
          Remove
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      label="Students with access to this midterm"
      columns={columns}
      rows={rows}
      rowKey={(s) => s.student_id}
      empty={
        <EmptyState
          title="No student matches those filters"
          hint="Try a different status, or clear the search to see everyone with access."
          action={
            <Button variant="ghost" onClick={onClearFilters}>
              Clear filters
            </Button>
          }
        />
      }
    />
  );
}
