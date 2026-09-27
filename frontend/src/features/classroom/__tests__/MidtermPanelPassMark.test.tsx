/**
 * The pass/fail line on the midterm panel, and the seam that keeps it off the student site.
 *
 * A teacher asked for it in these words: "the people who pass the midterms will be in the
 * green line and who doesn't the red one." It is a teacher's reading of a room, and this file
 * exists mostly to prove it stops there. `features/classroom/**` is ONE component tree mounted
 * by both hosts; on mastersat.uz the student site rewrites `my_role` to STUDENT before
 * capabilities are derived, so a branch on the route would be a branch on nothing. The gate is
 * `caps.isStaff`, and the test below that hands the same payload to a student viewer is the
 * one protecting the copy rule — a student's own row painted red for missing a mark is exactly
 * the punishing signal that "Missed, never Absent" exists to forbid.
 *
 * The rest is arithmetic that fails silently when it is wrong: a missing pass mark read as
 * zero passes the whole class, and a mark compared against the wrong scale mis-marks every
 * sitting from before a scale change, in both directions.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const classroomPanel = vi.fn();

vi.mock("@/lib/midtermApi", () => ({
  midtermApi: {
    classroomPanel: (...args: unknown[]) => classroomPanel(...args),
    updateClassroomSchedule: vi.fn(),
    issueClassroomCertificates: vi.fn(),
    generateStartCode: vi.fn(),
    allowResit: vi.fn(),
    withdrawResit: vi.fn(),
    downloadClassroomCertificates: vi.fn(),
    getVersions: vi.fn(),
    previewVersions: vi.fn(),
    commitSeating: vi.fn(),
  },
  subjectLabel: (s: string) => (s === "MATH" ? "Mathematics" : "Reading & Writing"),
}));
vi.mock("@/lib/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: { downloadCertificate: vi.fn() },
}));

const { MidtermPanel } = await import("../pages/MidtermPanel");
const { capabilitiesFor } = await import("../capabilities");

/** A finished, scored row. `score_on_scale` is what the pass mark is compared against. */
function finished(over: Record<string, unknown> = {}) {
  return {
    student_id: 1, student_name: "Aziza Karimova", student_profile_image_url: null,
    state: "COMPLETED", submitted: true, score: 80, score_ceiling: 100, scoring_scale: "SCALE_100",
    score_on_scale: 80, rank: 1, certificate_code: null, sittings: 1, resit_open: false,
    version_number: null, version_label: null, seat_row: null, seat_col: null, side: null, desk_number: null,
    ...over,
  };
}

function panel(over: { students?: unknown[]; stats?: Record<string, unknown> } = {}) {
  return {
    midterm: { id: 7, title: "Unit 3 Midterm", subject: "MATH", scoring_scale: "SCALE_100", score_ceiling: 100 },
    schedule: {
      starts_at: "2026-09-20T09:00:00+05:00", deadline: null, ignore_start: false,
      results_released: false, available_at: null, is_before_start: false, is_open: true,
      access_code: null, requires_code: true, notified_at: null,
    },
    students: over.students ?? [finished()],
    stats: {
      assigned: 1, completed: 1, average: 80, highest: 80, lowest: 80,
      score_ceiling: 100, mixed_scales: false, pass_mark: 60,
      ...(over.stats ?? {}),
    },
    all_finished: true, certificates_issued: false, has_versions: false, versions: [],
  };
}

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  classroomPanel.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function settle(ticks = 12) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Open the panel as `role` — the role the caller's classroom object carries. */
async function mount(body: ReturnType<typeof panel>, role: string) {
  classroomPanel.mockResolvedValue(body);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MidtermPanel
          classId={34}
          midtermId={7}
          title="Unit 3 Midterm"
          caps={capabilitiesFor(role)}
          onBack={() => {}}
        />
      </QueryClientProvider>,
    );
  });
  await settle();
}

/** Every word and wash that belongs to the verdict and to nothing else on this page. */
const VERDICT_WORDS = ["Passed", "Not passed"];
const tintedRows = () =>
  Array.from(host.querySelectorAll("tr")).filter(
    (tr) => /bg-(emerald|rose)-500/.test(tr.className),
  ).length;

