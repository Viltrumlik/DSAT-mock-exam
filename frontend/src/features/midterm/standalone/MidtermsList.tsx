"use client";

/**
 * /teacher/midterms — what I have given out, then the catalog.
 *
 * Standalone means ONE TEACHER GIVING ONE PAPER TO NAMED STUDENTS: a per-student
 * ResourceAccessGrant with classroom = NULL. That is the whole scope of this page, and it is
 * also the thing teachers got wrong — a midterm assigned through a classroom is a different
 * object (a MidtermSchedule on that class) and never appears here, so the page header says
 * where those live, once, rather than letting a teacher conclude the page is broken.
 *
 * The page answers, in order: which midterms have I given out, who still has to sit them, and
 * whose results are waiting for me. The published catalog is still one click away — granting
 * access is the point of the page — but it no longer leads.
 *
 * Backed by /midterms/teacher/* (see backend/midterms/views_teacher.py). There is no
 * server-side roll-up for this area, so the overview asks each midterm's results endpoint with
 * bounded concurrency (see fetchStandaloneOverview).
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronRight, ClipboardCheck, FileText } from "lucide-react";
import {
  fetchStandaloneOverview,
  midtermApi,
  scoringScaleLabel,
  subjectLabel,
  type MidtermCatalogItem,
  type StandaloneOverviewRow,
} from "@/lib/midtermApi";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Pill,
  Skeleton,
  Stat,
  TeacherPage,
  type Column,
} from "@/features/teacher/ui";
import { Choice, ColumnHint, FilterBar, MidtermMeta, SearchBox, ShowingLine, StatRow, Tabs, Unknown } from "./shared";

type ListTab = "given" | "catalog";
type GivenSort = "results" | "outstanding" | "students" | "title";
type CatalogSubject = "all" | "READING_WRITING" | "MATH";

const GIVEN_SORTS: { value: GivenSort; label: string }[] = [
  { value: "results", label: "Most results in" },
  { value: "outstanding", label: "Most still to sit" },
  { value: "students", label: "Most students" },
  { value: "title", label: "Title (A–Z)" },
];

const SUBJECTS: { value: CatalogSubject; label: string }[] = [
  { value: "all", label: "Every subject" },
  { value: "READING_WRITING", label: "Reading & Writing" },
  { value: "MATH", label: "Mathematics" },
];

/** Why a figure in this table is an em dash. One sentence, reused by four columns. */
const UNCHECKED = "We could not read this midterm's access list.";

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
  const [catalogSubject, setCatalogSubject] = useState<CatalogSubject>("all");

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
  // different object, kept somewhere else — is said once, in the frame every state renders.
  const page = (children: ReactNode) => (
    <TeacherPage
      title="Midterms"
      subtitle="Midterms you give to named students. A midterm given to a whole class lives in that classroom’s own Midterms tab."
    >
      {children}
    </TeacherPage>
  );

  // ── loading ───────────────────────────────────────────────────────────────
  if (catalog.isLoading || (ids.length > 0 && overview.isPending)) {
    return page(
      <Card title="Checking which midterms you have given out…">
        <Skeleton height={40} count={6} />
      </Card>,
    );
  }

  // ── error (never an empty state) ───────────────────────────────────────────
  if (catalog.isError) {
    return page(
      <Card>
        <ErrorState
          title="We couldn't load your midterms"
          detail="The midterm list didn't come back. This is a loading problem, not an empty page — nothing has been lost."
          onRetry={() => void catalog.refetch()}
        />
      </Card>,
    );
  }
  // The partial failure that is total: the catalog answered, so there ARE midterms, but every
  // request for who has access failed. Falling through to the table would print a page of em
  // dashes; falling through to the empty state would tell a teacher their grants are gone.
  if (rows.length > 0 && totals.unchecked === rows.length) {
    return page(
      <Card>
        <ErrorState
          title="We couldn't check any of your midterms"
          detail="The catalog loaded, but every request for who has access failed. Your grants are untouched — this is only the page failing to read them."
          onRetry={() => void overview.refetch()}
        />
      </Card>,
    );
  }

  // ── empty ─────────────────────────────────────────────────────────────────
  if (items.length === 0) {
    return page(
      <Card>
        <EmptyState
          title="No published midterms yet"
          hint="Midterm papers are written and published in the Builder. Once one is published it appears here, ready to give to students."
        />
      </Card>,
    );
  }

  // ── data ──────────────────────────────────────────────────────────────────
  return page(
    <>
      <Card>
        <StatRow>
          <Stat label="Midterms given out" value={totals.givenOut} hint={`of ${items.length} published`} />
          <Stat label="Students with access" value={totals.students} tone="info" />
          <Stat label="Still to sit" value={totals.outstanding} hint="Granted, not handed in" tone="warning" />
          <Stat label="Results in" value={totals.resultsIn} hint="Finished and graded" tone="success" />
        </StatRow>
      </Card>

      {/* A count built from a partial answer must say so where the count is, not in a log. The
          totals above are a floor, and the teacher is the only one who can decide whether that
          is good enough for what they are about to do with them. */}
      {totals.unchecked > 0 && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, color: "var(--dz-ink)", minWidth: 0, flex: "1 1 320px" }}>
              <strong style={{ fontWeight: 800 }}>
                {totals.unchecked} of {rows.length} midterms could not be checked.
              </strong>{" "}
              <span style={{ color: "var(--dz-mute)" }}>
                The figures above leave them out, so read them as a floor rather than the full count.
              </span>
            </div>
            <Button variant="ghost" busy={overview.isFetching} onClick={() => void overview.refetch()}>
              Check again
            </Button>
          </div>
        </Card>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "given", label: "Given out", count: givenRows.length, icon: <ClipboardCheck size={14} aria-hidden /> },
          { id: "catalog", label: "All midterms", count: items.length, icon: <BookOpen size={14} aria-hidden /> },
        ]}
      />

      {tab === "given" ? (
        <GivenOut
          rows={visibleGiven}
          total={givenRows.length}
          query={givenQuery}
          onQuery={setGivenQuery}
          sort={givenSort}
          onSort={setGivenSort}
          onBrowseCatalog={() => setTab("catalog")}
        />
      ) : (
        <Catalog
          items={visibleCatalog}
          total={items.length}
          summaryById={summaryById}
          query={catalogQuery}
          onQuery={setCatalogQuery}
          subject={catalogSubject}
          onSubject={setCatalogSubject}
        />
      )}
    </>,
  );
}

