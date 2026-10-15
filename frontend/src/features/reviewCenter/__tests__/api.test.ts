/**
 * The Review Center's "Past papers" source lists past papers only. Practice tests are their own
 * library (builder, student page, homework picker) and are never listed among past papers, so
 * the standalone-section call must name its kind: the server applies `kind` only when it is given.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getStandaloneSections = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: vi.fn() },
  examsAdminApi: { getStandaloneSections: (...a: unknown[]) => getStandaloneSections(...a) },
}));
vi.mock("@/features/assessmentsAdmin/api", () => ({ assessmentsAdminApi: {} }));
vi.mock("@/features/mocksAdmin/api", () => ({ mocksAdminApi: {} }));

const { listCatalog } = await import("../api");

beforeEach(() => {
  getStandaloneSections.mockReset();
  getStandaloneSections.mockResolvedValue([
    {
      id: 4,
      title: "",
      label: "B",
      subject: "MATH",
      collection_name: "November 2025 Int. B",
      form_type: "INTERNATIONAL",
      is_published: true,
    },
  ]);
});

describe("Review Center catalog: past papers", () => {
  it("asks for past papers only, never practice tests", async () => {
    await listCatalog("pastpaper");
    expect(getStandaloneSections).toHaveBeenCalledTimes(1);
    expect(getStandaloneSections).toHaveBeenCalledWith("pastpaper");
  });

  it("lists each past-paper section by its title, label or id", async () => {
    const items = await listCatalog("pastpaper");
    expect(items).toEqual([
      {
        id: 4,
        title: "B",
        subject: "MATH",
        meta: "November 2025 Int. B · INTERNATIONAL",
        isPublished: true,
      },
    ]);
  });
});
