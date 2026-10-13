/**
 * The /ops/lcup client: every call lands on the path the backend serves (backend/lcup/urls.py),
 * with the body the view reads. A wrong path here is a 404 the page would render as "nothing to
 * review", so the paths are pinned.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

const { lcupApi } = await import("../lcupApi");

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: [] });
  post.mockReset().mockResolvedValue({ data: {} });
});

describe("lcupApi", () => {
  it("reads the status", async () => {
    get.mockResolvedValueOnce({ data: { enabled: true } });
    await expect(lcupApi.status()).resolves.toEqual({ enabled: true });
    expect(get).toHaveBeenCalledWith("/lcup/status/");
  });

  it("queues a sync or a dry run", async () => {
    await lcupApi.sync();
    await lcupApi.sync(true);
    expect(post).toHaveBeenNthCalledWith(1, "/lcup/sync/");
    expect(post).toHaveBeenNthCalledWith(2, "/lcup/sync/?dry_run=1");
  });

  it("confirms a group with a chosen class, or with the suggestion", async () => {
    await lcupApi.confirmGroup(5, 9);
    await lcupApi.confirmGroup(5);
    expect(post).toHaveBeenNthCalledWith(1, "/lcup/groups/5/confirm/", { classroom_id: 9 });
    expect(post).toHaveBeenNthCalledWith(2, "/lcup/groups/5/confirm/", {});
  });

  it("filters the student queue by status", async () => {
    await lcupApi.students("unmatched");
    expect(get).toHaveBeenCalledWith("/lcup/students/", { params: { status: "unmatched" } });
  });

  it("creates an account, with another phone only when one is given", async () => {
    await lcupApi.createAccount(3);
    await lcupApi.createAccount(3, "+998 93 000 00 01");
    expect(post).toHaveBeenNthCalledWith(1, "/lcup/students/3/create-account/", {});
    expect(post).toHaveBeenNthCalledWith(2, "/lcup/students/3/create-account/", { phone: "+998 93 000 00 01" });
  });

  it("links people and reissues claims", async () => {
    await lcupApi.linkStudent(3, 40);
    await lcupApi.linkTeacher(4, 41);
    await lcupApi.reissue(40);
    expect(post).toHaveBeenNthCalledWith(1, "/lcup/students/3/link/", { user_id: 40 });
    expect(post).toHaveBeenNthCalledWith(2, "/lcup/teachers/4/link/", { user_id: 41 });
    expect(post).toHaveBeenNthCalledWith(3, "/lcup/accounts/40/reissue/");
  });

  it("sends the student's first password", async () => {
    await lcupApi.setInitialPassword("Kitob-va-Qalam-2026");
    expect(post).toHaveBeenCalledWith("/lcup/claim/password/", { password: "Kitob-va-Qalam-2026" });
  });
});
