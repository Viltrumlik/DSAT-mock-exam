/**
 * Groups practice tests into cards (mock packs, pastpaper packs, legacy pairs, singles).
 * Mirrors the student /practice-tests list so homework and portal stay consistent.
 */

import { normalizePlatformSubject } from "./permissions";

export type CardPack = { kind: "pack"; mockKey: number; mock: any; tests: any[] };
export type CardPastpaperPack = { kind: "pastpaper_pack"; packKey: string; pack: any; tests: any[] };
export type CardSingle = { kind: "single"; test: any };
export type PracticeCard = CardPack | CardPastpaperPack | CardSingle;

function normalizePastpaperLabel(label: string | null | undefined) {
  return (label || "").trim();
}

/** Denormalized grouping label (former pastpaper pack title) on a standalone section. */
function collectionName(t: any): string {
  return String(t?.collection_name ?? "").trim();
}

/** Sections without a collection_name: group by date + form + label (legacy fallback). */
function standaloneGroupKey(t: any): string {
  return [t.practice_date || "", t.form_type || "", normalizePastpaperLabel(t.label)].join("|");
}

export function sortPastpaperSections(tests: any[]) {
  return [...tests].sort((a, b) => {
    const order = (subj: unknown) => {
      const p = normalizePlatformSubject(subj == null ? undefined : String(subj));
      if (p === "READING_WRITING") return 0;
      if (p === "MATH") return 1;
      return 2;
    };
    const d = order(a.subject) - order(b.subject);
    if (d !== 0) return d;
    return (a.id || 0) - (b.id || 0);
  });
}

/** Timed mock / midterm sections must not appear on the pastpaper library page. */
export function isTimedMockSectionRow(t: any): boolean {
  if (t == null) return false;
  if (t.mock_exam_id != null && t.mock_exam_id !== undefined) return true;
  const m = t.mock_exam;
  if (m == null || m === undefined) return false;
  if (typeof m === "object" && m.id != null) return true;
  if (typeof m === "number" && Number.isFinite(m)) return true;
  return false;
}

export function buildCards(tests: any[]): PracticeCard[] {
  const byMock = new Map<number, any[]>();
  const looseStandalone: any[] = [];

  for (const t of tests) {
    if (isTimedMockSectionRow(t)) continue;
    const m = t.mock_exam;
    if (m?.id) {
      if (!byMock.has(m.id)) byMock.set(m.id, []);
      byMock.get(m.id)!.push(t);
      continue;
    }
    looseStandalone.push(t);
  }

  const packs: CardPack[] = Array.from(byMock.entries()).map(([mockKey, list]) => ({
    kind: "pack",
    mockKey,
    mock: list[0].mock_exam,
    tests: list,
  }));

  // Group standalone pastpaper sections by collection_name (former pack); fall back to
  // the legacy date+form+label key when a section has no collection label.
  const byGroup = new Map<string, { collection: string; tests: any[] }>();
  for (const t of looseStandalone) {
    const collection = collectionName(t);
    const key = collection ? `col:${collection.toLowerCase()}` : `loose:${standaloneGroupKey(t)}`;
    if (!byGroup.has(key)) byGroup.set(key, { collection, tests: [] });
    byGroup.get(key)!.tests.push(t);
  }

  const collectionPacks: CardPastpaperPack[] = [];
  const singles: CardSingle[] = [];
  for (const [groupKey, { collection, tests: list }] of byGroup) {
    const unique = [...new Map(list.map((x) => [x.id, x])).values()];
    if (unique.length >= 2) {
      const p0 = unique[0];
      collectionPacks.push({
        kind: "pastpaper_pack",
        packKey: collection ? `col-${groupKey}` : `legacy-${groupKey}`,
        pack: {
          id: null,
          title: collection,
          practice_date: p0.practice_date,
          label: p0.label,
          form_type: p0.form_type,
        },
        tests: sortPastpaperSections(unique),
      });
    } else if (unique.length === 1) {
      singles.push({ kind: "single", test: unique[0] });
    }
  }

  const all: PracticeCard[] = [...packs, ...collectionPacks, ...singles];
  const sortKey = (c: PracticeCard) => {
    if (c.kind === "pack") return c.mock.practice_date || "";
    if (c.kind === "pastpaper_pack") return c.pack?.practice_date || c.tests[0]?.practice_date || "";
    return c.test.practice_date || c.test.created_at || "";
  };
  all.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  return all;
}

