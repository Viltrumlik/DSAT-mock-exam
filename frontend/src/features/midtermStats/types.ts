/**
 * Wire types for the admin midterm statistics API.
 *
 * Backend: `midterms/stats.py` (the aggregation) and `midterms/views_stats.py` (the three
 * endpoints). Every field here is one the backend actually emits — the keys are asserted in
 * `midterms/tests_stats_api.py`, so this file is a transcription, not a guess.
 *
 * Kept out of `features/midtermReports/types.ts` on purpose: that module describes the
 * per-student evidence table (one classroom, one paper, one row per student) and shares no
 * shape with these pooled monthly roll-ups.
 */

/** `"YYYY-MM"`, resolved in the school's local time by the backend. */
export type MonthKey = string;

/**
 * The counts every rate on this page is computed from — `stats.Tally.as_dict()` on the wire.
 *
 * `roster == passed_first + passed_retake + failed + absent + pending` always holds, which is
 * what makes the pooled roll-up legitimate: adding two rows adds two numerators and two
 * denominators.
 *
 * Every rate is `number | null`. **`null` means "we cannot know" — an empty denominator —
 * and must never be rendered as 0%.**
 */
export type Tally = {
  /** The denominator: every non-removed student membership, whether or not they sat. */
  roster: number;
  attended: number;
  passed_first: number;
  passed_retake: number;
  failed: number;
  /** Absent counts as not passed. It is in the denominator and not the numerator. */
  absent: number;
  /** Still in flight or awaiting a verdict. Also in the denominator, not the numerator. */
  pending: number;
  retake_taken: number;
  retake_passed: number;
  retake_failed: number;
  /** `passed_first + passed_retake`. */
  passed: number;
  /** THE number: passed / roster. `null` when the roster is empty. */
  pass_rate: number | null;
  attendance_rate: number | null;
  /** Of the PASSERS (not the roster), the share who needed no retake. */
  first_try_share: number | null;
  /** `100 - first_try_share`, so the pair always sums to exactly 100. */
  retake_share: number | null;
};

/** A pooled bucket: a tally plus what it was pooled over. */
export type GroupTally = Tally & {
  classrooms: number;
  /**
   * The deduped student count behind `roster`. Lower than `roster` whenever a student sits
   * in two of the pooled classrooms, or a class sat two papers in the month — both are
   * expected, and the page shows the pair rather than letting a reader infer a bug.
   */
  distinct_students: number;
};

/**
 * The keys of the `definition` block, in the order the page states them.
 *
 * Listed rather than typed as an open record so the page renders a known vocabulary in a
 * deliberate order; an unknown key a future backend adds is simply not shown, and a key it
 * drops leaves a gap rather than the string "undefined".
 */
export const DEFINITION_KEYS = [
  "pass_rate",
  "absent_counts_as",
  "rollup",
  "denominator",
  "first_try_share",
  "excluded",
  "month",
  "empty_denominator",
  // Which month the page opens on when none was asked for. Listed because the answer is not
  // "the newest": the newest month a school has is routinely one it has not reached, and
  // opening there reported a roster of absentees as a pass rate of zero. A reader who can see
  // that the picker's first option is not the page's default is owed the rule behind it.
  "default_month",
] as const;

export type DefinitionKey = (typeof DEFINITION_KEYS)[number];

/** What the numbers mean, carried in every payload so the page can state its own rule. */
export type StatsDefinition = Partial<Record<DefinitionKey, string>>;

export type TeacherBrief = { id: number; name: string };

export type BranchBrief = { id: number; name: string; region: string | null };

export type ClassroomBrief = {
  id: number;
  name: string;
  /** Raw `Classroom.subject` (ENGLISH / MATH) — render `subject_label` instead. */
  subject: string;
  subject_label: string;
  level: string;
  level_label: string;
  teacher: TeacherBrief | null;
  /** null for the classrooms a create-form regression left with no branch. */
  branch: BranchBrief | null;
};

