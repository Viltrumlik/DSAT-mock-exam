"use client";

/**
 * /teacher/pastpapers — the past-paper library, on the host teachers actually sign in to.
 *
 * teacher.mastersat.uz serves nothing outside /teacher: every other path is bounced back to
 * the portal, which is why /pastpapers — a student route — has been unreachable for a teacher
 * however they arrived at it. Nothing was ever forbidden; GET /api/exams/ answers on this host
 * and narrows itself to the caller's own subject. This is the door on this side of the redirect.
 *
 * Read-only throughout. A row opens the paper to READ (see ./TeacherPaper); no sitting starts.
 *
 * Two of the student library's three filters survive here. Region and sitting year are facts
 * about the paper, so they still sort a shelf; the third, status, is derived from the reader's
 * own attempts, and a teacher has none — it would have been three buttons that changed nothing.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Calculator, Search } from "lucide-react";
import { Card, DataTable, EmptyState, ErrorState, Pill, Skeleton, TeacherPage, type Column } from "../ui";
import type { TeacherPaper } from "./api";
import { useTeacherPapers } from "./hooks";
import { isReadingWriting, paperTitle, regionLabel, searchBlob, sittingLabel, subjectLabel, variantLabel, yearOf } from "./labels";

type Region = "ALL" | "US" | "INTL";

export function TeacherPastpapers() {
  const router = useRouter();
  const query = useTeacherPapers();
  // Memoised so the empty fallback is the SAME array each render — otherwise the filtering
  // below re-runs on every keystroke's re-render whether or not anything changed.
  const papers = useMemo(() => query.data ?? [], [query.data]);

  const [region, setRegion] = useState<Region>("ALL");
  const [year, setYear] = useState("ALL");
  const [search, setSearch] = useState("");

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const p of papers) {
      const y = yearOf(p.sittingDate);
      if (y) set.add(y);
    }
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [papers]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return papers.filter((p) => {
      if (region === "US" && !p.isUS) return false;
      if (region === "INTL" && p.isUS) return false;
      if (year !== "ALL" && yearOf(p.sittingDate) !== year) return false;
      if (q && !searchBlob(p).includes(q)) return false;
      return true;
    });
  }, [papers, region, year, search]);

  const narrowed = region !== "ALL" || year !== "ALL" || search.trim() !== "";

  const columns: Column<TeacherPaper>[] = [
    {
      key: "title",
      header: "Paper",
      render: (p) => {
        const name = paperTitle(p);
        const variant = variantLabel(p);
        return (
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {/* The paper's name IS the way in, the way every other teacher table links (see
                dashboard/MidtermsCard). A bare row click reached nobody on a keyboard and
                nothing a screen reader could announce, told no one where the row went on
                hover, and could not be opened in a second tab. The row click below stays as
                a convenience for a mouse; it is no longer the only door. */}
            <Link
              href={`/teacher/pastpapers/${p.id}`}
              onClick={(e) => e.stopPropagation()}
              style={{ fontWeight: 700, color: "var(--dz-indigo)", textDecoration: "none" }}
            >
              {name}
            </Link>
            {/* `paperTitle` already falls back to the variant when a paper was imported with
                no title of its own — both fixtures in this slice's tests are such rows — so
                printing it again would stack "International Form A" on itself. */}
            {variant !== name && (
              <span style={{ fontSize: 12, color: "var(--dz-mute)" }}>{variant}</span>
            )}
          </span>
        );
      },
    },
    {
      key: "subject",
      header: "Subject",
      render: (p) => (
        <Pill tone={isReadingWriting(p.subject) ? "info" : "success"}>
          {isReadingWriting(p.subject) ? <BookOpen size={13} aria-hidden /> : <Calculator size={13} aria-hidden />}
          {subjectLabel(p.subject)}
        </Pill>
      ),
    },
    { key: "region", header: "Region", render: (p) => regionLabel(p) },
    { key: "sitting", header: "Sitting", render: (p) => sittingLabel(p.sittingDate) },
    {
      key: "modules",
      header: "Modules",
      align: "right",
      render: (p) => (p.moduleCount > 0 ? p.moduleCount : "—"),
    },
  ];

  return (
    <TeacherPage
      title="Past papers"
      subtitle="Every released paper in your subject. Open one to read it question by question."
    >
      <Card title="The library" subtitle={query.isSuccess ? `${papers.length} ${papers.length === 1 ? "paper" : "papers"}` : undefined}>
        {query.isError ? (
          <ErrorState
            title="The past papers didn't load"
            detail="The library did not answer. Nothing here is missing — we simply could not read it."
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <Skeleton height={40} count={6} />
        ) : papers.length === 0 ? (
          // The one case this page exists to get right: a teacher whose subject has no papers
          // must be told THAT, and never shown a blank page a failed request would look like.
          <EmptyState
            title="No past papers in your subject yet"
            hint="Released SAT papers appear here once the learning center adds them for your subject."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Filters
              region={region}
              onRegion={setRegion}
              year={year}
              onYear={setYear}
              years={years}
              search={search}
              onSearch={setSearch}
            />
            <DataTable
              label="Past papers"
              columns={columns}
              rows={rows}
              rowKey={(p) => p.id}
              onRowClick={(p) => router.push(`/teacher/pastpapers/${p.id}`)}
              // Comparing two papers means having two open. Same reason as the class list.
              rowHref={(p) => `/teacher/pastpapers/${p.id}`}
              empty={
                narrowed ? (
                  <EmptyState title="No paper matches" hint="Try another region, another year, or a shorter search." />
                ) : null
              }
            />
          </div>
        )}
      </Card>
    </TeacherPage>
  );
}

function Filters({
  region, onRegion, year, onYear, years, search, onSearch,
}: {
  region: Region; onRegion: (v: Region) => void;
  year: string; onYear: (v: string) => void; years: string[];
  search: string; onSearch: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <Segmented
        label="Region"
        value={region}
        onChange={(v) => onRegion(v as Region)}
        options={[{ v: "ALL", l: "All" }, { v: "INTL", l: "International" }, { v: "US", l: "US" }]}
      />
      {years.length > 1 && (
        <Segmented
          label="Year"
          value={year}
          onChange={onYear}
          options={[{ v: "ALL", l: "All" }, ...years.map((y) => ({ v: y, l: y }))]}
        />
      )}
      <label style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--dz-faint)", display: "flex" }}>
          <Search size={15} aria-hidden />
        </span>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search past papers…"
          aria-label="Search past papers"
          style={{
            width: "100%", boxSizing: "border-box",
            border: "1px solid var(--dz-border)", background: "var(--dz-panel)",
            borderRadius: 14, padding: "10px 14px 10px 36px",
            fontFamily: "inherit", fontSize: 14, color: "var(--dz-ink)", outline: "none",
          }}
        />
      </label>
    </div>
  );
}

/** The kit has no segmented control yet; this one is local until a second page needs it. */
function Segmented({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--dz-faint)" }}>
        {label}
      </span>
      <div role="group" aria-label={label} style={{ display: "flex", gap: 4, background: "var(--dz-neutral-soft)", borderRadius: 12, padding: 4 }}>
        {options.map((o) => {
          const active = o.v === value;
          return (
            <button
              key={o.v}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.v)}
              style={{
                padding: "6px 12px", borderRadius: 9, border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                background: active ? "var(--dz-indigo)" : "transparent",
                color: active ? "#fff" : "var(--dz-mute)",
              }}
            >
              {o.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}
