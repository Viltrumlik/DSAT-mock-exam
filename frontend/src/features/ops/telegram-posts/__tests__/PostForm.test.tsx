import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The post form. What is worth pinning: it counts against the limit Telegram will apply, it
 * asks first and names how many groups, and a picture turns the body into a multipart form.
 */

const save = vi.fn();
const confirmSpy = vi.fn();

vi.mock("@/features/ops/telegram-posts/telegramPostsHooks", () => ({
  useSavePost: () => ({ mutate: save, isPending: false }),
  useTelegramGroups: () => ({
    data: {
      enabled: true,
      groups: [
        { id: 1, name: "Senior G1 Math", subject: "MATH", level: "senior", chat_id: "-1001" },
        { id: 2, name: "Junior G2 Math", subject: "MATH", level: "junior", chat_id: "-1002" },
        { id: 3, name: "Senior G3 English", subject: "ENGLISH", level: "senior", chat_id: "-1003" },
        { id: 4, name: "Senior G4 English", subject: "ENGLISH", level: "senior", chat_id: "-1003" },
      ],
    },
  }),
}));

const { PostForm } = await import("@/features/ops/telegram-posts/PostForm");
type FormPost = NonNullable<React.ComponentProps<typeof PostForm>["post"]>;

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;
const radio = (label: string) =>
  Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim() === label)!.querySelector("input")!;

async function typeMessage(value: string) {
  const area = document.body.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choosePicture() {
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["png"], "mock.png", { type: "image/png" });
  await act(async () => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return file;
}

async function render(post: FormPost | null = null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<PostForm post={post} onClose={vi.fn()} />));
}

function weeklyPost(over: Record<string, unknown> = {}): FormPost {
  return {
    id: 7, kind: "MANUAL", text: "Ertaga mock!", preview: "Ertaga mock!", image_url: null,
    button_text: "", button_url: "", subjects: [], levels: [], classroom_ids: [],
    when: "WEEKLY", send_at: null, weekdays: [5], time_of_day: "18:00:00", is_paused: false, deleted_at: null,
    event_id: null, event_title: "", created_at: "2026-10-17T10:00:00+05:00", audience_label: "All groups",
    next_send_at: "2026-10-24T18:00:00+05:00", last_run: null, state: "scheduled", runs: [],
    ...over,
  } as FormPost;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  confirmSpy.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("PostForm", () => {
  it("counts against 4096, and against 1024 once a picture is chosen", async () => {
    await render();
    await typeMessage("Ertaga mock!");
    expect(text()).toContain("12/4096 characters");
    await choosePicture();
    expect(text()).toContain("12/1024 characters");
  });

  it("asks first, naming how many groups — one per chat", async () => {
    await render();
    await typeMessage("Ertaga mock!");
    await act(async () => button("Post now").click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("Post this to 3 Telegram groups now?");
    const body = save.mock.calls[0][0].body;
    expect(body).toMatchObject({ text: "Ertaga mock!", when: "NOW", subjects: [], levels: [], classroom_ids: [] });
  });

  it("sends nothing when the confirm is declined", async () => {
    confirmSpy.mockReturnValue(false);
    await render();
    await typeMessage("Ertaga mock!");
    await act(async () => button("Post now").click());
    expect(save).not.toHaveBeenCalled();
  });

  it("will not schedule a weekly post with no day", async () => {
    await render();
    await typeMessage("Ertaga mock!");
    await act(async () => radio("Every week").click());
    await act(async () => button("Schedule").click());
    expect(text()).toContain("Pick at least one day.");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("sends a picture as multipart, with the lists as JSON strings", async () => {
    await render();
    await typeMessage("Ertaga mock!");
    const file = await choosePicture();
    await act(async () => button("Post now").click());
    const body = save.mock.calls[0][0].body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("subjects")).toBe("[]");
    expect(body.get("image")).toBe(file);
  });

  it("lets a post that has not run change its timing", async () => {
    await render(weeklyPost());
    expect(radio("Now").disabled).toBe(false);
    expect(radio("Once, at a set time").disabled).toBe(false);
    expect(radio("Every week").disabled).toBe(false);
    expect(text()).not.toContain("This post has already run");
  });

  it("locks the timing of a post that has already run, but not the rest", async () => {
    await render(
      weeklyPost({ last_run: { run_on: "2026-10-17", total: 26, sent: 26, failed: 0, missed: 0, pending: 0, deleted: 0 } }),
    );
    expect(text()).toContain("This post has already run — its timing can't change.");
    expect(radio("Now").disabled).toBe(true);
    expect(radio("Once, at a set time").disabled).toBe(true);
    expect(radio("Every week").disabled).toBe(true);
    // Which days and what time a weekly post goes out stays editable; only the kind of timing is fixed.
    const days = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(days.length).toBeGreaterThan(0);
    expect(days.every((d) => !d.disabled)).toBe(true);
    expect(document.body.querySelector<HTMLInputElement>('input[type="time"]')!.disabled).toBe(false);
    expect(document.body.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
  });

  it("saves an edit of a post that has run, keeping its timing kind", async () => {
    await render(
      weeklyPost({ last_run: { run_on: "2026-10-17", total: 26, sent: 26, failed: 0, missed: 0, pending: 0, deleted: 0 } }),
    );
    await act(async () => button("Schedule").click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("Schedule this for 3 Telegram groups?");
    expect(save.mock.calls[0][0]).toMatchObject({ id: 7, body: { when: "WEEKLY", weekdays: [5] } });
  });
});
