/**
 * A student the lc-up sync made an account for, who has not signed in yet, carries a quiet
 * "Not signed in yet" badge on the People page — so the teacher knows whom to remind. The
 * server sends the flag only to people who manage the roster.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const members = [
  { id: 1, role: "STUDENT", status: "ACTIVE", user: { id: 11, email: "", first_name: "Malika", last_name: "Karimova", username: "998901234567" }, lcup_claim_pending: true },
  { id: 2, role: "STUDENT", status: "ACTIVE", user: { id: 12, email: "a@b.uz", first_name: "Aziz", last_name: "Tursunov", username: "aziz" }, lcup_claim_pending: false },
];

vi.mock("../../hooks", () => ({
  useClassMembers: () => ({ data: members, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({ default: { patch: vi.fn() } }));

const { People } = await import("../People");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("People — lc-up accounts not signed in yet", () => {
  it("badges only the student who has not signed in", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <People classroom={{ id: 5, my_role: "ADMIN" } as never} />
        </QueryClientProvider>,
      );
    });
    const cards = Array.from(host.querySelectorAll(".cr-card"));
    const badgeOn = (name: string) =>
      cards.find((card) => card.textContent?.includes(name))?.textContent?.includes("Not signed in yet");
    expect(badgeOn("Malika Karimova")).toBe(true);
    expect(badgeOn("Aziz Tursunov")).toBe(false);
  });
});