/* ── the papers this teacher has handed out ──────────────────────────────── */

function GivenOut({ rows, total, query, onQuery, sort, onSort, onBrowseCatalog }: {
  rows: StandaloneOverviewRow[];
  total: number;
  query: string;
  onQuery: (v: string) => void;
  sort: GivenSort;
  onSort: (v: GivenSort) => void;
  onBrowseCatalog: () => void;
}) {
  const columns: Column<StandaloneOverviewRow>[] = [
    {
      key: "midterm",
      header: "Midterm",
      render: (r) => (
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Link
            href={`/teacher/midterms/${r.midterm.id}`}
            style={{ fontWeight: 700, color: "var(--dz-indigo)", textDecoration: "none" }}
          >
            {r.midterm.title}
          </Link>
          <span style={{ fontSize: 12, color: "var(--dz-mute)" }}>
            {r.midterm.duration_minutes} min · {r.midterm.question_count} questions ·{" "}
            {scoringScaleLabel(r.midterm.scoring_scale, r.midterm.score_ceiling)}
          </span>
        </span>
      ),
    },
    { key: "subject", header: "Subject", render: (r) => subjectLabel(r.midterm.subject) },
    {
      key: "students",
      header: <ColumnHint hint="Students you have given this paper to, one by one.">Students</ColumnHint>,
      align: "right",
      render: (r) => (r.summary ? r.summary.granted : <Unknown title={UNCHECKED} />),
    },
    {
      key: "outstanding",
      header: <ColumnHint hint="They have access but have not handed the paper in yet.">Still to sit</ColumnHint>,
      align: "right",
      render: (r) => (r.summary ? r.summary.outstanding : <Unknown title={UNCHECKED} />),
    },
    {
      key: "results",
      header: <ColumnHint hint="Finished and graded — these are the results waiting for you.">Results in</ColumnHint>,
      align: "right",
      render: (r) => (r.summary ? r.summary.submitted : <Unknown title={UNCHECKED} />),
    },
    {
      key: "average",
      header: <ColumnHint hint="Mean of the finished papers only.">Average</ColumnHint>,
      align: "right",
      render: (r) =>
        r.summary?.average_score != null ? (
          `${r.summary.average_score} / ${r.summary.score_ceiling}`
        ) : (
          <Unknown
            title={
              r.summary
                ? "Nobody has finished this midterm yet, so there is no average to show."
                : UNCHECKED
            }
          />
        ),
    },
    {
      key: "open",
      header: "Open",
      align: "right",
      render: (r) => (
        <Link
          href={`/teacher/midterms/${r.midterm.id}`}
          aria-label={`Open ${r.midterm.title}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 13, fontWeight: 700, color: "var(--dz-indigo)", textDecoration: "none",
          }}
        >
          Open <ChevronRight size={14} aria-hidden />
        </Link>
      ),
    },
  ];

  return (
    <Card title="Midterms you have given out" subtitle={total > 0 ? `${total} ${total === 1 ? "paper" : "papers"}` : undefined}>
      {total === 0 ? (
        <EmptyState
          title="You haven't given a midterm to anyone yet"
          hint="Pick a paper from All midterms and grant it to the students who need to sit it. They will find it in their own midterm list straight away."
          action={
            <Button variant="ghost" onClick={onBrowseCatalog}>
              <BookOpen size={15} aria-hidden />
              Browse all midterms
            </Button>
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <FilterBar>
            <SearchBox
              value={query}
              onChange={onQuery}
              placeholder="Search by midterm title"
              label="Search midterms you have given out"
            />
            <Choice value={sort} onChange={onSort} label="Sort midterms" options={GIVEN_SORTS} width={200} />
          </FilterBar>
          {rows.length > 0 && (
            <ShowingLine>
              Showing {rows.length} of {total} midterms you have given out
            </ShowingLine>
          )}
          <DataTable
            label="Midterms you have given out"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.midterm.id}
            empty={
              <EmptyState
                title="No midterm matches that search"
                hint="Try a shorter title, or clear the search to see every midterm you have given out."
                action={
                  <Button variant="ghost" onClick={() => onQuery("")}>
                    Clear search
                  </Button>
                }
              />
            }
          />
        </div>
      )}
    </Card>
  );
}

/* ── every published paper, and whether it has gone anywhere ─────────────── */

function Catalog({ items, total, summaryById, query, onQuery, subject, onSubject }: {
  items: MidtermCatalogItem[];
  total: number;
  summaryById: Map<number, StandaloneOverviewRow>;
  query: string;
  onQuery: (v: string) => void;
  subject: CatalogSubject;
  onSubject: (v: CatalogSubject) => void;
}) {
  return (
    <Card title="All published midterms" subtitle="Open one to pick the students who should sit it.">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <FilterBar>
          <SearchBox
            value={query}
            onChange={onQuery}
            placeholder="Search by midterm title"
            label="Search the midterm catalog"
          />
          <Choice value={subject} onChange={onSubject} label="Filter by subject" options={SUBJECTS} width={200} />
        </FilterBar>

        {items.length === 0 ? (
          <EmptyState
            title="No midterm matches those filters"
            hint="Try a different subject, or clear the search to see the whole catalog."
            action={
              <Button
                variant="ghost"
                onClick={() => {
                  onQuery("");
                  onSubject("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <ShowingLine>
              Showing {items.length} of {total} published midterms
            </ShowingLine>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((m) => {
                const row = summaryById.get(m.id);
                const s = row?.summary;
                return (
                  <li key={m.id}>
                    <Link
                      href={`/teacher/midterms/${m.id}`}
                      style={{
                        display: "flex", alignItems: "center", gap: 14,
                        border: "1px solid var(--dz-border)", borderRadius: 18,
                        background: "var(--dz-panel)", padding: "13px 16px",
                        textDecoration: "none", color: "inherit",
                      }}
                    >
                      <span
                        style={{
                          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                          background: "var(--dz-indigo-soft)", color: "var(--dz-indigo)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <FileText size={19} aria-hidden />
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span
                          style={{
                            display: "block", fontWeight: 700, color: "var(--dz-ink)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          {m.title}
                        </span>
                        <MidtermMeta m={m} />
                      </span>
                      <span style={{ flexShrink: 0 }}>
                        {/* Three answers, and the first is not the second: a midterm whose
                            check FAILED is not a midterm nobody has. Collapsing them would
                            tell a teacher they never gave out a paper they did give out. */}
                        {row && !s ? (
                          <Pill tone="warning">Not checked</Pill>
                        ) : s && s.granted > 0 ? (
                          <Pill tone="success">Given to {s.granted}</Pill>
                        ) : (
                          <Pill tone="neutral">Not given out</Pill>
                        )}
                      </span>
                      <ChevronRight size={18} aria-hidden style={{ flexShrink: 0, color: "var(--dz-faint)" }} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
