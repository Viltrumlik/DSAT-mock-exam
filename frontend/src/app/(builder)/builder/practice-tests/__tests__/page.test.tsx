/**
 * /builder/practice-tests: the library of the centre's single-section practice tests. A card
 * carries the permanent number, subtitle, subject, level and access; its module links open the
 * SAME question editor the past papers use; publish / edit / delete are the past-paper builder's.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminPastpaperSection } from "@/lib/api";

const getStandaloneSections = vi.fn();
const createSection = vi.fn();
const updateSection = vi.fn();
const deleteSection = vi.fn();
const publishSection = vi.fn();
const unpublishSection = vi.fn();

vi.mock("@/features/examsAdmin/api", () => ({
  examsAdminApi: {
    getStandaloneSections: (...a: unknown[]) => getStandaloneSections(...a),
    createSection: (...a: unknown[]) => createSection(...a),
    updateSection: (...a: unknown[]) => updateSection(...a),
    deleteSection: (...a: unknown[]) => deleteSection(...a),
    publishSection: (...a: unknown[]) => publishSection(...a),
    unpublishSection: (...a: unknown[]) => unpublishSection(...a),
  },
}));

const { default: PracticeTestsPage } = await import("../page");

function section(over: Partial<AdminPastpaperSection> = {}): AdminPastpaperSection {
  return {
    id: 7,
    title: "Algebra focus",
    subject: "MATH",
    is_practice_test: true,
    practice_number: 2,
    practice_access: "open",
    practice_level: "middle",
    is_published: true,
    label: "",
    form_type: "INTERNATIONAL",
    collection_name: "",
    practice_date: null,
    modules: [
      { id: 70, module_order: 1 },
      { id: 71, module_order: 2 },
    ],
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderPage() {
  act(() => root.render(<PracticeTestsPage />));
  await settle();
}

const buttonByText = (text: string, scope: ParentNode = host) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

async function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
  await settle();
}

/** React tracks the value itself, so a controlled input is set through the native setter. */
function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

const radio = (labelStart: string) =>
  [...host.querySelectorAll("label")]
    .find((l) => l.textContent?.trim().startsWith(labelStart))
    ?.querySelector("input[type=radio]") as HTMLInputElement;

