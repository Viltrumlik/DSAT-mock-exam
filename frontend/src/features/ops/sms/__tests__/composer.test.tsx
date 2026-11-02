import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { toLocalInput } from "@/lib/datetimeLocal";
import type { AudienceKind } from "../smsApi";
import { EVENT_TEMPLATE, REJECTED_TEMPLATE, template } from "./fixtures";

/** The composer's parts, one by one. */

const studentsQuery = vi.fn();

const CLASSES = [
  { id: 61, name: "Junior G21 | Math", students: 14, with_phone: 12 },
  { id: 62, name: "Senior S1 | English", students: 9, with_phone: 9 },
  { id: 63, name: "Middle M2 | Math", students: 11, with_phone: 10 },
];

vi.mock("@/features/ops/sms/smsHooks", () => ({
  STUDENT_SEARCH_MIN: 2,
  useSmsTemplates: () => ({
    data: {
      templates: [template({ alias: "Debt reminder", label: "Debt reminder", used_count: 3 }), EVENT_TEMPLATE, REJECTED_TEMPLATE],
      synced_at: null,
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAudienceClassrooms: () => ({ data: CLASSES, isPending: false, isError: false, refetch: vi.fn() }),
  useAudienceOptions: () => ({
    data: {
      subjects: [{ value: "MATH", label: "Math", classes: 2 }, { value: "ENGLISH", label: "English", classes: 1 }],
      levels: [{ value: "junior", label: "Junior", classes: 1 }],
      branches: [{ value: 3, label: "Chilonzor", classes: 2 }],
      days: [{ value: "ODD", label: "Odd days", classes: 2 }],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAudienceStudents: (q: string) => studentsQuery(q),
}));

const { AudienceStep, audienceBody } = await import("@/features/ops/sms/composer/AudienceStep");
const { MessageStep, rolesFor } = await import("@/features/ops/sms/composer/MessageStep");
const { PhonePreview } = await import("@/features/ops/sms/composer/PhonePreview");
const { RecipientsDrawer } = await import("@/features/ops/sms/composer/RecipientsDrawer");
const { WhenStep, whenLabel, whenProblem } = await import("@/features/ops/sms/composer/WhenStep");
const { EMPTY_FILTER } = await import("@/features/ops/sms/composer/useComposerDraft");

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const buttons = () => Array.from(document.body.querySelectorAll("button"));
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label);
const radios = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
const click = async (el: HTMLElement) => act(async () => el.click());
const control = (label: string) =>
  Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim().startsWith(label))?.control as
    | HTMLInputElement
    | HTMLSelectElement;

async function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function render(element: ReactElement) {
  await act(async () => root.render(element));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  studentsQuery.mockReset().mockReturnValue({ data: undefined, isPending: false, isError: false, isFetching: false });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const KINDS: AudienceKind[] = ["student", "group", "filter", "debtors"];
const value = (over = {}) => ({ audience: "group" as AudienceKind, ids: [], filter: EMPTY_FILTER, excluded: [], ...over });

describe("AudienceStep", () => {
  it("offers only the kinds it is allowed", async () => {
    await render(<AudienceStep value={value()} onChange={vi.fn()} allowed={["group", "debtors"]} />);
    expect(radios().map((r) => r.textContent?.trim())).toEqual(["Groups", "Debtors"]);
  });

  it("picks many groups, finds them by name and selects what it shows", async () => {
    const onChange = vi.fn();
    await render(<AudienceStep value={value({ ids: [61] })} onChange={onChange} allowed={KINDS} />);
    await click(control("Senior S1"));
    expect(onChange.mock.calls.at(-1)![0].ids).toEqual([61, 62]);
    await setValue(control("Find a class"), "math");
    expect(text()).not.toContain("Senior S1");
    await click(button("Select all shown")!);
    expect(onChange.mock.calls.at(-1)![0].ids).toEqual([61, 63]);
    await click(button("Clear")!);
    expect(onChange.mock.calls.at(-1)![0].ids).toEqual([]);
  });

  it("stops at 50 groups", async () => {
    const onChange = vi.fn();
    const full = Array.from({ length: 50 }, (_, i) => 1000 + i);
    await render(<AudienceStep value={value({ ids: full })} onChange={onChange} allowed={KINDS} />);
    expect((control("Senior S1") as HTMLInputElement).disabled).toBe(true);
    expect(text()).toContain("At most 50 classes");
    await click(button("Select all shown")!);
    expect(onChange.mock.calls.at(-1)?.[0].ids.length ?? 50).toBe(50);
  });

  it("toggles several values of a filter", async () => {
    const onChange = vi.fn();
    await render(
      <AudienceStep
        value={value({ audience: "filter", filter: { ...EMPTY_FILTER, subjects: ["MATH"] } })}
        onChange={onChange}
        allowed={KINDS}
      />,
    );
    const chip = (label: string) => buttons().find((b) => b.textContent?.startsWith(label))!;
    expect(chip("Math").getAttribute("aria-pressed")).toBe("true");
    await click(chip("English"));
    expect(onChange.mock.calls.at(-1)![0].filter.subjects).toEqual(["MATH", "ENGLISH"]);
    await click(chip("Chilonzor"));
    expect(onChange.mock.calls.at(-1)![0].filter.branches).toEqual([3]);
    await click(chip("Math"));
    expect(onChange.mock.calls.at(-1)![0].filter.subjects).toEqual([]);
  });

  it("clears the picks and the people taken out when the kind changes", async () => {
    const onChange = vi.fn();
    await render(<AudienceStep value={value({ ids: [61], excluded: [5] })} onChange={onChange} allowed={KINDS} />);
    await click(radios().find((r) => r.textContent?.trim() === "Debtors")!);
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ audience: "debtors", ids: [], excluded: [] });
  });

  it("names a picked student from what the composer knows", async () => {
    await render(
      <AudienceStep value={value({ audience: "student", ids: [5, 9] })} onChange={vi.fn()} allowed={KINDS} names={{ 5: "Malika Karimova" }} />,
    );
    expect(text()).toContain("Malika Karimova");
    expect(text()).toContain("Student #9");
  });

  it("finds a student and adds them", async () => {
    const onChange = vi.fn();
    studentsQuery.mockReturnValue({
      data: [{ id: 7, name: "Aziza Karimova", lcup_name: "Karimova Aziza", phone: "998901112233", balance: 0 }],
      isPending: false,
      isError: false,
      isFetching: false,
    });
    await render(<AudienceStep value={value({ audience: "student" })} onChange={onChange} allowed={KINDS} />);
    await setValue(control("Find a student"), "aziza");
    await click(buttons().find((b) => b.getAttribute("aria-label") === "Add Aziza Karimova")!);
    expect(onChange.mock.calls.at(-1)![0].ids).toEqual([7]);
  });
});

describe("audienceBody", () => {
  it("is nothing until the audience is whole", () => {
    expect(audienceBody(value())).toBeNull();
    expect(audienceBody(value({ audience: "student" }))).toBeNull();
    expect(audienceBody(value({ audience: "filter" }))).toBeNull();
  });

  it("carries only what the kind needs", () => {
    expect(audienceBody(value({ audience: "debtors", ids: [1] }))).toEqual({ audience: "debtors", audience_ids: [], excluded_user_ids: [] });
    expect(audienceBody(value({ ids: [61], excluded: [5] }))).toEqual({ audience: "group", audience_ids: [61], excluded_user_ids: [5] });
    const filter = { ...EMPTY_FILTER, days: ["ODD"] };
    expect(audienceBody(value({ audience: "filter", filter }))).toEqual({
      audience: "filter", audience_ids: [], audience_filter: filter, excluded_user_ids: [],
    });
  });
});

describe("MessageStep", () => {
  const props = { templateId: null, roles: [], texts: [], roleChoices: rolesFor };

  it("lists only usable templates under their names, with how often they went out", async () => {
    await render(<MessageStep {...props} onChange={vi.fn()} />);
    expect(text()).toContain("Debt reminder");
    expect(text()).toContain("Used 3 times");
    expect(text()).toContain("#70001");
    expect(text()).not.toContain("#50000");
  });

  it("finds a template by its name or its words", async () => {
    await render(<MessageStep {...props} onChange={vi.fn()} />);
    await setValue(control("Find a template"), "ertaga");
    expect(text()).not.toContain("Debt reminder");
    expect(text()).toContain("#70001");
  });

  it("starts from the server's guess, with a number slot never holding a name", async () => {
    const onChange = vi.fn();
    await render(<MessageStep {...props} onChange={onChange} />);
    await click(buttons().find((b) => b.textContent?.includes("#70001"))!);
    expect(onChange).toHaveBeenCalledWith({ templateId: 70001, roles: ["text", "text"], texts: ["", ""] });
    expect(rolesFor({ kind: "d", min: 1, max: 1 })).toEqual(["debt", "text"]);
  });

  it("fills a text slot and changes a role", async () => {
    const onChange = vi.fn();
    await render(<MessageStep templateId={70001} roles={["text", "text"]} texts={["", ""]} roleChoices={rolesFor} onChange={onChange} />);
    await setValue(control("Text for slot 1"), "Mock");
    expect(onChange.mock.calls.at(-1)![0].texts).toEqual(["Mock", ""]);
    await setValue(control("Slot 2"), "debt");
    expect(onChange.mock.calls.at(-1)![0].roles).toEqual(["text", "debt"]);
  });

  it("says when the template can no longer be used", async () => {
    await render(<MessageStep templateId={50000} roles={["text"]} texts={[""]} roleChoices={rolesFor} onChange={vi.fn()} />);
    expect(text()).toContain("can no longer be used");
  });
});

describe("WhenStep", () => {
  const now = new Date("2026-11-03T08:00:00+05:00");
  const at = (iso: string) => ({ mode: "at" as const, at: toLocalInput(iso) });

  it("warns at 22:00 and not at 10:00", async () => {
    await render(<WhenStep value={at("2026-11-03T22:00:00+05:00")} onChange={vi.fn()} now={now} />);
    expect(text()).toContain("Students get this at night.");
    await render(<WhenStep value={at("2026-11-03T10:00:00+05:00")} onChange={vi.fn()} now={now} />);
    expect(text()).not.toContain("Students get this at night.");
  });

  it("counts 21:00 to 09:00 as the night", async () => {
    for (const [hour, night] of [["20:59", false], ["21:00", true], ["08:59", true], ["09:00", false]] as const) {
      await render(<WhenStep value={at(`2026-11-04T${hour}:00+05:00`)} onChange={vi.fn()} now={now} />);
      expect(text().includes("at night"), hour).toBe(night);
    }
  });

  it("warns for Now, too, when it is night now", async () => {
    await render(<WhenStep value={{ mode: "now", at: "" }} onChange={vi.fn()} now={new Date("2026-11-03T23:00:00+05:00")} />);
    expect(text()).toContain("Students get this at night.");
  });

  it("offers Today 10:00 only before 10:00", async () => {
    const onChange = vi.fn();
    await render(<WhenStep value={{ mode: "now", at: "" }} onChange={onChange} now={now} />);
    await click(button("Today 10:00")!);
    expect(onChange).toHaveBeenCalledWith(at("2026-11-03T10:00:00+05:00"));
    await click(button("Tomorrow 10:00")!);
    expect(onChange).toHaveBeenLastCalledWith(at("2026-11-04T10:00:00+05:00"));
    await render(<WhenStep value={{ mode: "now", at: "" }} onChange={onChange} now={new Date("2026-11-03T10:30:00+05:00")} />);
    expect(button("Today 10:00")).toBeUndefined();
    expect(button("Tomorrow 10:00")).toBeDefined();
  });

  it("cannot pick the past", async () => {
    await render(<WhenStep value={{ mode: "at", at: "" }} onChange={vi.fn()} now={now} />);
    expect((control("Goes out at") as HTMLInputElement).min).toBe(toLocalInput(now.toISOString()));
    expect(whenProblem(at("2026-11-03T07:00:00+05:00"), now)).toContain("passed");
    expect(whenProblem({ mode: "at", at: "" }, now)).toContain("Pick when");
    expect(whenProblem(at("2026-11-03T09:00:00+05:00"), now)).toBeNull();
    expect(whenProblem({ mode: "now", at: "" }, now)).toBeNull();
  });

  it("reads back as a short label", () => {
    expect(whenLabel({ mode: "now", at: "" }, now)).toBe("Now");
    expect(whenLabel(at("2026-11-03T10:00:00+05:00"), now)).toBe("Today 10:00");
    expect(whenLabel(at("2026-11-04T10:00:00+05:00"), now)).toBe("Tomorrow 10:00");
    expect(whenLabel(at("2026-11-09T15:30:00+05:00"), now)).toBe("9 Nov, 15:30");
    expect(whenLabel({ mode: "at", at: "" }, now)).toBe("Pick a time");
  });
});

describe("PhonePreview", () => {
  it("shows the text and its parts", async () => {
    await render(<PhonePreview text="Salom" parts={2} ascii />);
    expect(text()).toContain("Salom");
    expect(text()).toContain("2 SMS parts");
    expect(text()).not.toContain("70 characters");
  });

  it("says why a text with non-Latin letters costs more", async () => {
    await render(<PhonePreview text="Salomʻ" parts={1} ascii={false} />);
    expect(text()).toContain("70 characters");
  });

  it("waits for a message", async () => {
    await render(<PhonePreview text="" parts={0} ascii />);
    expect(text()).toContain("Pick a message");
  });
});

describe("RecipientsDrawer", () => {
  const recipients = [
    { user_id: 5, name: "Malika Karimova", phone: "99890***4567", groups: ["Junior G21 | Math", "Senior S1 | English"] },
    { user_id: 9, name: "Bekzod Aliyev", phone: "99893***0000", groups: [] },
  ];
  const base = { open: true, onClose: vi.fn(), recipients, taken: [] };

  it("lists who gets it, masked, with their classes", async () => {
    await render(<RecipientsDrawer {...base} excluded={[]} onChange={vi.fn()} />);
    expect(text()).toContain("Malika Karimova");
    expect(text()).toContain("99890***4567");
    expect(text()).toContain("Junior G21 | Math, Senior S1 | English");
  });

  it("removing a person adds them to excluded", async () => {
    const onChange = vi.fn();
    await render(<RecipientsDrawer {...base} excluded={[1]} onChange={onChange} />);
    await click(buttons().find((b) => b.getAttribute("aria-label") === "Remove Bekzod Aliyev")!);
    expect(onChange).toHaveBeenCalledWith([1, 9]);
  });

  it("hides a removed person at once and can put them back", async () => {
    const onChange = vi.fn();
    await render(<RecipientsDrawer {...base} excluded={[9]} onChange={onChange} />);
    expect(buttons().some((b) => b.getAttribute("aria-label") === "Remove Bekzod Aliyev")).toBe(false);
    expect(text()).toContain("Taken out · 1");
    await click(buttons().find((b) => b.getAttribute("aria-label") === "Put back Bekzod Aliyev")!);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("names people taken out in an earlier preview", async () => {
    await render(<RecipientsDrawer {...base} taken={[{ user_id: 11, name: "Sardor Rasulov" }]} excluded={[11]} onChange={vi.fn()} />);
    expect(text()).toContain("Sardor Rasulov");
  });

  it("finds a person by name", async () => {
    await render(<RecipientsDrawer {...base} excluded={[]} onChange={vi.fn()} />);
    await setValue(control("Find a person"), "bek");
    expect(text()).not.toContain("Malika Karimova");
    expect(text()).toContain("Bekzod Aliyev");
  });
});
