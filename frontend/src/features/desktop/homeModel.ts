/**
 * What "Your tests" shows, as plain data — the component only lays it out.
 *
 * Past papers group by sitting month (newest first) with Reading & Writing before Math inside
 * a month, exactly as the site's Past Papers page orders them. Card states come from the same
 * `cardState` the site uses, so a paper is "in progress" in exactly the same cases.
 */
import type { PastpaperSection } from "@/lib/api";
import type { MidtermRow } from "@/lib/midtermApi";
import { isResumable } from "@/lib/midtermBuckets";
import { cardState, type CardAttempt, type CardState } from "@/features/pastpapers/pastpaperCardState";
import { collectionLabel, isRW } from "@/features/pastpapers/pastpaperLabels";
import type { ReopenedPastpaper } from "@/features/pastpapers/pastpaperReportApi";

export interface PaperRow {
  section: PastpaperSection;
  state: CardState;
}

export interface PaperGroup {
  name: string;
  items: PaperRow[];
}

export function groupPastpapers(
  sections: PastpaperSection[],
  attempts: CardAttempt[],
  reopened: ReopenedPastpaper[],
): PaperGroup[] {
  const byTest = new Map<number, CardAttempt[]>();
  for (const a of attempts) {
    const list = byTest.get(a.practice_test) ?? [];
    list.push(a);
    byTest.set(a.practice_test, list);
  }
  const reopenedByTest = new Map(reopened.map((r) => [r.practice_test_id, r]));

  const groups = new Map<string, { items: PaperRow[]; sortKey: string }>();
  for (const section of sections) {
    const name = collectionLabel(section);
    const group = groups.get(name) ?? { items: [], sortKey: section.practice_date || "" };
    group.items.push({ section, state: cardState(byTest.get(section.id) ?? [], reopenedByTest.get(section.id)) });
    groups.set(name, group);
  }
  const subjectRank = (s: PastpaperSection) => (isRW(s.subject) ? 0 : 1);
  return Array.from(groups.entries())
    .map(([name, g]) => ({
      name,
      sortKey: g.sortKey,
      items: g.items.sort((a, b) => {
        const c = (a.section.collection_name || "").localeCompare(b.section.collection_name || "");
        return c !== 0 ? c : subjectRank(a.section) - subjectRank(b.section);
      }),
    }))
    .sort((a, b) => (b.sortKey || "").localeCompare(a.sortKey || ""))
    .map(({ name, items }) => ({ name, items }));
}

/** The one button on a past-paper card. */
export function paperAction(state: CardState): { label: string; finished: boolean } {
  switch (state.status) {
    case "progress":
      return { label: "Resume", finished: false };
    case "reopened":
      return { label: "Start again", finished: false };
    case "completed":
      return { label: "See score", finished: true };
    default:
      return { label: "Start", finished: false };
  }
}

export type MidtermCardKind = "available" | "scheduled" | "missed" | "past";

/** The one line under a midterm's title, or its button label when it can be opened. */
export function midtermStatus(m: MidtermRow, kind: MidtermCardKind): { label: string; actionable: boolean } {
  if (kind === "available") return { label: isResumable(m) ? "Resume" : "Start", actionable: true };
  if (kind === "scheduled") {
    if (m.awaiting_code) return { label: "Waiting for your teacher to start it", actionable: false };
    return { label: m.available_at ? `Opens ${fmtWhen(m.available_at)}` : "Opens soon", actionable: false };
  }
  if (kind === "past") {
    if (m.results_visible && m.score != null) return { label: `Score ${m.score} / ${m.score_ceiling}`, actionable: false };
    return { label: "Finished — your result is on its way", actionable: false };
  }
  return { label: "Not taken", actionable: false };
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "soon";
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
