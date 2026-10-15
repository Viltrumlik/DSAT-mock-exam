"use client";

/**
 * /pastpapers — Past papers library, 1:1 with the MasterSAT Past Papers mockup
 * (shared `.dzboard` scope): SIMULATION header, Region + Year + Status segmented
 * filters, search, and booklet cards with per-user state.
 *
 * Each card is ONE standalone section (a `PracticeTest`, subject MATH or
 * READING_WRITING). The former `PastpaperPack` grouping was removed on the
 * backend; sections carry `collection_name` (the former pack title) which we use
 * to visually group cards. Status + per-section score are derived from the
 * student's attempts (GET /exams/attempts/). Each section is scored standalone
 * (200–800 style); there is no composite /1600. Clicking a card starts/resumes
 * that single section's attempt directly (POST /exams/attempts/ → /exam/{id}).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
// Public pastpaper sections + attempts live only on examsPublicApi; no feature wrapper exists.
// eslint-disable-next-line no-restricted-imports
import { examsPublicApi, type PastpaperSection } from "@/lib/api";
import { cardState, type CardState } from "@/features/pastpapers/pastpaperCardState";
import { Booklet, PapersEmpty, PapersError, Segmented, usePaperLibrary } from "@/features/pastpapers/PaperLibrary";
import { Search } from "lucide-react";

import {
  collectionLabel, fmtMonth, isRW, sectionTitle, subjectLabel, yearOf,
} from "@/features/pastpapers/pastpaperLabels";

type Derived = CardState;

type Region = "ALL" | "US" | "INTL";
type StatusFilter = "ALL" | "new" | "progress" | "completed";

export default function PastpapersPage() {
  const router = useRouter();
  const lib = usePaperLibrary({ loadSections: examsPublicApi.getPastpaperSections, backHref: "/pastpapers" });
  const [region, setRegion] = useState<Region>("ALL");
  const [year, setYear] = useState<string>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const s of lib.sections) { const y = yearOf(s.practice_date); if (y) set.add(y); }
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [lib.sections]);

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    return lib.sections
      .map((s) => ({ section: s, d: cardState(lib.byTest.get(s.id) ?? [], lib.reopened.get(s.id)) }))
      .filter(({ section, d }) => {
        if (region === "US" && section.form_type !== "US") return false;
        if (region === "INTL" && section.form_type === "US") return false;
        if (year !== "ALL" && yearOf(section.practice_date) !== year) return false;
        // A paper set again is work to start, so it sits under "New".
        const bucket = d.status === "reopened" ? "new" : d.status;
        if (status !== "ALL" && bucket !== status) return false;
        if (q) {
          const blob = `${sectionTitle(section)} ${collectionLabel(section)} ${section.label || ""} ${section.form_type || ""} ${subjectLabel(section.subject)} ${fmtMonth(section.practice_date)}`.toLowerCase();
          if (!blob.includes(q)) return false;
        }
        return true;
      });
  }, [lib.sections, lib.byTest, lib.reopened, region, year, status, search]);

  // Group filtered cards by sitting MONTH (one header per month); within a month
  // order by variant then subject so each paper's R&W + Math sit together, and
  // list months newest-first.
  const groups = useMemo(() => {
    const map = new Map<string, { section: PastpaperSection; d: Derived }[]>();
    for (const row of rows) {
      const key = collectionLabel(row.section);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    const subjRank = (s: PastpaperSection) => (isRW(s.subject) ? 0 : 1);
    for (const items of map.values()) {
      items.sort((a, b) => {
        const c = (a.section.collection_name || "").localeCompare(b.section.collection_name || "");
        return c !== 0 ? c : subjRank(a.section) - subjRank(b.section);
      });
    }
    return Array.from(map.entries())
      .map(([name, items]) => ({ name, items, sortKey: items[0]?.section.practice_date || "" }))
      .sort((a, b) => (b.sortKey || "").localeCompare(a.sortKey || ""))
      .map(({ name, items }) => ({ name, items }));
  }, [rows]);

  const hasFilter = region !== "ALL" || year !== "ALL" || status !== "ALL" || !!search.trim();

  return (
    <div className="dzboard" style={{ maxWidth: 1280, width: "100%", margin: "0 auto" }}>
      <div className="dz-content">
        <div style={{ marginBottom: 22 }}>
          <div className="dz-headin" style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".18em", color: "var(--dz-faint)" }}>SIMULATION</div>
          <h1 className="dz-headin" style={{ margin: "8px 0 0", fontSize: 38, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)" }}>Past papers</h1>
        </div>

        <div className="dz-headin" style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 20, flexWrap: "wrap" }}>
          <Segmented label="REGION" value={region} onChange={(v) => setRegion(v as Region)}
            options={[{ v: "ALL", l: "All" }, { v: "US", l: "US" }, { v: "INTL", l: "International" }]} />
          {years.length > 0 ? (
            <Segmented label="YEAR" value={year} onChange={setYear}
              options={[{ v: "ALL", l: "All" }, ...years.map((y) => ({ v: y, l: y }))]} />
          ) : null}
          <Segmented label="STATUS" value={status} onChange={(v) => setStatus(v as StatusFilter)}
            options={[{ v: "ALL", l: "All" }, { v: "new", l: "New" }, { v: "progress", l: "In progress" }, { v: "completed", l: "Completed" }]} />
        </div>

        <div className="dz-headin" style={{ position: "relative", marginBottom: 24, maxWidth: 560 }}>
          <span style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "var(--dz-faint)", display: "flex" }}><Search size={18} /></span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search past papers…"
            style={{ width: "100%", border: "1px solid var(--dz-border)", background: "var(--dz-panel)", borderRadius: 14, padding: "14px 16px 14px 48px", fontFamily: "inherit", fontSize: 15, color: "var(--dz-ink)", outline: "none" }} />
        </div>

        {lib.error ? (
          <PapersError onRetry={lib.load} />
        ) : lib.loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 18 }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="dz-skel" style={{ height: 200, borderRadius: 18 }} />)}
          </div>
        ) : groups.length === 0 ? (
          <PapersEmpty hasFilter={hasFilter} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
            {groups.map((g) => (
              <div key={g.name}>
                <div className="dz-headin" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--dz-mute)" }}>{g.name}</span>
                  <span style={{ flex: 1, height: 1, background: "var(--dz-border)" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 18 }}>
                  {g.items.map(({ section, d }) => (
                    <Booklet
                      key={section.id}
                      section={section}
                      d={d}
                      busy={lib.starting === section.id}
                      error={lib.startError?.sectionId === section.id ? lib.startError.msg : null}
                      onOpen={() => void lib.handleOpen(section, d)}
                      onReport={() => { if (d.completedAttemptId) router.push(`/pastpapers/${d.completedAttemptId}/report`); }}
                      onHistory={() => { if (d.completedAttemptId) router.push(`/pastpapers/${d.completedAttemptId}/report#history`); }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
