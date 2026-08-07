/**
 * Reviewers (admins, test_admin, test_auditor, super_admin) see the Review Center
 * section stacked on top of the student IA — and BOTH of those sections are
 * headerless, so their `section` heading is the same empty string. Keying the
 * rendered list on the heading collided the two, which React documents as
 * unsupported: children may be duplicated or omitted. Sections carry an `id`
 * for that reason; these tests hold the line.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../AppShell";
import { reviewNavSection, studentNav, teacherNav } from "../navConfig";

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function labels() {
  return Array.from(host.querySelectorAll("a")).map((a) => a.textContent?.trim());
}

describe("AppShell nav sections", () => {
  it("renders a reviewer's two headerless sections without a duplicate-key warning", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    await act(async () => {
      root.render(
        <AppShell
          brand={{ name: "MasterSAT" }}
          nav={[reviewNavSection, ...studentNav]}
          pathname="/"
          user={{ name: "Test Admin" }}
        >
          <div />
        </AppShell>,
      );
    });

    expect(errors.filter((e) => /same key/i.test(e))).toEqual([]);

    // Neither section was dropped: the reviewer entry AND the student IA both render.
    const rendered = labels();
    expect(rendered).toContain("Review Center");
    expect(rendered).toContain("Dashboard");
    expect(rendered).toContain("Profile");
  });

  it("gives every nav section a unique id", () => {
    for (const nav of [[reviewNavSection, ...studentNav], studentNav, teacherNav]) {
      const ids = nav.map((s) => s.id);
      expect(ids.filter(Boolean)).toHaveLength(ids.length);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
