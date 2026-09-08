/**
 * The API boundary's one job: a payload this page cannot read has to surface as an ERROR.
 *
 * The failure it exists to prevent is not a crash — it is a page that renders a rate beside
 * counts that do not describe it and lets a teacher act on the difference. `totals.analysed`
 * is what names the population `totals.error_rate` divided; a server too old to send it is a
 * shape this page does not understand, and saying so is the only honest outcome.
 */
import { describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args) },
  classesApi: { list: vi.fn() },
  examsPublicApi: { getPracticeTests: vi.fn() },
}));

const { questionAnalysisApi } = await import("../api");

/** The smallest payload the page accepts, so each test can take one thing away from it. */
function ok() {
  return {
    questions: [],
    needs_analysis: [],
    totals: {
      questions: 0,
      seen: 0,
      answered: 0,
      omitted: 0,
      correct: 0,
      wrong: 0,
      error_rate: null,
      analysed: { questions: 0, seen: 0, answered: 0, wrong: 0 },
      needs_analysis: 0,
      suspect_key: 0,
    },
  };
}

const call = () =>
  questionAnalysisApi.pastpaper({ classroom: 3, practiceTest: 44, threshold: 25 });

describe("pastpaper payload contract", () => {
  it("accepts a payload that names what the headline rate divided", async () => {
    get.mockResolvedValue({ data: ok() });
    await expect(call()).resolves.toMatchObject({ totals: { analysed: { answered: 0 } } });
  });

  it("refuses a payload with no analysed population rather than mislabelling the rate", async () => {
    const stale = ok() as Record<string, unknown> & { totals: Record<string, unknown> };
    delete stale.totals.analysed;
    get.mockResolvedValue({ data: stale });
    await expect(call()).rejects.toThrow(/shape this page does not understand/);
  });

  it("still refuses a payload with no question list at all", async () => {
    get.mockResolvedValue({ data: { needs_analysis: [], totals: ok().totals } });
    await expect(call()).rejects.toThrow(/Nothing was analysed/);
  });
});