export function formatLineDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function subjectLabel(subject: string) {
  return normalizePlatformSubject(subject) === "MATH" ? "Mathematics" : "Reading & Writing";
}

export function singleDisplayTitle(test: any) {
  if (test.title && String(test.title).trim()) return String(test.title).trim();
  const form = test.form_type === "US" ? "US Form" : "International Form";
  const letter = test.label ? ` ${test.label}` : "";
  return `${form}${letter} · ${subjectLabel(test.subject)}`.trim();
}

/** Collection label (former pastpaper pack title) — now denormalized on each section. */
export function pastpaperPackDisplayTitle(test: any): string {
  return String(test?.collection_name ?? "").trim();
}

/** Search / filter text using public practice-test API fields only (no `mock_exam`). */
export function practiceTestSearchBlob(test: any): string {
  const pack = pastpaperPackDisplayTitle(test);
  return [
    singleDisplayTitle(test),
    test.label || "",
    (test.title && String(test.title).trim()) || "",
    pack,
    test.practice_date || "",
    subjectLabel(String(test.subject || "")),
  ]
    .join(" ")
    .toLowerCase();
}

export function sharedPastpaperPackTitle(tests: any[]): string {
  if (tests.length === 0) return "Practice test";
  if (tests.length === 1) return singleDisplayTitle(tests[0]);
  const titles = tests.map((t) => (t.title || "").trim()).filter(Boolean);
  if (titles.length === 0) {
    const t = tests[0];
    const form = t.form_type === "US" ? "US Form" : "International Form";
    const letter = normalizePastpaperLabel(t.label) ? ` ${normalizePastpaperLabel(t.label)}` : "";
    return `${form}${letter}`.trim();
  }
  const stripSubjectTail = (s: string) =>
    s.replace(/\s*[—–-]\s*(Reading\s*&\s*Writing|R\s*&\s*W|English|Math|Mathematics)\s*$/i, "").trim();
  const bases = [...new Set(titles.map(stripSubjectTail))].filter(Boolean);
  if (bases.length === 1) return bases[0];
  return stripSubjectTail(titles[0]) || titles[0];
}

/** Pastpaper / standalone homework picker: no timed mock “pack” rows. */
export function buildHomeworkPastpaperCards(tests: any[]): (CardPastpaperPack | CardSingle)[] {
  return buildCards(tests).filter((c): c is CardPastpaperPack | CardSingle => c.kind !== "pack");
}

/** The sections a pastpaper card represents (a pack has many, a single has one). */
function cardSections(c: CardPastpaperPack | CardSingle): any[] {
  return c.kind === "single" ? [c.test] : c.tests;
}

/** Year (YYYY) of a section's practice_date, or null. */
function sectionYear(t: any): string | null {
  const iso = t?.practice_date || t?.created_at;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : String(d.getFullYear());
}

/** Distinct years present across pastpaper cards, newest first (for the Year filter). */
export function pastpaperCardYears(cards: (CardPastpaperPack | CardSingle)[]): string[] {
  const set = new Set<string>();
  for (const c of cards) for (const t of cardSections(c)) { const y = sectionYear(t); if (y) set.add(y); }
  return Array.from(set).sort((a, b) => Number(b) - Number(a));
}

export type PastpaperFilter = {
  /** "ALL" | "US" | "INTL" — matches the student page semantics (form_type). */
  region?: "ALL" | "US" | "INTL";
  /** "ALL" or a YYYY string. */
  year?: string;
  /** Free-text search over the card's sections. */
  search?: string;
};

/** Filter homework pastpaper cards by region (form_type), year (practice_date), and search. */
export function filterPastpaperCards(
  cards: (CardPastpaperPack | CardSingle)[],
  { region = "ALL", year = "ALL", search = "" }: PastpaperFilter,
): (CardPastpaperPack | CardSingle)[] {
  const q = search.trim().toLowerCase();
  return cards.filter((c) => {
    const sections = cardSections(c);
    if (region === "US" && !sections.some((t) => t.form_type === "US")) return false;
    if (region === "INTL" && !sections.some((t) => t.form_type !== "US")) return false;
    if (year !== "ALL" && !sections.some((t) => sectionYear(t) === year)) return false;
    if (q && !sections.some((t) => practiceTestSearchBlob(t).includes(q))) return false;
    return true;
  });
}
