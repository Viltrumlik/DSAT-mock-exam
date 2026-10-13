/**
 * A public learner who lands on a learning-center page (a bookmark, an old link, a typed URL)
 * is sent to the mock exams instead of a page full of refusals. The server is the real gate
 * (host guard); this only keeps the screen honest.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let pathname = "/classes";
let role = "public_student";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/useMe", () => ({
  useMe: () => ({ bootState: "AUTHENTICATED", me: { id: 1, role, profile_complete: true } }),
}));

const { default: AuthGuard } = await import("../AuthGuard");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  replace.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount() {
  await act(async () => {
    root.render(
      <AuthGuard>
        <p>page body</p>
      </AuthGuard>,
    );
  });
}

describe("AuthGuard for a public learner", () => {
  it("sends them from a learning-center page to the mock exams", async () => {
    pathname = "/classes";
    role = "public_student";
    await mount();
    expect(replace).toHaveBeenCalledWith("/mock-exam");
    expect(host.textContent).not.toContain("page body");
  });

  it("lets them stay on the mock exams, the runner, events and the profile", async () => {
    role = "public_student";
    for (const p of ["/mock-exam", "/exam/9", "/events", "/profile"]) {
      pathname = p;
      replace.mockReset();
      await mount();
      expect(replace, p).not.toHaveBeenCalled();
      expect(host.textContent, p).toContain("page body");
    }
  });

  it("never moves a learning-center student", async () => {
    pathname = "/classes";
    role = "student";
    await mount();
    expect(replace).not.toHaveBeenCalled();
    expect(host.textContent).toContain("page body");
  });
});
