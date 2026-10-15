"use client";

/**
 * /practice-tests — the centre's own practice tests (owner decisions 2026-10-14/15). Each card is
 * ONE section on the past-paper engine and looks like a past-paper booklet; the server decides
 * which ones this student sees (Open + level, or given as homework). Newest number first, with a
 * subject and a status filter. Timed/Untimed is chosen on the runner's Welcome screen.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
// eslint-disable-next-line no-restricted-imports
import { examsPublicApi } from "@/lib/api";
import { cardState } from "@/features/pastpapers/pastpaperCardState";
import { isRW, levelLabel, sectionTitle, subjectLabel } from "@/features/pastpapers/pastpaperLabels";
import { Booklet, PapersEmpty, PapersError, Segmented, usePaperLibrary } from "@/features/pastpapers/PaperLibrary";
import { Search } from "lucide-react";

type SubjectFilter = "ALL" | "RW" | "MATH";
type StatusFilter = "ALL" | "new" | "progress" | "completed";

export default function PracticeTestsPage() {
  const router = useRouter();
  const lib = usePaperLibrary({ loadSections: examsPublicApi.getPracticeTestSections, backHref: "/practice-tests" });
  const [subject, setSubject] = useState<SubjectFilter>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    return lib.sections
      .map((s) => ({ section: s, d: cardState(lib.byTest.get(s.id) ?? [], lib.reopened.get(s.id)) }))
      .filter(({ section, d }) => {
        if (subject === "RW" && !isRW(section.subject)) return false;
        if (subject === "MATH" && isRW(section.subject)) return false;
        const bucket = d.status === "reopened" ? "new" : d.status;
        if (status !== "ALL" && bucket !== status) return false;
        if (q && !`${sectionTitle(section)} ${section.title} ${subjectLabel(section.subject)}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) =>
        (b.section.practice_number ?? 0) - (a.section.practice_number ?? 0)
        || (isRW(a.section.subject) ? 0 : 1) - (isRW(b.section.subject) ? 0 : 1)
        || b.section.id - a.section.id);
  }, [lib.sections, lib.byTest, lib.reopened, subject, status, search]);

  const hasFilter = subject !== "ALL" || status !== "ALL" || !!search.trim();

  return (
    <div className="dzboard" style={{ maxWidth: 1280, width: "100%", margin: "0 auto" }}>
      <div className="dz-content">
        <div style={{ marginBottom: 22 }}>
          <div className="dz-headin" style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".18em", color: "var(--dz-faint)" }}>SIMULATION</div>
          <h1 className="dz-headin" style={{ margin: "8px 0 0", fontSize: 38, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)" }}>Practice tests</h1>
        </div>

        <div className="dz-headin" style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 20, flexWrap: "wrap" }}>
          <Segmented label="Subject" value={subject} onChange={(v) => setSubject(v as SubjectFilter)}
            options={[{ v: "ALL", l: "All" }, { v: "RW", l: "Reading & Writing" }, { v: "MATH", l: "Math" }]} />
          <Segmented label="Status" value={status} onChange={(v) => setStatus(v as StatusFilter)}
            options={[{ v: "ALL", l: "All" }, { v: "new", l: "New" }, { v: "progress", l: "In progress" }, { v: "completed", l: "Completed" }]} />
        </div>

        <div className="dz-headin" style={{ position: "relative", marginBottom: 24, maxWidth: 560 }}>
          <span style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "var(--dz-faint)", display: "flex" }}><Search size={18} /></span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search practice tests…"
            style={{ width: "100%", border: "1px solid var(--dz-border)", background: "var(--dz-panel)", borderRadius: 14, padding: "14px 16px 14px 48px", fontFamily: "inherit", fontSize: 15, color: "var(--dz-ink)", outline: "none" }} />
        </div>

        {lib.error ? (
          <PapersError onRetry={lib.load} noun="practice tests" />
        ) : lib.loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 18 }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="dz-skel" style={{ height: 200, borderRadius: 18 }} />)}
          </div>
        ) : rows.length === 0 ? (
          <PapersEmpty hasFilter={hasFilter} noun="practice tests" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 18 }}>
            {rows.map((row) => (
              <Booklet
                key={row.section.id}
                section={row.section}
                d={row.d}
                badge={<LevelBadge code={row.section.practice_level ?? ""} />}
                meta={row.section.title?.trim() || "Timed or untimed — your choice"}
                busy={lib.starting === row.section.id}
                error={lib.startError?.sectionId === row.section.id ? lib.startError.msg : null}
                onOpen={() => void lib.handleOpen(row.section, row.d)}
                onReport={() => { if (row.d.completedAttemptId) router.push(`/pastpapers/${row.d.completedAttemptId}/report`); }}
                onHistory={() => { if (row.d.completedAttemptId) router.push(`/pastpapers/${row.d.completedAttemptId}/report#history`); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LevelBadge({ code }: { code: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: "var(--dz-indigo)", background: "var(--dz-indigo-soft)", padding: "4px 10px", borderRadius: 8 }}>
      {levelLabel(code)}
    </span>
  );
}