/** `id: null` is the explicit "Unassigned" bucket, not a missing row. */
export type BranchRow = GroupTally & { id: number | null; name: string };

export type DepartmentRow = GroupTally & {
  subject: string;
  label: string;
  /** Same as `label`; the backend duplicates it so one sort key serves every table. */
  name: string;
};

export type TeacherRow = GroupTally & {
  id: number | null;
  name: string;
  /** null when this teacher holds classes of more than one subject. */
  subject: string | null;
  subject_label: string | null;
  /** null when this teacher holds classes at more than one branch, or at none. */
  branch: string | null;
};

export type ClassroomRow = ClassroomBrief & GroupTally & { midterms: number };

/* ── the hierarchy ──────────────────────────────────────────────────────────────────── */

/**
 * The five altitudes of the drill-down, outermost first.
 *
 * They are the school's own containment chain, not a taxonomy invented here:
 * `Region → Branch → subject → teacher → Classroom`. `department` is `Classroom.subject`
 * (ENGLISH / MATH) — there is no Department model, and a node at that level therefore has no
 * database id of its own.
 */
export type TreeLevel = "region" | "branch" | "department" | "teacher" | "classroom";

/**
 * One node of the hierarchy: a pooled tally, plus what it contains.
 *
 * **Every node is the merge of its descendants**, which is what makes a tree the right shape
 * for these figures at all: `Tally` adds field-wise, so `passed` and `roster` sum up the tree
 * and `pass_rate = passed / roster` is recomputed at each level. A percentage is never
 * averaged upward.
 *
 * `distinct_students` is the one field that does NOT sum — a student in two of the classrooms
 * under a node is one student and two roster places — so it is the server's to state, never
 * the page's to add up. Where the page has to build a node itself (see `deriveTree`), it says
 * so rather than printing a headcount it cannot know.
 */
export type TreeNode = GroupTally & {
  /** Unique within one payload: `"<level>:<id>"`, with `unassigned` for a NULL id. */
  key: string;
  level: TreeLevel;
  /**
   * The underlying record's id. `null` is the explicit "Unassigned" bucket at the region,
   * branch and teacher levels — a known gap in the record, never a group that scored nothing.
   * A `department` node has no record and so is always `null` there; it is not a gap.
   */
  id: number | null;
  name: string;
  /**
   * One level down. **Absent on a classroom leaf**, not empty — the backend omits the key
   * rather than sending `[]`, so an expandable-onto-nothing row cannot be drawn by accident.
   */
  children?: TreeNode[];
  /**
   * The level of `children`, when the server states it. It currently does not, and nothing
   * here needs it to: `childLevel()` reads it off the children themselves.
   */
  child_level?: TreeLevel | null;
  /** `(classroom, midterm)` pairs in this subtree — present at every level, like `roster`. */
  midterms?: number;
  /** Department nodes: the raw `Classroom.subject` behind the label. Never rendered. */
  subject?: string | null;
  /** Classroom leaves only — the identity the flat classroom row used to carry. */
  subject_label?: string | null;
  level_label?: string | null;
  /**
   * Set only by {@link deriveTree}: this node was rebuilt in the browser because the payload
   * carried no hierarchy, so its `distinct_students` is a sum and cannot be trusted as a
   * headcount. Never sent by the server.
   */
  derived?: boolean;
};

/**
 * What every payload says about TIME, so no reader has to do date maths of its own.
 *
 * `views_stats._month_context`, on the monthly payload and the classroom payload alike, and
 * carried by `/stats/months/` too. Computed in the school's timezone (Asia/Tashkent) rather
 * than in the browser, because a reader's device may be on any other date entirely.
 *
 * **`is_future` is the one that changes what may be rendered.** Every teacher assign path
 * writes a `starts_at`, so a paper booked for next month already dates into next month; the
 * roster has sat nothing, absent counts as failed, and the pooled formula therefore returns a
 * perfectly well-formed 0.0%. That is a plan reported as a result, and it is the reason the
 * backend refuses to make such a month the DEFAULT — but the picker still offers it, so the
 * page has to label it rather than print its figures as scores.
 */
