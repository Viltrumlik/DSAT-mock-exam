/**
 * The student's notification switches — the client `/api/notifications/preferences/` never had.
 *
 * The endpoint has been a working GET/PATCH since day one and the server has honoured a muted
 * category on every write, so "you can turn a section off" was true of the API and false of the
 * product. Two properties are worth holding here.
 *
 * **A failed fetch must not render as "nothing to configure."** That is the house rule (four
 * branches: loading / error / empty / rows) and it bites hardest on a settings screen: telling
 * a student they have no choices is the exact opposite of what this card exists to say.
 *
 * **The section list comes from the server.** A private client-side copy of the categories
 * means a section added later has no switch, which reads to a student as "this one cannot be
 * turned off" rather than as a bug.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationPreferences } from "../notificationsApi";

const useNotificationPreferences = vi.fn();
const useSaveNotificationPreferences = vi.fn();
const usePushConfig = vi.fn();

vi.mock("../notificationsHooks", () => ({
  useNotificationPreferences: (...a: unknown[]) => useNotificationPreferences(...a),
  useSaveNotificationPreferences: (...a: unknown[]) => useSaveNotificationPreferences(...a),
  usePushConfig: (...a: unknown[]) => usePushConfig(...a),
}));

const { NotificationPreferencesCard } = await import("../NotificationPreferencesCard");

const PREFS: NotificationPreferences = {
  muted_categories: ["REWARDS"],
  push_enabled: true,
  categories: [
    { value: "GRADES", label: "Grades" },
    { value: "HOMEWORK", label: "Homework" },
    { value: "REWARDS", label: "Rewards & Shop" },
  ],
};

function query(overrides: Record<string, unknown> = {}) {
  return { data: undefined, isPending: false, isError: false, refetch: vi.fn(), ...overrides };
}

let host: HTMLElement;
let root: Root;
let mutate: ReturnType<typeof vi.fn>;

async function render() {
  await act(async () => root.render(<NotificationPreferencesCard />));
}

/** The switch for one section, found by the accessible label the component gives it. */
function switchFor(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button[role="switch"]')].find(
    (b) => b.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`no switch labelled "${label}"`);
  return found;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mutate = vi.fn();
  useSaveNotificationPreferences.mockReturnValue({
    mutate, isPending: false, isError: false,
  });
  usePushConfig.mockReturnValue(query({ data: { enabled: true, public_key: "B0" } }));
  useNotificationPreferences.mockReturnValue(query({ data: PREFS }));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("NotificationPreferencesCard", () => {
  it("draws a switch for every section the server serves", async () => {
    await render();

    expect(host.textContent).toContain("Grades");
    expect(host.textContent).toContain("Homework");
    expect(host.textContent).toContain("Rewards & Shop");
  });

  it("shows a muted section as off and an unmuted one as on", async () => {
    await render();

    expect(switchFor("Grades notifications").getAttribute("aria-checked")).toBe("true");
    expect(switchFor("Rewards & Shop notifications").getAttribute("aria-checked")).toBe("false");
  });

  it("mutes a section by adding it to the exceptions, leaving the rest alone", async () => {
    await render();

    await act(async () => switchFor("Grades notifications").click());

    expect(mutate).toHaveBeenCalledWith({ muted_categories: ["REWARDS", "GRADES"] });
  });

  it("unmutes a section by removing it, never by sending the whole world", async () => {
    await render();

    await act(async () => switchFor("Rewards & Shop notifications").click());

    expect(mutate).toHaveBeenCalledWith({ muted_categories: [] });
  });

  it("saves the phone toggle on its own", async () => {
    await render();

    await act(async () => switchFor("Push notifications").click());

    expect(mutate).toHaveBeenCalledWith({ push_enabled: false });
  });

  it("shows a failed fetch as an error, never as an empty settings screen", async () => {
    useNotificationPreferences.mockReturnValue(query({ isError: true }));
    await render();

    expect(host.textContent).toContain("Couldn't load your notification settings");
    expect(host.textContent).not.toContain("No sections to set yet");
    expect(host.querySelectorAll('button[role="switch"]').length).toBe(0);
  });

  it("shows a loading fetch as neither empty nor broken", async () => {
    useNotificationPreferences.mockReturnValue(query({ isPending: true }));
    await render();

    expect(host.textContent).not.toContain("No sections to set yet");
    expect(host.textContent).not.toContain("Couldn't load");
  });

  it("shows a served-but-empty section list as empty", async () => {
    useNotificationPreferences.mockReturnValue(
      query({ data: { ...PREFS, categories: [] } }),
    );
    await render();

    expect(host.textContent).toContain("No sections to set yet");
    expect(host.textContent).not.toContain("Couldn't load");
  });

  it("disables the phone toggle when the deployment cannot deliver push", async () => {
    // Never hidden: a student who turned push off last term should still be able to see that
    // they did, and see why the switch will not move.
    usePushConfig.mockReturnValue(query({ data: { enabled: false, public_key: "" } }));
    await render();

    expect(switchFor("Push notifications").disabled).toBe(true);
    expect(host.textContent).toContain("isn't switched on for this site yet");
  });

  it("says so when a save fails, rather than pretending it stuck", async () => {
    useSaveNotificationPreferences.mockReturnValue({
      mutate, isPending: false, isError: true,
    });
    await render();

    expect(host.textContent).toContain("didn't save");
  });
});
