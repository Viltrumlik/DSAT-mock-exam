/**
 * The session's roadmap editor in the console's look: the reading's settings, its sections (kind, order, remove,
 * the file a picture or a video carries), Save with the same payload and its "Saved." note, the standing
 * validation note, and the editor's own words — or the server's — when something fails.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = { roadmap: vi.fn(), saveRoadmap: vi.fn(), uploadRoadmapMedia: vi.fn(), clearRoadmapMedia: vi.fn() };

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("../api", () => ({
  journalsApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { default: JournalRoadmapEditor } = await import("../JournalRoadmapEditor");

const TEXT = { id: 1, kind: "TEXT", heading: "Intro", body: "Slope is rise over run.", caption: "", video_url: "" };
const PICTURE = { id: 2, kind: "IMAGE", heading: "", body: "", caption: "A line", video_url: "", image_url: "https://img.test/line.png" };
function roadmap(over: Record<string, unknown> = {}) {
  return {
    title: "Slopes",
    summary: "",
    estimated_minutes: 10,
    require_read_confirmation: true,
    sections: [TEXT, PICTURE],
    has_content: true,
    is_ready: true,
    validation_reasons: [],
    ...over,
  };
}

let host: HTMLElement;
let root: Root;
const onSaved = vi.fn();

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  await act(async () => {
    root.render(<JournalRoadmapEditor journalId={3} lessonId={12} onSaved={onSaved} />);
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
  await settle();
}
async function pickFile(input: HTMLInputElement, file: File) {
  await act(async () => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
const sections = () => Array.from(host.querySelectorAll<HTMLElement>("[data-roadmap-section]"));
const headingOf = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[placeholder="Heading (optional)"]')!.value;
const kindOf = (el: HTMLElement) => el.querySelector('[role="radio"][aria-checked="true"]')!.textContent;
const byLabelIn = (el: ParentNode, label: string) => el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const field = (placeholder: string) => host.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [...Object.values(api), onSaved]) f.mockReset();
  api.roadmap.mockResolvedValue(roadmap());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the roadmap", () => {
  it("shows its settings and sections as saved", async () => {
    await render();
    expect(api.roadmap).toHaveBeenCalledWith(3, 12);
    expect(host.querySelector("h2")!.textContent).toBe("Roadmap");
    expect(field("Falls back to the session's own title").value).toBe("Slopes");
    expect(host.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("10");
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(host.textContent).toContain("Hold the homework until they confirm they’ve read it");

    const [text, picture] = sections();
    expect(kindOf(text)).toBe("Text");
    expect(headingOf(text)).toBe("Intro");
    expect(text.querySelector("textarea")!.value).toBe("Slope is rise over run.");
    expect(text.textContent).toContain("A passage. Leave a blank line between paragraphs.");
    expect(kindOf(picture)).toBe("Picture");
    expect(picture.querySelector("img")!.getAttribute("src")).toBe("https://img.test/line.png");
    expect(picture.textContent).toContain("Replace file");
    expect(buttonIn(picture, "Remove file")).toBeDefined();
  });

  it("shows the first validation reason as a standing note", async () => {
    api.roadmap.mockResolvedValue(roadmap({ validation_reasons: ["Give the picture a file.", "Another"] }));
    await render();
    expect(host.querySelector('[role="note"]')!.textContent).toBe("Give the picture a file.");
  });

  it("says when it could not load, and tries again", async () => {
    api.roadmap.mockRejectedValueOnce(new Error("down"));
    await render();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not load the roadmap for this session.");
    await click(buttonIn(host, "Try again"));
    expect(api.roadmap).toHaveBeenCalledTimes(2);
    expect(sections()).toHaveLength(2);
  });
});

describe("sections", () => {
  it("adds, reorders, changes the kind of, and removes sections", async () => {
    await render();
    await click(buttonIn(host, "Add a section"));
    expect(sections()).toHaveLength(3);
    const added = sections()[2];
    expect(kindOf(added)).toBe("Text");
    await click(buttonIn(added, "Video"));
    expect(kindOf(sections()[2])).toBe("Video");
    expect(sections()[2].textContent).toContain("Save first — a file attaches to a section that exists.");
    expect(sections()[2].querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);

    expect(byLabelIn(sections()[0], "Move up").disabled).toBe(true);
    await click(byLabelIn(sections()[0], "Move down"));
    expect(sections().map(kindOf)).toEqual(["Picture", "Text", "Video"]);
    expect(byLabelIn(sections()[2], "Move down").disabled).toBe(true);

    await click(byLabelIn(sections()[0], "Remove section"));
    expect(sections().map(kindOf)).toEqual(["Text", "Video"]);
  });

  it("uploads a section's file and removes it, with the editor's words when that fails", async () => {
    api.uploadRoadmapMedia.mockResolvedValue({ ...PICTURE, image_url: "https://img.test/new.png" });
    api.clearRoadmapMedia.mockResolvedValue({ ...PICTURE, image_url: null });
    await render();
    const file = new File(["x"], "graph.png", { type: "image/png" });
    await pickFile(sections()[1].querySelector<HTMLInputElement>('input[type="file"]')!, file);
    expect(api.uploadRoadmapMedia).toHaveBeenCalledWith(3, 12, 2, file);
    expect(sections()[1].querySelector("img")!.getAttribute("src")).toBe("https://img.test/new.png");

    await click(buttonIn(sections()[1], "Remove file"));
    expect(api.clearRoadmapMedia).toHaveBeenCalledWith(3, 12, 2);
    expect(sections()[1].querySelector("img")).toBeNull();
    expect(sections()[1].textContent).toContain("Upload a file");

    api.uploadRoadmapMedia.mockRejectedValue(new Error("too big"));
    await pickFile(sections()[1].querySelector<HTMLInputElement>('input[type="file"]')!, file);
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("That file could not be uploaded.");
  });
});

describe("saving", () => {
  it("saves the settings and the sections as they stand, and says Saved.", async () => {
    const saved = roadmap({ title: "Slopes 101" });
    api.saveRoadmap.mockResolvedValue(saved);
    await render();
    await type(field("Falls back to the session's own title"), "Slopes 101");
    await type(field("Read this before you start the homework."), "Read first.");
    await type(host.querySelector<HTMLInputElement>('input[type="number"]')!, "15");
    await click(host.querySelector('input[type="checkbox"]')!);
    await type(sections()[0].querySelector<HTMLInputElement>('input[placeholder="Heading (optional)"]')!, "What a slope is");

    await click(buttonIn(host, "Save roadmap"));
    expect(api.saveRoadmap).toHaveBeenCalledWith(3, 12, {
      title: "Slopes 101",
      summary: "Read first.",
      estimated_minutes: 15,
      require_read_confirmation: false,
      sections: [{ ...TEXT, heading: "What a slope is" }, PICTURE],
    });
    expect(host.querySelector('[role="status"]')!.textContent).toBe("Saved.");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("shows a refusal in the server's words, or its own", async () => {
    api.saveRoadmap.mockRejectedValueOnce({ response: { status: 400, data: { detail: "A picture needs a file." } } });
    await render();
    await click(buttonIn(host, "Save roadmap"));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("A picture needs a file.");
    api.saveRoadmap.mockRejectedValueOnce(new Error("down"));
    await click(buttonIn(host, "Save roadmap"));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not save the roadmap.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