describe("the pass/fail line, on both hosts", () => {
  it("marks a teacher's finished rows cleared or not cleared against the mark", async () => {
    await mount(
      panel({
        students: [
          finished({ student_id: 1, student_name: "Aziza Karimova", score: 80, score_on_scale: 80 }),
          finished({ student_id: 2, student_name: "Sardor Tursunov", score: 40, score_on_scale: 40, rank: 2 }),
        ],
      }),
      "TEACHER",
    );

    expect(host.textContent).toContain("Passed");
    expect(host.textContent).toContain("Not passed");
    expect(tintedRows()).toBe(2);
  });

  it("counts the mark itself as cleared — the pass mark is inclusive", async () => {
    await mount(panel({ students: [finished({ score: 60, score_on_scale: 60 })] }), "TEACHER");

    expect(host.textContent).toContain("Passed");
    expect(host.textContent).not.toContain("Not passed");
  });

  it("shows a STUDENT viewer no verdict at all, on the same payload", async () => {
    // The seam. Same server response, same component; the only difference is the capability
    // the caller derived — which on the student site is STUDENT whatever the account is.
    await mount(
      panel({
        students: [
          finished({ student_id: 1, score: 80, score_on_scale: 80 }),
          finished({ student_id: 2, student_name: "Sardor Tursunov", score: 40, score_on_scale: 40, rank: 2 }),
        ],
      }),
      "STUDENT",
    );

    for (const word of VERDICT_WORDS) expect(host.textContent).not.toContain(word);
    expect(tintedRows()).toBe(0);
    // And the table is otherwise untouched: the state word is still there.
    expect(host.textContent).toContain("Finished");
  });

  it("draws no line when the midterm is never judged", async () => {
    // A pre-midterm. `pass_mark: null` must read as "no line", never as a mark of zero —
    // zero would paint every row in the room green.
    await mount(panel({ stats: { pass_mark: null } }), "TEACHER");

    for (const word of VERDICT_WORDS) expect(host.textContent).not.toContain(word);
    expect(tintedRows()).toBe(0);
    expect(host.textContent).toContain("Finished");
  });

  it("never marks a student who is still sitting it as not passed", async () => {
    // No score, so no verdict — and an uncoloured row must not read as a fail.
    await mount(
      panel({
        students: [
          finished({
            state: "MODULE_1_ACTIVE", submitted: false, score: null, score_on_scale: null, rank: null,
          }),
        ],
        stats: { completed: 0, average: null, highest: null, lowest: null },
      }),
      "TEACHER",
    );

    for (const word of VERDICT_WORDS) expect(host.textContent).not.toContain(word);
    expect(tintedRows()).toBe(0);
    expect(host.textContent).toContain("Module 1 in progress");
  });

  it("judges a re-scaled sitting on the converted score, not the one it prints", async () => {
    // The room sat this on the 100 scale; the midterm has since moved to 800, so the totals
    // and the pass mark speak 800 while the row keeps showing the student their own 72/100.
    // Compared against the printed 72 this paper "fails" a mark of 500. It did not.
    await mount(
      panel({
        students: [finished({ score: 72, score_ceiling: 100, scoring_scale: "SCALE_100", score_on_scale: 632 })],
        stats: { score_ceiling: 800, mixed_scales: true, pass_mark: 500, average: 632, highest: 632, lowest: 632 },
      }),
      "TEACHER",
    );

    expect(host.textContent).toContain("Passed");
    expect(host.textContent).not.toContain("Not passed");
    // The student's own number is still the one on screen.
    expect(host.textContent).toContain("72");
  });

  it("still says Voided for a struck-out sitting, and draws no line through it", async () => {
    // The case the verdict swallowed. A voided paper is `submitted` and carries a score —
    // the panel sets `submitted` from any attempt row, and the query behind it selects on
    // `is_completed` without excluding ABANDONED — so on the arithmetic alone this looks
    // like a clean pass. It is not a result at all. And because the verdict REPLACES the
    // state chip rather than sitting beside it, a verdict here does not merely add a word:
    // it deletes the only one that mattered, leaving a struck-out paper reading "Passed".
    await mount(
      panel({
        students: [finished({ state: "ABANDONED", submitted: true, score: 80, score_on_scale: 80 })],
      }),
      "TEACHER",
    );

    expect(host.textContent).toContain("Voided");
    for (const word of VERDICT_WORDS) expect(host.textContent).not.toContain(word);
    expect(tintedRows()).toBe(0);
  });
});