const cardTitles = () => [...host.querySelectorAll("h3")].map((h) => h.textContent);

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const fn of [getStandaloneSections, createSection, updateSection, deleteSection, publishSection, unpublishSection]) {
    fn.mockReset();
  }
  getStandaloneSections.mockResolvedValue([section()]);
  createSection.mockResolvedValue(section());
  updateSection.mockResolvedValue(section());
  deleteSection.mockResolvedValue(undefined);
  publishSection.mockResolvedValue(section());
  unpublishSection.mockResolvedValue(section());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("/builder/practice-tests", () => {
  it("lists the practice tests: number, subtitle, level, access, and a link per module into the editor", async () => {
    await renderPage();

    expect(getStandaloneSections).toHaveBeenCalledWith("practice_test");
    expect(host.querySelector("h1")?.textContent).toBe("Practice tests");
    expect(host.textContent).toContain("Practice Test 2");
    expect(host.textContent).toContain("Algebra focus");
    const badges = [...host.querySelectorAll("span")].map((s) => s.textContent?.trim());
    expect(badges).toContain("Open");
    expect(badges).toContain("Middle");

    const hrefs = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/builder/practice-tests/7/70");
    expect(hrefs).toContain("/builder/practice-tests/7/71");
    expect(hrefs.some((h) => h?.includes("/builder/pastpapers"))).toBe(false);
  });

  it("says Homework only and All levels for a test a teacher sets for every level", async () => {
    getStandaloneSections.mockResolvedValue([section({ practice_access: "homework_only", practice_level: "" })]);
    await renderPage();
    const badges = [...host.querySelectorAll("span")].map((s) => s.textContent?.trim());
    expect(badges).toContain("Homework only");
    expect(badges).toContain("All levels");
  });

  it("puts unnumbered drafts first, then the highest number, then Reading & Writing before Math", async () => {
    getStandaloneSections.mockResolvedValue([
      section({ id: 1, practice_number: 1, title: "one" }),
      section({ id: 3, practice_number: 3, title: "three" }),
      section({ id: 9, practice_number: null, is_published: false, title: "fresh draft" }),
      section({ id: 4, practice_number: 3, subject: "READING_WRITING", title: "three rw" }),
    ]);
    await renderPage();
    expect(cardTitles()).toEqual([
      "Draft — numbered when published",
      "Practice Test 3",
      "Practice Test 3",
      "Practice Test 1",
    ]);
    const subtitles = [...host.querySelectorAll("[data-subtitle]")].map((p) => p.textContent);
    expect(subtitles).toEqual(["fresh draft", "three rw", "three", "one"]);
  });

  it("filters by subject and by status", async () => {
    getStandaloneSections.mockResolvedValue([
      section({ id: 1, practice_number: 1, subject: "MATH", title: "math live" }),
      section({ id: 2, practice_number: 2, subject: "READING_WRITING", title: "rw live" }),
      section({ id: 3, practice_number: null, subject: "READING_WRITING", is_published: false, title: "rw draft" }),
    ]);
    await renderPage();
    expect(cardTitles()).toHaveLength(3);

    await click(buttonByText("Math"));
    expect([...host.querySelectorAll("[data-subtitle]")].map((p) => p.textContent)).toEqual(["math live"]);

    await click(buttonByText("All", host.querySelector("[data-filter=subject]")!));
    await click(buttonByText("Draft", host.querySelector("[data-filter=status]")!));
    expect([...host.querySelectorAll("[data-subtitle]")].map((p) => p.textContent)).toEqual(["rw draft"]);
  });

  it("publishes a draft, and lists what the server says is missing when it refuses", async () => {
    getStandaloneSections.mockResolvedValue([section({ practice_number: null, is_published: false })]);
    publishSection.mockRejectedValue({
      response: {
        status: 400,
        data: { violations: [{ code: "module_count", message: "Module 1 needs 22 questions; it has 5." }] },
      },
    });
    await renderPage();

    await click(buttonByText("Publish"));

    expect(publishSection).toHaveBeenCalledWith(7);
    expect(host.textContent).toContain("Can't publish yet");
    expect(host.textContent).toContain("Module 1 needs 22 questions; it has 5.");
  });

  it("unpublishes a published test", async () => {
    await renderPage();
    await click(buttonByText("Unpublish"));
    expect(unpublishSection).toHaveBeenCalledWith(7);
    expect(publishSection).not.toHaveBeenCalled();
  });

  it("asks before deleting, then deletes", async () => {
    await renderPage();
    await click(buttonByText("Delete"));
    expect(deleteSection).not.toHaveBeenCalled();
    await click(buttonByText("Confirm"));
    expect(deleteSection).toHaveBeenCalledWith(7);
  });

  it("shows the server's reason when a test with attempts cannot be deleted", async () => {
    deleteSection.mockRejectedValue({
      response: { status: 400, data: { detail: "3 students have taken this test; unpublish it instead." } },
    });
    await renderPage();
    await click(buttonByText("Delete"));
    await click(buttonByText("Confirm"));
    expect(host.textContent).toContain("3 students have taken this test; unpublish it instead.");
  });

  it("creates a practice test with its access and level", async () => {
    getStandaloneSections.mockResolvedValue([]);
    await renderPage();
    expect(host.textContent).toContain("No practice tests yet");

    await click(buttonByText("New practice test", host.querySelector("[data-header]")!));
    expect(host.textContent).toContain("New practice test");
    await click(radio("Math"));
    type(host.querySelector("input[name=title]") as HTMLInputElement, "Algebra focus");
    await click(radio("Homework only"));
    type(host.querySelector("select[name=practice_level]") as HTMLSelectElement, "middle");
    await click(buttonByText("Save"));

    expect(createSection).toHaveBeenCalledWith({
      subject: "MATH",
      title: "Algebra focus",
      is_practice_test: true,
      practice_access: "homework_only",
      practice_level: "middle",
    });
  });

  it("offers each level, and All levels sends a blank", async () => {
    getStandaloneSections.mockResolvedValue([]);
    await renderPage();
    await click(buttonByText("New practice test", host.querySelector("[data-header]")!));
    const select = host.querySelector("select[name=practice_level]") as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ["", "All levels"],
      ["foundation", "Foundation"],
      ["junior", "Junior"],
      ["middle", "Middle"],
      ["senior", "Senior"],
    ]);
    await click(buttonByText("Save"));
    expect(createSection).toHaveBeenCalledWith(expect.objectContaining({ practice_level: "" }));
  });

  it("edits the subtitle, access and level, and never sends the subject or the kind", async () => {
    await renderPage();
    await click(buttonByText("Edit"));
    expect(host.textContent).toContain("Edit practice test");
    const title = host.querySelector("input[name=title]") as HTMLInputElement;
    expect(title.value).toBe("Algebra focus");
    expect(radio("Math").disabled).toBe(true);
    expect(radio("Open").checked).toBe(true);
    expect((host.querySelector("select[name=practice_level]") as HTMLSelectElement).value).toBe("middle");

    type(title, "Algebra, harder");
    await click(radio("Homework only"));
    type(host.querySelector("select[name=practice_level]") as HTMLSelectElement, "senior");
    await click(buttonByText("Save"));

    expect(updateSection).toHaveBeenCalledWith(7, {
      title: "Algebra, harder",
      practice_access: "homework_only",
      practice_level: "senior",
    });
    expect(createSection).not.toHaveBeenCalled();
  });

  it("clears the subtitle with an empty string, which the server keeps as blank", async () => {
    await renderPage();
    await click(buttonByText("Edit"));
    type(host.querySelector("input[name=title]") as HTMLInputElement, "   ");
    await click(buttonByText("Save"));
    expect(updateSection).toHaveBeenCalledWith(7, expect.objectContaining({ title: "" }));
  });

  it("starts a new test as Homework only, like the server's default", async () => {
    getStandaloneSections.mockResolvedValue([]);
    await renderPage();
    await click(buttonByText("New practice test", host.querySelector("[data-header]")!));
    expect(radio("Homework only").checked).toBe(true);
    expect(radio("Open").checked).toBe(false);
    expect(radio("Reading & Writing").checked).toBe(true);
  });

  it("shows the server's message when a save is refused", async () => {
    updateSection.mockRejectedValue({ response: { status: 400, data: { practice_level: ["Pick a valid level."] } } });
    await renderPage();
    await click(buttonByText("Edit"));
    await click(buttonByText("Save"));
    expect(host.textContent).toContain("Pick a valid level.");
  });
});
