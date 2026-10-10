/**
 * "Your tests" as plain data + the pure rules that shape it.
 *
 * Ported from the website so a paper reads the same in the app as on the site:
 *   - midterm buckets  ← frontend/src/lib/midtermBuckets.ts
 *   - past-paper state  ← frontend/src/features/pastpapers/pastpaperCardState.ts
 *   - names + grouping  ← frontend/src/features/pastpapers/pastpaperLabels.ts + homeModel.ts
 * Keep these in step with their originals; the exam is the same exam in both places.
 */

// ───────────────────────────── midterms ─────────────────────────────

export interface MidtermCertificate {
  available: boolean;
  code: string;
  download_url: string;
  rank: number | null;
  cohort_size: number | null;
}

export interface MidtermRow {
  midterm_id: number;
  title: string;
  subject: string; // READING_WRITING | MATH
  scoring_scale: string; // SCALE_100 | SCALE_800
  score_ceiling: number;
  duration_minutes: number;
  question_count: number;
  flavor: "CLASSROOM" | "STANDALONE";
  attempt_id: number | null;
  state: string;
  submitted: boolean;
  /** An unspent re-sit for a paper they already finished — launchable again. */
  resit_open?: boolean;
  is_open: boolean;
  is_before_start: boolean; // scheduled window hasn't opened yet
  awaiting_code: boolean; // window open but teacher hasn't started it
  available_at: string | null;
  deadline: string | null;
  results_visible: boolean;
  score: number | null;
  certificate: MidtermCertificate | null;
}

export interface MidtermBuckets {
  available: MidtermRow[];
  scheduled: MidtermRow[];
  missed: MidtermRow[];
  past: MidtermRow[];
}

// A started-but-unfinished attempt is always resumable (even past the deadline).
export const isResumable = (m: MidtermRow) =>
  !m.submitted && m.attempt_id != null && m.state !== "NOT_STARTED";

export function bucketMidterms(midterms: MidtermRow[]): MidtermBuckets {
  const resumable = isResumable;
  return {
    available: midterms.filter((m) => m.resit_open || (!m.submitted && (resumable(m) || m.is_open))),
    scheduled: midterms.filter(
      (m) => !m.resit_open && !m.submitted && !m.is_open && !resumable(m) && (m.is_before_start || m.awaiting_code),
    ),
    missed: midterms.filter(
      (m) => !m.resit_open && !m.submitted && !m.is_open && !resumable(m) && !m.is_before_start && !m.awaiting_code,
    ),
    past: midterms.filter((m) => m.submitted && !m.resit_open),
  };
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

export const subjectLabel = (subject: string): string => {
  if (isRW(subject)) return "Reading & Writing";
  if (subject === "MATH" || subject?.toLowerCase().includes("math")) return "Mathematics";
  return subject;
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "soon";
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ─────────────────────────── past papers ───────────────────────────

export interface PastpaperSection {
  id: number;
  title: string;
  practice_date: string | null;
  subject: string; // "MATH" | "READING_WRITING"
  label: string;
  form_type: string; // "INTERNATIONAL" | "US"
  collection_name: string;
  is_published: boolean;
}

/** The fields of a `GET /exams/attempts/` row that a past-paper card reads. */
export interface CardAttempt {
  id: number;
  practice_test: number;
  is_completed: boolean;
  is_expired: boolean;
  score: number | null;
  completed_at?: string | null;
  submitted_at?: string | null;
  current_state?: string;
}

export interface ReopenedPastpaper {
  practice_test_id: number;
}

export type CardStatus = "new" | "progress" | "reopened" | "completed";

export interface CardState {
  status: CardStatus;
  score: number | null;
  completedDate: string | null;
  completedAttemptId: number | null;
  openAttemptId: number | null;
  sittings: number;
  reopenedBy: ReopenedPastpaper | null;
}

export function cardState(attempts: CardAttempt[], reopened?: ReopenedPastpaper | null): CardState {
  const newestFirst = [...attempts].sort((a, b) => b.id - a.id);
  const finished = newestFirst.filter((a) => a.is_completed);
  const last = finished[0] ?? null;
  const open = newestFirst.find((a) => !a.is_completed && !a.is_expired && (last == null || a.id > last.id));
  const status: CardStatus = open ? "progress" : last && reopened ? "reopened" : last ? "completed" : "new";
  return {
    status,
    score: last?.score ?? null,
    completedDate: last?.completed_at || last?.submitted_at || null,
    completedAttemptId: last?.id ?? null,
    openAttemptId: open?.id ?? null,
    sittings: finished.length,
    reopenedBy: last && reopened ? reopened : null,
  };
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

// ─────────────────────── names (past papers) ───────────────────────

export function isRW(subject: string): boolean {
  return subject === "READING_WRITING" || subject?.toLowerCase().includes("reading");
}
function fmtMonth(s: string | null | undefined): string {
  if (!s) return "Undated";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch {
    return s;
  }
}
function formLetter(s: PastpaperSection): string {
  const lbl = (s.label || "").trim();
  if (/^[A-Za-z]$/.test(lbl)) return lbl.toUpperCase();
  const last = (s.collection_name || "").trim().split(/\s+/).pop() || "";
  return /^[A-Za-z]$/.test(last) ? last.toUpperCase() : "";
}
function variantLabel(s: PastpaperSection): string {
  const region = s.form_type === "US" ? "US" : "International";
  const letter = formLetter(s);
  return letter ? `${region} Form ${letter}` : region;
}
export function sectionTitle(s: PastpaperSection): string {
  if (s.title && s.title.trim()) return s.title.trim();
  return variantLabel(s);
}
export function collectionLabel(s: PastpaperSection): string {
  return fmtMonth(s.practice_date);
}
