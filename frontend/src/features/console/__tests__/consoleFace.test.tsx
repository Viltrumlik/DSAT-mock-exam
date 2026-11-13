/**
 * The consoles moved from the body's Georgia to the redesign's UI sans (`.ms`, in OpsShell), and
 * their dialogs and toasts follow (OverlayFace's UI default). The Builder's full-screen editors do
 * not move yet: they show a question exactly as the student reads it, in Georgia, so they stay out
 * of `.ms` and keep the body face for their overlays too.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOverlayFace } from "@/components/ui/OverlayFace";

let pathname = "/builder";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/components/AuthGuard", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me: { role: "super_admin", permissions: ["*"] } }) }));
vi.mock("@/features/ops/shell/OpsShell", () => ({
  OpsShell: ({ children }: { children: React.ReactNode }) => <div className="ms">{children}</div>,
}));

const { default: BuilderLayout } = await import("@/app/(builder)/builder/layout");
const { default: OpsLayout } = await import("@/app/(ops)/layout");

function Face() {
  return <span data-face={useOverlayFace()} />;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const face = () => host.querySelector("[data-face]")?.getAttribute("data-face");
const inSurface = () => Boolean(host.querySelector("[data-face]")?.closest(".ms"));

describe("the consoles' face", () => {
  it("opens Builder page overlays in the UI face, inside the console surface", () => {
    pathname = "/builder/question-bank";
    act(() => root.render(<BuilderLayout><Face /></BuilderLayout>));
    expect(face()).toBe("ui");
    expect(inSurface()).toBe(true);
  });

  it("keeps a Builder editor — and its dialogs — in the reading face, outside the surface", () => {
    pathname = "/builder/sets/12";
    act(() => root.render(<BuilderLayout><Face /></BuilderLayout>));
    expect(face()).toBe("body");
    expect(inSurface()).toBe(false);
  });

  it("opens Admin overlays in the UI face", () => {
    pathname = "/ops/students";
    act(() => root.render(<OpsLayout><Face /></OpsLayout>));
    expect(face()).toBe("ui");
  });
});
