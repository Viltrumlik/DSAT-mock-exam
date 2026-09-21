"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Hourglass,
  Search,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { StudentMultiSelect } from "@/components/access/StudentMultiSelect";
import {
  fetchStandaloneOverview,
  midtermApi,
  midtermLevelLabel,
  midtermProgress,
  midtermStateLabel,
  scoringScaleLabel,
  subjectLabel,
  summarizeStandalone,
  type MidtermCatalogItem,
  type MidtermProgress,
  type StandaloneOverviewRow,
  type StandaloneResultRow,
} from "@/lib/midtermApi";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Avatar } from "@/components/ui/Avatar";
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Pill,
  Select,
  StatCard,
  Tabs,
} from "@/features/classroom/ui";
import type { PillTone } from "@/features/classroom/ui";

/**
 * The teacher's standalone "Midterms" area (/teacher/midterms).
 *
 * Standalone means ONE TEACHER GIVING ONE PAPER TO NAMED STUDENTS: a per-student
 * ResourceAccessGrant with classroom = NULL. That is the whole scope of this page, and it is
 * also the thing teachers got wrong — a midterm assigned through a classroom is a different
 * object (a MidtermSchedule on that class) and never appears here, so the page header says
 * where those live, once, rather than letting a teacher conclude the page is broken.
 *
 * The page answers, in order: which midterms have I given out, who still has to sit them,
 * and whose results are waiting for me. The published catalog is still one click away —
 * granting access is the point of the page — but it no longer leads.
 *
 * Backed by /midterms/teacher/* (see backend/midterms/views_teacher.py). There is no
 * server-side roll-up for this area, so the overview asks each midterm's results endpoint
 * with bounded concurrency (see fetchStandaloneOverview).
 */

/** Same page frame as the other teacher surfaces (TeacherClassrooms) — the shell owns the rest. */
const SHELL = "mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6";

const progressTone: Record<MidtermProgress, PillTone> = {
  not_started: "neutral",
  in_progress: "info",
  scoring: "warning",
  completed: "success",
  voided: "warning",
};

const PROGRESS_FILTERS: { id: MidtermProgress | "all"; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "not_started", label: "Not started" },
  { id: "in_progress", label: "In progress" },
  { id: "scoring", label: "Scoring" },
  { id: "completed", label: "Completed" },
  { id: "voided", label: "Voided" },
];

/**
 * "We do not know", rendered honestly. A mean with nobody in the denominator is not zero,
 * and a midterm whose check failed is not a midterm with no students.
 */
function Unknown({ title }: { title: string }) {
  return (
    <span className="cursor-help text-muted-foreground" title={title}>
      —
    </span>
  );
}

