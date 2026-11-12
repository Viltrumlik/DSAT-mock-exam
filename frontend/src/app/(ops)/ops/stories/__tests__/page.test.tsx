/**
 * /ops/stories in the console's look: every story says which of its states it is in, Add a story and Edit story
 * in the console's dialog with the same bodies (a picture required on create, the window's times round-tripped
 * as before, "" for an empty end in FormData), the server's words on a refusal, Delete through the console's
 * confirm dialog, the empty state, and a failed load that is never drawn as no stories.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  rail: vi.fn(),
  adminStories: vi.fn(),
  createStory: vi.fn(),
  updateStory: vi.fn(),
  deleteStory: vi.fn(),
}));

vi.mock("@/features/stories/storiesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/stories/storiesApi")>()),
  storiesApi: api,
}));

const { default: Page } = await import("../page");

function story(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `Story ${id}`,
    caption: "",
    image_url: `https://r2.example/${id}.png`,
    link_url: "",
    is_active: true,
    sort_order: id,
    starts_at: null,
    ends_at: null,
    is_live: false,
    created_at: "2026-11-01T00:00:00Z",
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Page />
      </QueryClientProvider>,
    );
  });
  await settle();
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function pick(el: HTMLInputElement, file: File) {
  await act(async () => {
    Object.defineProperty(el, "files", { value: [file], configurable: true });
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === words)!;
const row = (id: number) => host.querySelector<HTMLElement>(`[data-story="${id}"]`)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const inDialog = <T extends Element>(sel: string) => dialog()!.querySelector<T>(sel)!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of Object.values(api)) f.mockReset();
  api.adminStories.mockResolvedValue([
    story(1, { title: "Mock exam Saturday", is_live: true }),
    story(2, { is_active: false }),
    story(3, { starts_at: "2099-01-05T04:00:00.000Z" }),
    story(4, { ends_at: "2020-01-05T04:00:00.000Z" }),
    story(5, { title: "", image_url: null }),
  ]);
  api.createStory.mockResolvedValue(story(9));
  api.updateStory.mockResolvedValue(story(1));
  api.deleteStory.mockResolvedValue({ detail: "Deleted.", deleted: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the list", () => {
  it("says which state each story is in, and how many are showing", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("Stories");
    expect(host.textContent).toContain("1 showing");
    expect(row(1).textContent).toContain("Mock exam Saturday");
    expect(row(1).textContent).toContain("Showing now");
    expect(row(1).textContent).toContain("#1");
    expect(row(2).textContent).toContain("Hidden");
    expect(row(3).textContent).toContain("Scheduled");
    expect(row(3).textContent).toContain("– open");
    expect(row(4).textContent).toContain("Finished");
    expect(row(4).textContent).toContain("now – ");
    expect(row(5).textContent).toContain("Untitled");
    expect(row(5).querySelector('[title="Saved without a picture"]')).not.toBeNull();
  });

  it("shows the empty state", async () => {
    api.adminStories.mockResolvedValue([]);
    await render();
    expect(host.textContent).toContain("No stories yet");
    expect(host.textContent).toContain("Add one and it appears on every student's dashboard.");
  });

  it("never draws a failed load as no stories, and tries again", async () => {
    api.adminStories.mockRejectedValueOnce(new Error("boom"));
    await render();
    expect(host.textContent).toContain("The stories didn't load.");
    expect(host.textContent).not.toContain("No stories yet");
    await click(buttonIn(host, "Try again"));
    expect(api.adminStories).toHaveBeenCalledTimes(2);
    expect(row(1)).not.toBeNull();
  });
});

describe("add and edit", () => {
  it("will not add a story without a picture", async () => {
    await render();
    await click(buttonIn(host, "Add a story"));
    expect(dialog()!.querySelector("h2")!.textContent).toBe("Add a story");
    await click(buttonIn(dialog()!, "Save"));
    expect(dialog()!.textContent).toContain("Pick a picture — the picture is the story.");
    expect(api.createStory).not.toHaveBeenCalled();
  });

  it("adds a story as FormData, an empty window end as an empty string", async () => {
    await render();
    await click(buttonIn(host, "Add a story"));
    await type(inDialog<HTMLInputElement>("#story-title"), "Open day");
    await type(inDialog<HTMLTextAreaElement>("#story-caption"), "Come along.");
    await type(inDialog<HTMLInputElement>("#story-link"), "/events");
    await type(inDialog<HTMLInputElement>("#story-starts"), "2030-03-01T09:00");
    await type(inDialog<HTMLInputElement>("#story-sort"), "4");
    await pick(inDialog<HTMLInputElement>("#story-image"), new File(["x"], "open.png", { type: "image/png" }));
    await click(buttonIn(dialog()!, "Save"));
    const body = api.createStory.mock.calls[0][0] as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("title")).toBe("Open day");
    expect(body.get("caption")).toBe("Come along.");
    expect(body.get("link_url")).toBe("/events");
    expect(body.get("sort_order")).toBe("4");
    expect(body.get("is_active")).toBe("true");
    expect(body.get("starts_at")).toBe(new Date("2030-03-01T09:00").toISOString());
    expect(body.get("ends_at")).toBe("");
    expect((body.get("image") as File).name).toBe("open.png");
    expect(dialog()).toBeNull();
  });

  it("edits a story as JSON, its window round-tripped unchanged", async () => {
    await render();
    await click(buttonIn(row(3), "Edit"));
    expect(dialog()!.querySelector("h2")!.textContent).toBe("Edit story");
    expect(inDialog<HTMLInputElement>("#story-title").value).toBe("Story 3");
    await click(inDialog<HTMLInputElement>("#story-active"));
    await click(buttonIn(dialog()!, "Save"));
    expect(api.updateStory).toHaveBeenCalledWith(3, {
      title: "Story 3",
      caption: "",
      link_url: "",
      sort_order: 3,
      is_active: false,
      starts_at: "2099-01-05T04:00:00.000Z",
      ends_at: null,
    });
  });

  it("shows the server's words in the dialog when a save is refused", async () => {
    api.updateStory.mockRejectedValue({ response: { status: 400, data: { link_url: ["Enter a valid path."] } } });
    await render();
    await click(buttonIn(row(1), "Edit"));
    await click(buttonIn(dialog()!, "Save"));
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("Enter a valid path.");
  });
});

describe("delete", () => {
  it("asks in the console dialog, then deletes", async () => {
    await render();
    await click(buttonIn(row(1), "Delete"));
    const d = dialog()!;
    expect(d.querySelector("h2")!.textContent).toBe('Delete "Mock exam Saturday"?');
    expect(d.textContent).toContain("This cannot be undone.");
    expect(api.deleteStory).not.toHaveBeenCalled();
    await click(buttonIn(d, "Delete"));
    expect(api.deleteStory).toHaveBeenCalledWith(1);
  });

  it("does nothing when the dialog is cancelled", async () => {
    await render();
    await click(buttonIn(row(2), "Delete"));
    await click(buttonIn(dialog()!, "Cancel"));
    expect(api.deleteStory).not.toHaveBeenCalled();
  });

  it("shows a refusal in the dialog in the server's words", async () => {
    api.deleteStory.mockRejectedValue({ response: { status: 403, data: { detail: "Only a super admin can delete stories." } } });
    await render();
    await click(buttonIn(row(1), "Delete"));
    await click(buttonIn(dialog()!, "Delete"));
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("Only a super admin can delete stories.");
  });
});
