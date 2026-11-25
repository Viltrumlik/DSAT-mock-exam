/** /ops/toolbox is a page only on the test copy: anywhere else it is not found. */
import { afterEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("@/features/ops/toolbox/ToolboxPage", () => ({ ToolboxPage: () => null }));

const { default: OpsToolboxPage } = await import("@/app/(ops)/ops/toolbox/page");

afterEach(() => {
  vi.unstubAllEnvs();
  notFound.mockClear();
});

describe("/ops/toolbox", () => {
  it("is not found without the test copy's flag", () => {
    vi.stubEnv("NEXT_PUBLIC_STAGING_TOOLBOX", "");
    expect(() => OpsToolboxPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("renders the toolbox on the test copy", () => {
    vi.stubEnv("NEXT_PUBLIC_STAGING_TOOLBOX", "1");
    expect(OpsToolboxPage()).not.toBeNull();
    expect(notFound).not.toHaveBeenCalled();
  });
});