function MidtermMeta({ m }: { m: MidtermCatalogItem }) {
  const level = midtermLevelLabel(m.level);
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
      <span>{subjectLabel(m.subject)}</span>
      <span aria-hidden>·</span>
      <span className="tabular-nums">{m.duration_minutes} min</span>
      <span aria-hidden>·</span>
      <span className="tabular-nums">{m.question_count} questions</span>
      <span aria-hidden>·</span>
      <span>{scoringScaleLabel(m.scoring_scale, m.score_ceiling)}</span>
      {level && (
        <Pill tone="neutral" className="ml-0.5">
          {level}
        </Pill>
      )}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   /teacher/midterms — what I have given out, then the catalog
   ──────────────────────────────────────────────────────────────────────────── */

type ListTab = "given" | "catalog";
type GivenSort = "results" | "outstanding" | "students" | "title";

export function StandaloneMidtermsList() {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["midterm", "catalog"],
    queryFn: midtermApi.catalog,
    staleTime: 60_000,
  });
  const items = useMemo(() => catalog.data ?? [], [catalog.data]);
  const ids = useMemo(() => items.map((m) => m.id), [items]);

  // One query, not one per midterm: fetchStandaloneOverview walks the catalog with a bounded
  // number of requests in flight and records a per-midterm failure instead of dropping it.
  const overview = useQuery({
    queryKey: ["midterm", "standalone-overview", ids],
    queryFn: () => fetchStandaloneOverview(items, { concurrency: 6 }),
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
  const rows = useMemo<StandaloneOverviewRow[]>(() => overview.data ?? [], [overview.data]);

  // Everything the overview fetched is exactly what the detail page asks for, so hand it over
  // and make opening a midterm instant.
  useEffect(() => {
    for (const r of rows) {
      if (r.students) {
        qc.setQueryData(["midterm", "standalone-results", r.midterm.id], {
          midterm: r.midterm,
          students: r.students,
        });
      }
    }
  }, [rows, qc]);

  const [tab, setTab] = useState<ListTab>("given");
  const [givenQuery, setGivenQuery] = useState("");
  const [givenSort, setGivenSort] = useState<GivenSort>("results");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogSubject, setCatalogSubject] = useState<"all" | "READING_WRITING" | "MATH">("all");

  const totals = useMemo(() => {
    let givenOut = 0;
    let students = 0;
    let outstanding = 0;
    let resultsIn = 0;
    let unchecked = 0;
    for (const r of rows) {
      if (!r.summary) {
        unchecked += 1;
        continue;
      }
      if (r.summary.granted > 0) givenOut += 1;
      students += r.summary.granted;
      outstanding += r.summary.outstanding;
      resultsIn += r.summary.submitted;
    }
    return { givenOut, students, outstanding, resultsIn, unchecked };
  }, [rows]);

  const givenRows = useMemo(() => rows.filter((r) => (r.summary?.granted ?? 0) > 0), [rows]);

  const visibleGiven = useMemo(() => {
    const q = givenQuery.trim().toLowerCase();
    const list = q ? givenRows.filter((r) => r.midterm.title.toLowerCase().includes(q)) : [...givenRows];
    list.sort((a, b) => {
      const sa = a.summary;
      const sb = b.summary;
      if (givenSort === "title") return a.midterm.title.localeCompare(b.midterm.title);
      if (givenSort === "students") return (sb?.granted ?? 0) - (sa?.granted ?? 0);
      if (givenSort === "outstanding") return (sb?.outstanding ?? 0) - (sa?.outstanding ?? 0);
      return (sb?.submitted ?? 0) - (sa?.submitted ?? 0);
    });
    return list;
  }, [givenRows, givenQuery, givenSort]);

  const summaryById = useMemo(() => {
    const map = new Map<number, StandaloneOverviewRow>();
    for (const r of rows) map.set(r.midterm.id, r);
    return map;
  }, [rows]);

  const visibleCatalog = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    return items.filter(
      (m) =>
        (catalogSubject === "all" || m.subject === catalogSubject) &&
        (!q || m.title.toLowerCase().includes(q)),
    );
  }, [items, catalogQuery, catalogSubject]);

  // The one thing a teacher cannot see from here — that a midterm given to a whole class is a
  // different object, kept somewhere else — is said once, in the header that every state renders.
  // It used to be a paragraph in a bordered note, repeated on four of them.
  const header = (
    <PageHeader
      title="Midterms"
      description="Midterms you give to named students. A midterm given to a whole class lives in that classroom’s own Midterms tab."
    />
  );

  // ── loading ───────────────────────────────────────────────────────────────
  if (catalog.isLoading || (ids.length > 0 && overview.isPending)) {
    return (
      <div className={SHELL}>
        {header}
        <LoadingState label="Checking which midterms you have given out…" />
      </div>
    );
  }

  // ── error (never an empty state) ───────────────────────────────────────────
  if (catalog.isError) {
    return (
      <div className={SHELL}>
        {header}
        <ErrorState
          title="We couldn't load your midterms."
          message="The midterm list didn't come back. This is a loading problem, not an empty page — nothing has been lost."
          onRetry={() => catalog.refetch()}
        />
      </div>
    );
  }
  if (rows.length > 0 && totals.unchecked === rows.length) {
    return (
      <div className={SHELL}>
        {header}
        <ErrorState
          title="We couldn't check any of your midterms."
          message="The catalog loaded, but every request for who has access failed. Your grants are untouched — this is only the page failing to read them."
          onRetry={() => overview.refetch()}
        />
      </div>
    );
  }

  // ── empty ─────────────────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div className={SHELL}>
        {header}
        <Card className="mt-4">
          <EmptyState
            icon={FileText}
            title="No published midterms yet"
            description="Midterm papers are written and published in the Builder. Once one is published it appears here, ready to give to students."
          />
        </Card>
      </div>
    );
  }

  // ── data ──────────────────────────────────────────────────────────────────
  return (
    <div className={SHELL}>
      {header}

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Midterms given out" value={totals.givenOut} icon={FileText} sub={`of ${items.length} published`} />
        <StatCard label="Students with access" value={totals.students} icon={Users} />
        <StatCard label="Still to sit" value={totals.outstanding} icon={Hourglass} sub="Granted, not handed in" />
        <StatCard label="Results in" value={totals.resultsIn} icon={ClipboardCheck} sub="Finished and graded" />
      </div>

      {totals.unchecked > 0 && (
        <Card pad="sm" className="mt-3 border-warning/25 bg-warning-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-warning-foreground">
              <span className="font-semibold">
                {totals.unchecked} of {rows.length} midterms could not be checked.
              </span>{" "}
              The totals above leave them out, so treat them as a floor rather than the full count.
            </p>
            <Button variant="secondary" size="sm" onClick={() => overview.refetch()} loading={overview.isFetching}>
              Check again
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-6">
        <Tabs
          items={[
            { id: "given", label: "Given out", icon: ClipboardCheck, count: givenRows.length },
            { id: "catalog", label: "All midterms", icon: BookOpen, count: items.length },
          ]}
          active={tab}
          onChange={(id) => setTab(id as ListTab)}
        />
      </div>

      {tab === "given" ? (
        <Card className="mt-4">
          <CardHeader
            title="Midterms you have given out"
            description="One row per paper you have handed to named students. Open one to grant more access, allow a re-sit, or read the scores."
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={givenQuery}
                onChange={(e) => setGivenQuery(e.target.value)}
                placeholder="Search by midterm title"
                aria-label="Search midterms you have given out"
                className="pl-9"
              />
            </div>
            <div className="w-56">
              <Select
                value={givenSort}
                onChange={(e) => setGivenSort(e.target.value as GivenSort)}
                aria-label="Sort midterms"
              >
                <option value="results">Most results in</option>
                <option value="outstanding">Most still to sit</option>
                <option value="students">Most students</option>
                <option value="title">Title (A–Z)</option>
              </Select>
            </div>
          </div>

          {givenRows.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="You haven't given a midterm to anyone yet"
              description="Pick a paper from All midterms and grant it to the students who need to sit it. They will find it in their own midterm list straight away."
              action={
                <Button variant="secondary" icon={BookOpen} onClick={() => setTab("catalog")}>
                  Browse all midterms
                </Button>
              }
            />
          ) : visibleGiven.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No midterm matches that search"
              description="Try a shorter title, or clear the search to see every midterm you have given out."
              action={
                <Button variant="secondary" onClick={() => setGivenQuery("")}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <>
              <p className="mt-4 text-xs font-medium text-muted-foreground">
                Showing <span className="tabular-nums">{visibleGiven.length}</span> of{" "}
                <span className="tabular-nums">{givenRows.length}</span> midterms you have given out
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 pr-3 font-bold">Midterm</th>
                      <th className="pb-2 pr-3 font-bold">Subject</th>
                      <th className="pb-2 pr-3 text-right font-bold" title="Students you have given this paper to, one by one.">
                        Students
                      </th>
                      <th className="pb-2 pr-3 text-right font-bold" title="They have access but have not handed the paper in yet.">
                        Still to sit
                      </th>
                      <th className="pb-2 pr-3 text-right font-bold" title="Finished and graded — these are the results waiting for you.">
                        Results in
                      </th>
                      <th className="pb-2 pr-3 text-right font-bold" title="Mean of the finished papers only.">
                        Average
                      </th>
                      <th className="pb-2 text-right font-bold">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleGiven.map((r) => {
                      const s = r.summary;
                      return (
                        <tr key={r.midterm.id} className="border-t border-border align-middle">
                          <td className="py-2.5 pr-3">
                            <Link
                              href={`/teacher/midterms/${r.midterm.id}`}
                              className="font-semibold text-foreground hover:text-primary"
                            >
                              {r.midterm.title}
                            </Link>
                            <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                              {r.midterm.duration_minutes} min · {r.midterm.question_count} questions ·{" "}
                              {scoringScaleLabel(r.midterm.scoring_scale, r.midterm.score_ceiling)}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-muted-foreground">{subjectLabel(r.midterm.subject)}</td>
                          <td className="py-2.5 pr-3 text-right font-semibold text-foreground tabular-nums">
                            {s ? s.granted : <Unknown title="We could not read this midterm's access list." />}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-foreground">
                            {s ? s.outstanding : <Unknown title="We could not read this midterm's access list." />}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-foreground">
                            {s ? s.submitted : <Unknown title="We could not read this midterm's access list." />}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-foreground">
                            {s?.average_score != null ? (
                              `${s.average_score} / ${s.score_ceiling}`
                            ) : (
                              <Unknown title="Nobody has finished this midterm yet, so there is no average to show." />
                            )}
                          </td>
                          <td className="py-2.5 text-right">
                            <Link
                              href={`/teacher/midterms/${r.midterm.id}`}
                              aria-label={`Open ${r.midterm.title}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                            >
                              Open <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : (
        <Card className="mt-4">
          <CardHeader
            title="All published midterms"
            description="Every paper you can give out. Open one to pick the students who should sit it."
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder="Search by midterm title"
                aria-label="Search the midterm catalog"
                className="pl-9"
              />
            </div>
            <div className="w-56">
              <Select
                value={catalogSubject}
                onChange={(e) => setCatalogSubject(e.target.value as "all" | "READING_WRITING" | "MATH")}
                aria-label="Filter by subject"
              >
                <option value="all">Every subject</option>
                <option value="READING_WRITING">Reading &amp; Writing</option>
                <option value="MATH">Mathematics</option>
              </Select>
            </div>
          </div>

          {visibleCatalog.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No midterm matches those filters"
              description="Try a different subject, or clear the search to see the whole catalog."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCatalogQuery("");
                    setCatalogSubject("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <>
              <p className="mt-4 text-xs font-medium text-muted-foreground">
                Showing <span className="tabular-nums">{visibleCatalog.length}</span> of{" "}
                <span className="tabular-nums">{items.length}</span> published midterms
              </p>
              <div className="mt-2 space-y-2.5">
                {visibleCatalog.map((m) => {
                  const row = summaryById.get(m.id);
                  const s = row?.summary;
                  return (
                    <Link
                      key={m.id}
                      href={`/teacher/midterms/${m.id}`}
                      className="flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3.5 transition hover:border-primary/40"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">
                        <FileText className="h-5 w-5" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-foreground">{m.title}</p>
                        <span className="mt-0.5 block">
                          <MidtermMeta m={m} />
                        </span>
                      </div>
                      <div className="shrink-0">
                        {row && !s ? (
                          <Pill tone="warning">Not checked</Pill>
                        ) : s && s.granted > 0 ? (
                          <Pill tone="success">
                            Given to <span className="tabular-nums">{s.granted}</span>
                          </Pill>
                        ) : (
                          <Pill tone="neutral">Not given out</Pill>
                        )}
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   /teacher/midterms/[midtermId] — one paper: who has it, who has sat it
   ──────────────────────────────────────────────────────────────────────────── */

type DetailSort = "score" | "name" | "status";

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
        message: vars.allow
          ? "Re-sit allowed — they can sit this paper once more."
          : "Re-sit withdrawn.",
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

  const backLink = (
    <Link
      href="/teacher/midterms"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden /> All midterms
    </Link>
  );

  // ── loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className={SHELL}>
        {backLink}
        <LoadingState label="Loading this midterm…" />
      </div>
    );
  }

  // ── error (never an empty state) ───────────────────────────────────────────
  if (isError || !data || !midterm) {
    return (
      <div className={SHELL}>
        {backLink}
        <ErrorState
          title="We couldn't load this midterm."
          message="Its access list and results didn't come back. Nobody has lost access — this is the page failing to read it."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  // ── data (the results table carries its own empty branch) ──────────────────
  const showPicker = pickerOpen ?? students.length === 0;
  const filtering = query.trim() !== "" || statusFilter !== "all";

  return (
    <div className={SHELL}>
      {backLink}

      <div className="mt-3">
        <PageHeader
          title={midterm.title}
          description="Standalone access: the students you have named, sitting this paper on their own time. No class window, no access code."
          actions={
            <Button
              variant={showPicker ? "secondary" : "primary"}
              icon={UserPlus}
              onClick={() => setPickerOpen(!showPicker)}
            >
              {showPicker ? "Close" : "Give access"}
            </Button>
          }
          className="mb-4"
        />
        <MidtermMeta m={midterm} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Students with access" value={summary.granted} icon={Users} />
        <StatCard
          label="Still to sit"
          value={summary.outstanding}
          icon={Hourglass}
          sub={summary.in_progress > 0 ? `${summary.in_progress} in progress right now` : undefined}
        />
        <StatCard label="Results in" value={summary.submitted} icon={ClipboardCheck} />
        <StatCard
          label="Average score"
          value={summary.average_score != null ? `${summary.average_score} / ${summary.score_ceiling}` : "—"}
          icon={FileText}
          sub={
            summary.average_score != null
              ? `Across ${summary.submitted} finished paper${summary.submitted === 1 ? "" : "s"}`
              : "Nobody has finished it yet"
          }
        />
      </div>

      {showPicker && (
        <Card className="mt-4">
          <CardHeader
            title="Give access to students"
            description="Pick individual students. The midterm appears in their own list immediately, and their certificate is issued in your name."
          />
          <div className="mt-4">
            <StudentMultiSelect value={picked} onChange={setPicked} showClassroomFilter={false} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              icon={UserPlus}
              loading={grant.isPending}
              disabled={picked.length === 0}
              onClick={() => grant.mutate()}
            >
              Give access to {picked.length} student{picked.length === 1 ? "" : "s"}
            </Button>
            {picked.length === 0 && (
              <span className="text-xs text-muted-foreground">Choose at least one student first.</span>
            )}
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader
          title="Results"
          description="Everyone you have given this paper to, and where they have got to."
        />

        {students.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search students by name"
                aria-label="Search students"
                className="pl-9"
              />
            </div>
            <div className="w-44">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as MidtermProgress | "all")}
                aria-label="Filter by status"
              >
                {PROGRESS_FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-44">
              <Select value={sort} onChange={(e) => setSort(e.target.value as DetailSort)} aria-label="Sort students">
                <option value="score">Highest score first</option>
                <option value="name">Name (A–Z)</option>
                <option value="status">Status</option>
              </Select>
            </div>
          </div>
        )}

        {students.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="Nobody has this midterm yet"
            description="Give it to the students who should sit it and they will appear here — with their status, score and re-sit permission — as they work through it."
            action={
              !showPicker ? (
                <Button icon={UserPlus} onClick={() => setPickerOpen(true)}>
                  Give access
                </Button>
              ) : undefined
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No student matches those filters"
            description="Try a different status, or clear the search to see everyone with access."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <p className="mt-4 text-xs font-medium text-muted-foreground">
              Showing <span className="tabular-nums">{visible.length}</span> of{" "}
              <span className="tabular-nums">{students.length}</span> student
              {students.length === 1 ? "" : "s"} with access
              {filtering ? " (filtered)" : ""} · <span className="tabular-nums">{summary.submitted}</span> finished ·{" "}
              <span className="tabular-nums">{summary.outstanding}</span> still to sit
              {summary.resit_open > 0 && (
                <>
                  {" "}
                  · <span className="tabular-nums">{summary.resit_open}</span> holding a re-sit
                </>
              )}
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 font-bold">Student</th>
                    <th className="pb-2 pr-3 font-bold">Status</th>
                    <th className="pb-2 pr-3 text-right font-bold">Score</th>
                    <th className="pb-2 pr-3 text-right font-bold">Sittings</th>
                    <th className="pb-2 pr-3 font-bold">Re-sit</th>
                    <th className="pb-2 text-right font-bold">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => {
                    const progress = midtermProgress(s);
                    return (
                      <tr key={s.student_id} className="border-t border-border align-middle">
                        <td className="py-2.5 pr-3 font-semibold text-foreground">
                          <span className="flex items-center gap-2">
                            <Avatar src={s.student_profile_image_url} name={s.student_name} size={26} />
                            <span className="truncate">{s.student_name}</span>
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <Pill
                            tone={progressTone[progress]}
                            dot
                            className={progress === "voided" ? "cursor-help" : undefined}
                          >
                            <span
                              title={
                                progress === "voided"
                                  ? "An administrator voided this sitting so it can be re-graded or sat again."
                                  : undefined
                              }
                            >
                              {midtermStateLabel(s.state)}
                            </span>
                          </Pill>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-foreground">
                          {s.submitted && s.score != null ? (
                            `${s.score} / ${s.score_ceiling}`
                          ) : (
                            <Unknown title="They have not handed this paper in yet, so there is no score." />
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{s.sittings}</td>
                        <td className="py-2.5 pr-3">
                          {s.submitted ? (
                            <Button
                              variant={s.resit_open ? "secondary" : "ghost"}
                              size="sm"
                              icon={s.resit_open ? Check : undefined}
                              loading={resit.isPending && resit.variables?.userId === s.student_id}
                              onClick={() => resit.mutate({ userId: s.student_id, allow: !s.resit_open })}
                              title={
                                s.resit_open
                                  ? "They may sit this paper once more. Click to take that back."
                                  : "Let them sit this paper again — for a student who repeated the month."
                              }
                            >
                              {s.resit_open ? "Re-sit allowed" : "Allow re-sit"}
                            </Button>
                          ) : (
                            <Unknown title="A re-sit is only for a paper they have already handed in." />
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={UserMinus}
                            className="text-muted-foreground hover:text-danger"
                            onClick={() => setRevoking(s)}
                            title={`Remove ${s.student_name}'s access to this midterm`}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={revoking !== null}
        tone="danger"
        title="Remove access to this midterm?"
        description={
          revoking
            ? `${revoking.student_name} will no longer see “${midterm.title}” in their midterm list.`
            : undefined
        }
        confirmLabel="Remove access"
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.student_id)}
        onCancel={() => setRevoking(null)}
      >
        <p className="text-sm text-muted-foreground">
          {revoking?.submitted
            ? "They have already sat it, so their score and certificate stay exactly as they are. You can give access back at any time."
            : "They have not sat it yet, so nothing is lost. You can give access back at any time."}
        </p>
      </ConfirmDialog>
    </div>
  );
}
