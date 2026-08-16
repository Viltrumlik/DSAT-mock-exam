/**
 * Classwork as a STUDENT sees it.
 *
 * The student's classwork surface is the carrier Assignment, not the lesson plan. The
 * plan endpoints (`/api/classes/{id}/lessons/…`) are staff-gated server-side, so a
 * student-shaped Lessons tab could only ever render a 403; the carrier, by contrast, is a
 * real PUBLISHED `classes.Assignment` that the classroom's own assignment list already
 * returns to every member. So this reads that list and keeps the CLASSWORK rows — one
 * request the page was making anyway, and no second source of truth for the same rows.
 *
 * The fields are read one at a time rather than cast. `parseAssignmentList` is a
 * `.passthrough()` parse typed as the generated OpenAPI `Assignment`, which is regenerated
 * on the backend's own cadence and does not yet carry `classwork_award` — a cast would
 * claim a shape nobody has checked, and would crash on a null list the day the schema
 * moves.
 */

const CLASSWORK_CATEGORY = "CLASSWORK";

/** The requesting student's award, or null when no teacher has recorded one yet. */
export interface StudentClassworkAward {
  points: number;
  xp: number;
  awarded_at: string;
  note: string;
}

/** One openable activity the teacher gave the class during the lesson. */
export interface ClassworkContent {
  title: string;
  item_count: number | null;
}

/** A vocabulary set opened in class; it lives on the student's Vocabulary page. */
export interface ClassworkVocabSet {
  set_id: number;
  set_title: string;
  word_count: number;
}

/** A downloadable lesson file, with the name it was uploaded under. */
export interface ClassworkFile {
  url: string;
  file_name: string;
}

export interface StudentClasswork {
  id: number;
  title: string;
  instructions: string;
  assigned_at: string | null;
  external_urls: string[];
  video_url: string;
  files: ClassworkFile[];
  contents: ClassworkContent[];
  vocabulary: ClassworkVocabSet[];
  /**
   * Null and `{points: 0}` are different answers and must stay different: null is "no
   * teacher has looked at this yet", zero is "a teacher recorded this lesson". Never test
   * `points > 0` to decide whether an award exists.
   */
  award: StudentClassworkAward | null;
}

type Row = Record<string, unknown>;

const asRow = (v: unknown): Row | null =>
  v != null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

const rowList = (v: unknown): Row[] =>
  Array.isArray(v) ? v.map(asRow).filter((r): r is Row => r != null) : [];

function readAward(v: unknown): StudentClassworkAward | null {
  const r = asRow(v);
  if (r == null) return null;
  return {
    points: num(r.points),
    xp: num(r.xp),
    awarded_at: str(r.awarded_at),
    note: str(r.note),
  };
}

/**
 * Every classwork carrier out of a classroom's assignment list, newest first.
 *
 * Order comes from the server (`Coalesce(published_at, created_at)` descending) and is
 * preserved rather than re-sorted here — classwork has no `due_at` to sort on, so the
 * moment it was given is the only ordering it has.
 */
export function classworkFromAssignments(items: readonly unknown[]): StudentClasswork[] {
  const out: StudentClasswork[] = [];
  for (const item of items) {
    const r = asRow(item);
    if (r == null || str(r.category) !== CLASSWORK_CATEGORY) continue;
    const single = str(r.external_url);
    const links = strList(r.external_urls);
    // `attachment_urls` is a list of OBJECTS ({url, file_name, …}) and already leads with
    // the primary file, so the singular `attachment_file_url` is only a fallback for a
    // payload that predates it — adding both would list the same file twice.
    const files = rowList(r.attachment_urls)
      .map((f) => ({ url: str(f.url), file_name: str(f.file_name) }))
      .filter((f) => f.url !== "");
    const primary = str(r.attachment_file_url);
    out.push({
      id: num(r.id),
      title: str(r.title),
      instructions: str(r.instructions),
      // The carrier is minted at hand-out time, so published_at is the real "given"
      // moment; assigned_at already coalesces it with created_at server-side.
      assigned_at: str(r.assigned_at) || null,
      // The multi-link list is the source of truth; the singular field is the legacy
      // fallback for rows authored before it existed.
      external_urls: links.length > 0 ? links : single ? [single] : [],
      video_url: str(r.video_file_url) || str(r.video_url),
      files: files.length > 0 ? files : primary ? [{ url: primary, file_name: "Lesson file" }] : [],
      contents: rowList(r.contents).map((c) => ({
        title: str(c.title),
        item_count: typeof c.item_count === "number" ? c.item_count : null,
      })),
      vocabulary: rowList(r.vocab_homeworks).map((v) => ({
        set_id: num(v.set_id),
        set_title: str(v.set_title),
        word_count: num(v.word_count),
      })),
      award: readAward(r.classwork_award),
    });
  }
  return out;
}