export type MonthContext = {
  /** True when the month being shown is one nobody has sat yet. */
  is_future: boolean;
  /** The subset of `months` that is still ahead of the school, newest first. */
  future_months: MonthKey[];
  /** The school's own current month. Never the browser's. */
  this_month: MonthKey;
};

/**
 * Papers excluded from every figure in this payload, named so their absence can be accounted
 * for: RETAKE papers saved with no parent midterm.
 *
 * They cannot be counted (only students who did not pass are ever given a retake, so the
 * denominator would be a class the paper was never offered to) and cannot be folded (there is
 * no parent to fold them into). The list is ALWAYS present, empty or not — a page that reads
 * the key only when it is there cannot tell "no warnings" from "an older backend".
 */
export type OrphanRetakes = { orphan_retakes: RetakeBrief[] };

export type MonthlyStats = MonthContext &
  OrphanRetakes & {
    month: MonthKey | null;
    definition: StatsDefinition;
    totals: GroupTally & { midterms: number };
    branches: BranchRow[];
    departments: DepartmentRow[];
    teachers: TeacherRow[];
    classrooms: ClassroomRow[];
    /**
     * The hierarchy, top level first (regions), each node ranked best-first like the flat
     * lists beside it.
     *
     * Optional on the type because a payload from a backend that predates it must not crash
     * the page: `treeFor()` rebuilds an equivalent tree from `classrooms` and the page says
     * it did. It is NOT optional in the contract.
     */
    tree?: TreeNode[];
    /**
     * The node keys the page should already be inside when it opens, outermost first.
     *
     * This is the collapsing rule on the wire: a level with exactly one child is passed
     * through rather than clicked through, so a school with one region and one branch opens
     * on its departments with `Fergana › Fergana city` already in the breadcrumb. The page
     * re-derives the same rule from `tree` when this is missing or names nodes that are gone,
     * because which levels collapse is a fact about the data and changes the day a second
     * branch is created.
     */
    tree_open_path?: string[];
    /** The picker's options, newest first — carried so one response draws the whole page. */
    months: MonthKey[];
    filters: { branch: number | null; subject: string | null; teacher: number | null };
  };

/**
 * Which authority gave a `(classroom, paper)` pair its month.
 *
 * Rendered, not swallowed: a month read off a schedule is a stronger fact than one inferred
 * from whenever the paper happened to be created, and a reader comparing two classrooms
 * deserves to know which they are looking at.
 */
export type MonthBasis = "schedule" | "first_sitting" | "published" | "created";

export type MidtermType = "PRE_MIDTERM" | "MIDTERM" | "RETAKE";

export type RetakeBrief = { id: number; title: string };

export type ClassroomMidtermRow = Tally & {
  id: number;
  title: string;
  /** Raw `Midterm.subject` (READING_WRITING / MATH) — no label comes with it. */
  subject: string;
  midterm_type: MidtermType;
  /** null when the paper is not pass/fail graded at all. */
  pass_mark: number | null;
  score_ceiling: number;
  month: MonthKey;
  month_basis: MonthBasis | null;
  /** Every retake of this paper. Statistics union them all; the evidence table shows one. */
  retakes: RetakeBrief[];
};

export type ClassroomMonth = MonthContext &
  OrphanRetakes & {
    classroom: ClassroomBrief;
    /**
     * `null` when this class has no month to open on — either it has never been given a
     * paper at all, or every month it has is still ahead of it. `future_months` is what tells
     * the two apart, and they are not the same sentence on screen.
     */
    month: MonthKey | null;
    months: MonthKey[];
    definition: StatsDefinition;
    summary: Tally & { midterms: number; distinct_students: number };
    rows: ClassroomMidtermRow[];
  };
