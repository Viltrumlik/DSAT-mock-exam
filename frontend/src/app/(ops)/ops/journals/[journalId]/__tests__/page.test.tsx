/**
 * /ops/journals/[journalId] in the console's look: the journal's state, progress and sessions; the filters and the
 * search; Publish / Archive / Restore with the same calls; New session and New midterm (the picker dialog) with the
 * same payloads; Delete in the console's dialog — a refusal shows the server's words there; the bulk bar; the
 * empty state; and the page's own words when it cannot load.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = {
  get: vi.fn(),
  publish: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  addSession: vi.fn(),
  midtermOptions: vi.fn(),
  deleteSession: vi.fn(),
  bulk: vi.fn(),
  exportJournal: vi.fn(),
  importJournal: vi.fn(),
};
const routerPush = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ journalId: "3" }),
  useRouter: () => ({ push: routerPush }),
}));
vi.mock("@/features/journals/api", () => ({
  journalsApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { default: Page } = await import("../page");

function lesson(id: number, number: number, over: Record<string, unknown> = {}) {
  return {
    id,
    lesson_number: number,
    lesson_type: "HOMEWORK",
    status: "DRAFT",
    title: "",
    content_count: 2,
    is_ready: true,
    homework_ready: true,
    classwork_ready: true,
    has_roadmap: false,
    validation: [],
    homework_validation: [],
    classwork_validation: [],
    has_files: false,
    has_assessment: false,
    has_pastpaper: false,
    midterm: null,
    new_topic_title: "",
    updated_at: "2026-11-01T09:00:00+05:00",
    created_at: "2026-11-01T09:00:00+05:00",
    ...over,
  };
}

function journal(over: Record<string, unknown> = {}) {
  return {
    id: 3,
    subject: "MATH",
    subject_label: "Math",
    level: "junior",
    level_label: "Junior",
    title: "",
    display_title: "Math Junior",
    status: "DRAFT",
    duration_months: 3,
    total_lessons: 36,
    version: 1,
    last_updated: "2026-11-01T09:00:00+05:00",
    recommended: { months: 3, lessons: 36, midterms: 3, midterm_every: 12 },
    created_at: "2026-11-01T09:00:00+05:00",
    updated_at: "2026-11-01T09:00:00+05:00",
    published_at: null,
    archived_at: null,
    progress: {
      sessions_total: 4, sessions_ready: 2, sessions_missing: 2,
      homework_total: 3, homework_ready: 2, homework_missing: 1,
      classwork_ready: 3, classwork_missing: 0,
      midterm_total: 1, midterm_count: 1, midterm_configured: 1,
      draft_count: 3, published_count: 1, completion_pct: 40,
    },
    lessons: [
      lesson(11, 1, { title: "Linear equations", has_assessment: true }),
      lesson(12, 2, { new_topic_title: "Ratios", is_ready: false, homework_ready: false, validation: ["Add instructions."] }),
      lesson(13, 3, { lesson_type: "MIDTERM", midterm: { exam_id: 7, title: "Midterm 1", access_days_before: 2 } }),
      lesson(14, 4, { title: "Functions", status: "PUBLISHED", has_files: true, content_count: 1 }),
    ],
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  await act(async () => {
    root.render(<Page />);
  });
  await settle();
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
const exactButton = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === words);
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const row = (id: number) => host.querySelector<HTMLElement>(`li[data-lesson="${id}"]`);
const rows = () => Array.from(host.querySelectorAll<HTMLElement>("li[data-lesson]")).map((li) => Number(li.dataset.lesson));
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const alertText = () => host.querySelector('[role="alert"]')?.textContent ?? "";

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [...Object.values(api), routerPush]) f.mockReset();
  api.get.mockResolvedValue(journal());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("the journal", () => {
  it("shows its state, progress and sessions", async () => {
    await render();
    expect(api.get).toHaveBeenCalledWith(3);
    expect(host.querySelector("h1")!.textContent).toBe("Math Junior");
    expect(host.querySelector('a[href="/ops/journals"]')!.textContent).toContain("All journals");
    expect(host.textContent).toContain("DRAFT");
    expect(host.textContent).toContain("3 mo");
    expect(host.textContent).toContain("36 lessons");
    expect(host.textContent).toContain("3 homework");
    expect(host.textContent).toContain("1 midterm");

    const progress = host.querySelector('section[aria-label="Progress"]')!.textContent!;
    expect(progress).toMatch(/Completion\s*40%/);
    expect(progress).toMatch(/Homework ready\s*2\/3/);
    expect(progress).toMatch(/Classwork ready\s*3\/3/);
    expect(progress).toMatch(/Midterms set\s*1\/1/);
    expect(progress).toMatch(/Published \/ Draft\s*1 \/ 3/);

    expect(host.textContent).toContain("4 sessions");
    expect(host.textContent).toContain("Recommended for Junior: 36 lessons · midterm every 12");

    expect(rows()).toEqual([11, 12, 13, 14]);
    expect(row(11)!.textContent).toContain("Linear equations");
    expect(row(11)!.textContent).toContain("Ready");
    expect(row(11)!.textContent).toContain("2 items");
    expect(row(11)!.textContent).toContain("· Homework ✓");
    expect(row(12)!.textContent).toContain("Ratios");
    expect(row(12)!.textContent).toContain("Missing");
    expect(row(12)!.textContent).toContain("· Homework —");
    expect(row(12)!.textContent).toContain("Add instructions.");
    expect(row(13)!.textContent).toContain("Midterm 1");
    expect(row(13)!.textContent).toContain("Class gets access 2 days before · no homework");
    expect(row(13)!.querySelector('input[type="checkbox"]')).toBeNull();
    expect(buttonIn(row(13)!, "Edit")).toBeUndefined();
    expect(row(14)!.textContent).toContain("Published");
    expect(row(14)!.textContent).toContain("1 item");
  });

  it("opens a session's editor", async () => {
    await render();
    await click(buttonIn(row(12)!, "Edit"));
    expect(routerPush).toHaveBeenCalledWith("/ops/journals/3/lessons/12");
  });

  it("says when it could not load", async () => {
    api.get.mockRejectedValue(new Error("down"));
    await render();
    expect(alertText()).toContain("Could not load this journal.");
    expect(host.querySelector('a[href="/ops/journals"]')).not.toBeNull();
  });

  it("shows the empty state when the journal has no sessions", async () => {
    api.get.mockResolvedValue(journal({ lessons: [] }));
    await render();
    expect(host.textContent).toContain("No sessions yet — add the first one with “New session”.");
  });
});

describe("filters and search", () => {
  it("narrows the sessions by filter", async () => {
    await render();
    await click(buttonIn(host, "Midterm"));
    expect(rows()).toEqual([13]);
    await click(buttonIn(host, "Missing"));
    expect(rows()).toEqual([12]);
    await click(buttonIn(host, "Has files"));
    expect(rows()).toEqual([14]);
    await click(buttonIn(host, "Has assessment"));
    expect(rows()).toEqual([11]);
    await click(buttonIn(host, "Published"));
    expect(rows()).toEqual([14]);
    await click(buttonIn(host, "All"));
    expect(rows()).toEqual([11, 12, 13, 14]);
  });

  it("searches by number and title, and says when nothing matches", async () => {
    await render();
    await search("func");
    expect(rows()).toEqual([14]);
    await search("zzz");
    expect(rows()).toEqual([]);
    expect(host.textContent).toContain("No sessions match.");
  });
});

describe("journal actions", () => {
  it("publishes, and offers Revert to draft once published", async () => {
    api.publish.mockResolvedValue(journal({ status: "PUBLISHED" }));
    await render();
    await click(buttonIn(host, "Publish"));
    expect(api.publish).toHaveBeenCalledWith(3);
    expect(host.textContent).toContain("PUBLISHED");
    expect(buttonIn(host, "Revert to draft")).toBeDefined();
  });

  it("shows a refusal in the server's words", async () => {
    api.publish.mockRejectedValue({ response: { status: 400, data: { detail: "Journal has no sessions." } } });
    await render();
    await click(buttonIn(host, "Publish"));
    expect(alertText()).toContain("Journal has no sessions.");
  });

  it("archives, then restores to draft", async () => {
    api.archive.mockResolvedValue(journal({ status: "ARCHIVED" }));
    api.unarchive.mockResolvedValue(journal({ status: "DRAFT" }));
    await render();
    await click(buttonIn(host, "Archive"));
    expect(api.archive).toHaveBeenCalledWith(3);
    expect(exactButton(host, "Publish")).toBeUndefined();
    expect(buttonIn(host, "New session")).toBeUndefined();
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect((buttonIn(row(11)!, "Edit") as HTMLButtonElement).disabled).toBe(true);
    await click(buttonIn(host, "Restore to draft"));
    expect(api.unarchive).toHaveBeenCalledWith(3);
    expect(exactButton(host, "Publish")).toBeDefined();
  });
});

describe("adding sessions", () => {
  it("adds a homework session and reloads", async () => {
    api.addSession.mockResolvedValue({});
    await render();
    await click(buttonIn(host, "New session"));
    expect(api.addSession).toHaveBeenCalledWith(3, "HOMEWORK");
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("says when a session could not be added", async () => {
    api.addSession.mockRejectedValue(new Error("no"));
    await render();
    await click(buttonIn(host, "New session"));
    expect(alertText()).toContain("Could not add a session.");
  });

  it("picks a midterm for this level in the dialog", async () => {
    api.midtermOptions.mockResolvedValue({
      midterms: [{ id: 21, title: "Midterm A", subject: "MATH", level: "junior", scoring_scale: "", duration_minutes: 70, question_count: 40 }],
    });
    api.addSession.mockResolvedValue({});
    await render();
    await click(buttonIn(host, "New midterm"));
    expect(api.midtermOptions).toHaveBeenCalledWith("MATH", "junior");
    expect(dialog()!.textContent).toContain("Add a midterm session");
    expect(dialog()!.textContent).toContain("Showing published midterms for Math · Junior.");
    expect(dialog()!.textContent).toContain("junior · 40 questions · 70 min");
    await click(buttonIn(dialog()!, "Midterm A"));
    expect(api.addSession).toHaveBeenCalledWith(3, "MIDTERM", 21);
  });

  it("says when no midterm is tagged for the level, and closes", async () => {
    api.midtermOptions.mockResolvedValue({ midterms: [] });
    await render();
    await click(buttonIn(host, "New midterm"));
    expect(dialog()!.textContent).toContain("No published midterms are tagged for this level yet.");
    await click(byLabel("Close"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(dialog()).toBeNull();
  });
});

describe("deleting a session", () => {
  it("asks first, then deletes and reloads", async () => {
    api.deleteSession.mockResolvedValue(undefined);
    await render();
    await click(byLabel("Delete session 2"));
    expect(dialog()!.textContent).toContain("Delete session 2?");
    expect(dialog()!.textContent).toContain("Later sessions are renumbered.");
    await click(buttonIn(dialog()!, "Delete"));
    expect(api.deleteSession).toHaveBeenCalledWith(3, 12);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("shows a refusal in the dialog, in the server's words or the page's own", async () => {
    api.deleteSession.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Session 2 is live homework." } } });
    await render();
    await click(byLabel("Delete session 2"));
    await click(buttonIn(dialog()!, "Delete"));
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("Session 2 is live homework.");

    api.deleteSession.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    await click(buttonIn(dialog()!, "Delete"));
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("Could not delete that session.");
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

describe("bulk actions", () => {
  it("acts on the ticked sessions, and Cancel clears them", async () => {
    api.bulk.mockResolvedValue({ results: [], affected: 2, skipped: 0 });
    await render();
    await click(byLabel("Select lesson 1"));
    await click(byLabel("Select lesson 2"));
    const bar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
    expect(bar.textContent).toContain("2 selected");
    await click(buttonIn(bar, "Publish"));
    expect(api.bulk).toHaveBeenCalledWith(3, "publish", [11, 12]);
    expect(host.querySelector('[role="toolbar"]')).toBeNull();

    await click(byLabel("Select lesson 4"));
    expect(host.querySelector('[role="toolbar"]')!.textContent).toContain("1 selected");
    await click(buttonIn(host.querySelector('[role="toolbar"]')!, "Cancel"));
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("says when a bulk action failed", async () => {
    api.bulk.mockRejectedValue(new Error("no"));
    await render();
    await click(byLabel("Select lesson 1"));
    await click(buttonIn(host.querySelector('[role="toolbar"]')!, "Clear content"));
    expect(api.bulk).toHaveBeenCalledWith(3, "clear", [11]);
    expect(alertText()).toContain("Bulk clear failed.");
  });
});
