/**
 * Finance › Debtors (Debtors and PhoneDebtors boards, owner 22 Nov 2026): every student who owes — those in no group
 * too — the biggest debt first, balances as signed numbers in a tinted cell, the student's own phone and a parent's,
 * the filters and status chips, the freeze exemption behind the row's ⋮, and a failed read that must not look like
 * "nobody owes".
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ me: null as unknown }));

vi.mock("@/hooks/useMe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMe")>()),
  useMe: () => ({ me: state.me }),
}));

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const { ACCOUNTANT_ME, ADMIN_ME } = await import("@/features/ops/testing/me");
const { DebtorsPanel, SmsDebtorsLink, passes } = await import("../DebtorsPanel");

const MINUS = "−";
const URL = "/lcup/finance/debtors/";

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.me = ADMIN_ME;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  post.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function flush() {
  for (let tick = 0; tick < 5; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(ui: ReactElement, body: unknown) {
  get.mockImplementation(async (url: string) => {
    if (url !== URL) throw new Error(`unexpected GET ${url}`);
    if (body instanceof Error) throw body;
    return { data: body };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  await flush();
}

function byText(selector: string, text: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.trim() === text);
  if (!found) throw new Error(`no ${selector} "${text}" in: ${document.body.textContent}`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await flush();
}

async function choose(label: string, value: string) {
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

async function type(label: string, text: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

const tableRows = () => [...host.querySelectorAll("table tbody tr")];
const tableText = () => tableRows().map((tr) => tr.textContent ?? "");

function debtor(overrides: object) {
  return {
    link_id: 1,
    lcup_student_id: 101,
    name: "Aziz Tursunov",
    user: { id: 9, name: "Aziz Tursunov", username: "aziz", section: "students" },
    phone: "+998901112233",
    parent_phone: "+998907778899",
    groups: ["Junior G21 | Math | Vali"],
    group_rows: [{ name: "Junior G21 | Math | Vali", level: "junior", classroom_id: 21 }],
    teachers: ["Vali Karimov"],
    in_group: true,
    debt: 600_000,
    last_payment_on: "2026-09-04",
    frozen: false,
    exempt: false,
    ...overrides,
  };
}

const MALIKA = debtor({
  link_id: 2,
  lcup_student_id: 102,
  name: "Malika Saidova",
  user: null,
  phone: "+998935550011",
  parent_phone: "",
  groups: [],
  group_rows: [],
  teachers: [],
  in_group: false,
  debt: 400_000,
  last_payment_on: null,
});
const BOBUR = debtor({
  link_id: 3,
  lcup_student_id: 103,
  name: "Bobur Aliev",
  user: { id: 10, name: "Bobur Aliev", username: "bobur", section: "public" },
  phone: "+998944440000",
  parent_phone: "",
  groups: ["Senior G5 | English"],
  group_rows: [{ name: "Senior G5 | English", level: "senior", classroom_id: null }],
  teachers: ["Dilnoza Rahimova"],
  debt: 300_000,
  frozen: true,
});
const AZIZ = debtor({ debt: 900_000 });

describe("the debtors list", () => {
  it("lists every student who owes, those in no group too, the biggest debt first", async () => {
    // The server's order is not trusted: the table sorts by the debt itself.
    await mount(<DebtorsPanel />, [MALIKA, BOBUR, AZIZ]);
    const rows = tableText();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Aziz Tursunov");
    expect(rows[1]).toContain("Malika Saidova");
    expect(rows[2]).toContain("Bobur Aliev");
    expect(rows[0].startsWith("1")).toBe(true);
    expect(host.textContent).toContain("Total: 1 600 000 so’m · 3 students");
  });

  it("counts students, and how many of them are in no group", async () => {
    await mount(<DebtorsPanel />, [AZIZ, MALIKA, BOBUR]);
    const glance = host.querySelector('section[aria-label="Debt at a glance"]')!.textContent ?? "";
    expect(glance).toContain("Students who owe3");
    expect(glance).toContain("1 of them in no group");
    expect(glance).toMatch(/Owed in total1 600 000\s*so’m/);
    expect(glance).toContain("Frozen for debt1");
  });

  it("shows a balance as a signed number in a critical cell, with no words beside it", async () => {
    await mount(<DebtorsPanel />, [AZIZ]);
    expect(byText("th", "Balance, so’m")).toBeTruthy();
    const cell = byText("td", `${MINUS}900 000`);
    expect(cell.getAttribute("data-verdict")).toBe("critical");
    expect(tableText()[0]).not.toMatch(/Owes|Paid|In debt|Ahead/);
  });

  it("links the student, gives the parent's phone under the name and the student's own beside it", async () => {
    await mount(<DebtorsPanel />, [AZIZ, BOBUR]);
    const name = byText("table a", "Aziz Tursunov");
    expect(name.getAttribute("href")).toBe("/ops/students/9");
    // A learner who became public lives under /ops/public.
    expect(byText("table a", "Bobur Aliev").getAttribute("href")).toBe("/ops/public/10");
    expect(tableText()[0]).toContain("Parent +998 90 777 88 99");
    expect(tableText()[0]).toContain("+998 90 111 22 33");
    const call = host.querySelector<HTMLAnchorElement>('table a[aria-label="Call Aziz Tursunov"]');
    expect(call?.getAttribute("href")).toBe("tel:+998901112233");
  });

  it("draws a group as a course tag that opens the class, and a student in no group as such", async () => {
    await mount(<DebtorsPanel />, [AZIZ, MALIKA]);
    const tag = host.querySelector<HTMLElement>('table [data-course="junior"]');
    expect(tag?.textContent).toBe("Junior G21 | Math | Vali");
    expect(tag?.closest("a")?.getAttribute("href")).toBe("/ops/classrooms/21");
    expect(tableText()[1]).toContain("No group");
    expect(tableText()[1]).toContain("No account");
  });

  it("draws a card per student on a phone", async () => {
    await mount(<DebtorsPanel />, [AZIZ, MALIKA]);
    const cards = [...host.querySelectorAll('ul[aria-label="Students who owe"] > li')];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain(`${MINUS}900 000`);
    expect(cards[1].textContent).toContain("No group");
  });
});

describe("filters", () => {
  it("narrows by name, phone, group and teacher, and clears", async () => {
    await mount(<DebtorsPanel />, [AZIZ, MALIKA, BOBUR]);
    await type("Name", "malika");
    expect(tableText()).toHaveLength(1);
    expect(tableText()[0]).toContain("Malika Saidova");

    await click(byText("button", "Clear filters"));
    await type("Phone", "90 777 88");
    expect(tableText().map((r) => r.includes("Aziz Tursunov"))).toEqual([true]);

    await click(byText("button", "Clear filters"));
    await choose("Group", "Senior G5 | English");
    expect(tableText()).toHaveLength(1);
    expect(host.textContent).toContain("Total: 300 000 so’m · 1 student");

    await click(byText("button", "Clear filters"));
    await choose("Teacher", "Vali Karimov");
    expect(tableText()[0]).toContain("Aziz Tursunov");
    expect(tableText()).toHaveLength(1);
  });

  it("counts each status chip against the other filters, and filters by it", async () => {
    await mount(<DebtorsPanel />, [AZIZ, MALIKA, BOBUR]);
    const chip = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Status"] button')].find((b) => b.textContent?.startsWith(label))!;
    expect(chip("All").textContent).toBe("All 3");
    expect(chip("No group").textContent).toBe("No group 1");
    expect(chip("Frozen for debt").textContent).toBe("Frozen for debt 1");

    await click(chip("No group"));
    expect(chip("No group").getAttribute("aria-pressed")).toBe("true");
    expect(tableText().map((r) => r.includes("Malika Saidova"))).toEqual([true]);

    // Another filter changes what the chips count.
    await click(chip("No group"));
    await choose("Teacher", "Vali Karimov");
    expect(chip("All").textContent).toBe("All 1");
    expect(chip("No group").textContent).toBe("No group 0");
  });

  it("says so when nothing matches, apart from nobody owing", async () => {
    await mount(<DebtorsPanel />, [AZIZ]);
    await type("Name", "nobody like this");
    expect(host.textContent).toContain("No debtor matches these filters");
    expect(host.textContent).not.toContain("Nobody owes money");
  });

  it("matches a phone by its digits, whatever the spaces", () => {
    const f = { name: "", phone: "935 550", group: "", teacher: "", status: "" as const };
    expect(passes(MALIKA as never, f)).toBe(true);
    expect(passes(AZIZ as never, f)).toBe(false);
  });
});

describe("pages", () => {
  it("pages a long list, 150 a page unless asked otherwise", async () => {
    const many = Array.from({ length: 160 }, (_, i) => debtor({ link_id: 100 + i, lcup_student_id: 1000 + i, name: `Student ${i}`, debt: 1000 + i }));
    await mount(<DebtorsPanel />, many);
    expect(tableRows()).toHaveLength(150);
    expect(host.querySelector('nav[aria-label="Pagination"]')?.textContent).toContain("1–150 of 160");
    const size = host.querySelector<HTMLSelectElement>('nav[aria-label="Pagination"] select')!;
    await act(async () => {
      size.value = "50";
      size.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(tableRows()).toHaveLength(50);
  });
});

describe("the row's ⋮ and the freeze", () => {
  it("asks first, then exempts the student from the freeze", async () => {
    post.mockResolvedValue({ data: { link_id: 3, exempt: true } });
    await mount(<DebtorsPanel />, [BOBUR]);
    expect(tableText()[0]).toContain("Frozen");

    await click(host.querySelector<HTMLButtonElement>('table button[aria-label="More for Bobur Aliev"]')!);
    await click(byText('[role="menuitem"]', "Exempt from freeze"));
    expect(post).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("They are frozen now and will be unfrozen right away.");

    await click(byText("button", "Yes, exempt"));
    expect(post).toHaveBeenCalledWith("/lcup/finance/exempt/3/", { exempt: true });
  });

  it("removes an exemption", async () => {
    post.mockResolvedValue({ data: { link_id: 1, exempt: false } });
    await mount(<DebtorsPanel />, [debtor({ exempt: true })]);
    expect(tableText()[0]).toContain("Exempt");
    await click(host.querySelector<HTMLButtonElement>('table button[aria-label="More for Aziz Tursunov"]')!);
    await click(byText('[role="menuitem"]', "Remove exemption"));
    expect(post).toHaveBeenCalledWith("/lcup/finance/exempt/1/", { exempt: false });
  });

  it("offers an SMS to the student through the composer", async () => {
    await mount(<DebtorsPanel />, [AZIZ]);
    await click(host.querySelector<HTMLButtonElement>('table button[aria-label="More for Aziz Tursunov"]')!);
    expect(byText('[role="menuitem"]', "SMS…").getAttribute("href")).toBe("/ops/sms/campaigns/new?student=9");
  });

  it("offers only what the viewer may do: no SMS without send_sms", async () => {
    state.me = { ...ACCOUNTANT_ME, permissions: ACCOUNTANT_ME.permissions.filter((p) => p !== "debt_freeze") };
    await mount(<DebtorsPanel />, [AZIZ]);
    await click(host.querySelector<HTMLButtonElement>('table button[aria-label="More for Aziz Tursunov"]')!);
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
    expect(items).toEqual(["Open student page"]);
  });
});

describe("SMS this list", () => {
  it("opens the composer on every debtor, for whoever may send", async () => {
    await mount(<SmsDebtorsLink />, []);
    expect(byText("a", "SMS this list").getAttribute("href")).toBe("/ops/sms/campaigns/new?audience=debtors");
  });

  it("is not offered to someone the composer would refuse", async () => {
    state.me = ACCOUNTANT_ME;
    await mount(<SmsDebtorsLink />, []);
    expect(host.textContent).not.toContain("SMS this list");
  });
});

describe("states", () => {
  it("shows an error with Retry, not the empty state, when the list does not load", async () => {
    await mount(<DebtorsPanel />, new Error("boom"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load the debtors.");
    expect(host.textContent).toContain("Retry");
    expect(host.textContent).not.toContain("Nobody owes money");
  });

  it("is calm when nobody owes anything", async () => {
    await mount(<DebtorsPanel />, []);
    expect(host.textContent).toContain("Nobody owes money");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
