/**
 * The People page's teaching team, from the roster payload to the screen: each person wears
 * the title of their account, and the team reads from the owner down.
 *
 * The roster below is a real class's shape, in the order the server sends it
 * (`order_by("role", "-joined_at")`): after an ownership transfer the teacher is OWNER and
 * sorts first, while the admin and the super_admin are both TEACHER and sort last. Read off the
 * membership, that class showed its teacher as "Owner" and its admin as "Teacher".
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomWithRole, Member } from "../types";

const people = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { patch: vi.fn() },
  classesApi: { people: (...args: unknown[]) => people(...args) },
}));

const { People } = await import("../pages/People");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  people.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function member(id: number, role: string, first_name: string, accountRole: string): Member {
  return {
    id,
    role,
    joined_at: "2026-09-01T09:00:00+05:00",
    user: { id: 100 + id, email: `${first_name.toLowerCase()}@example.com`, first_name, last_name: "", role: accountRole },
  };
}

const ROSTER: Member[] = [
  member(1, "OWNER", "Tina", "teacher"),
  member(2, "STUDENT", "Stella", "student"),
  member(3, "TA", "Sofia", "support_teacher"),
  member(4, "TA", "Paul", "student"),
  member(5, "TEACHER", "Adam", "admin"),
  member(6, "TEACHER", "Omar", "super_admin"),
];

async function mount(myRole = "OWNER") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const classroom = { id: 34, name: "SAT English", my_role: myRole } as unknown as ClassroomWithRole;
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <People classroom={classroom} />
      </QueryClientProvider>,
    );
  });
  // The roster resolves after the first commit; let the page re-render with it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** [name, badge] for each row of the teaching team, top to bottom. */
function teachingTeam(): [string, string][] {
  const team = host.querySelectorAll("section")[0];
  return Array.from(team.querySelectorAll<HTMLElement>(".group")).map((row) => [
    row.querySelector("p")?.textContent ?? "",
    row.querySelector('span[class~="px-2.5"]')?.textContent ?? "",
  ]);
}

describe("People — teaching team", () => {
  it("titles each person by their account and lists the owner first", async () => {
    people.mockResolvedValue(ROSTER);
    await mount();

    expect(teachingTeam()).toEqual([
      ["Omar", "Owner"],
      ["Adam", "Admin"],
      ["Tina", "Teacher"],
      // Same title, so the server's order holds between them.
      ["Sofia", "Support teacher"],
      ["Paul", "Support teacher"],
    ]);
    expect(host.textContent).not.toMatch(/teaching assistant/i);
  });

  it("keeps students out of the teaching team", async () => {
    people.mockResolvedValue(ROSTER);
    await mount();

    const names = teachingTeam().map(([name]) => name);
    expect(names).not.toContain("Stella");
    expect(host.querySelectorAll("section")[1].textContent).toContain("Stella");
  });
});
