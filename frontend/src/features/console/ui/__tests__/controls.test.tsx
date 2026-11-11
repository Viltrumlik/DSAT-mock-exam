/**
 * The Controls board's parts (PR 9a): a field whose error is read with its input, money grouped as you
 * type, a select and a combobox you can drive with the keyboard, a Monday-first month, a 24-hour time,
 * choices that are real radios / switches / a radiogroup, tabs kept in the address, avatars that keep the
 * Uzbek oʻ and gʻ, and keys shown for the platform.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/ops/students/12",
  useSearchParams: () => new URLSearchParams(search),
}));

const ui = await import("..");
const {
  Avatar,
  Combobox,
  DateField,
  Field,
  MoneyInput,
  RadioGroup,
  Segmented,
  Select,
  Switch,
  Tabs,
  TextInput,
  addMonthsIso,
  calendarDays,
  caretAfterDigits,
  filterOptions,
  formatDay,
  groupDigits,
  initialsOf,
  isMacLike,
  nextEnabled,
  normalizeTime,
  periodRange,
  toneOf,
  typeAhead,
  useTabParam,
} = ui;

let host: HTMLDivElement;
let root: Root;
const render = (node: React.ReactNode) => act(() => root.render(node));
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
const click = (el: Element) => act(() => void (el as HTMLElement).click());
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  replace.mockReset();
  search = "";
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const LEVELS = [
  { value: "foundation", label: "Foundation" },
  { value: "junior", label: "Junior" },
  { value: "middle", label: "Middle" },
  { value: "senior", label: "Senior", disabledReason: "No senior classes this term" },
  { value: "none", label: "No level" },
];

describe("Field", () => {
  it("puts the label on the input and reads the error with it, the error replacing the help", () => {
    render(
      <Field label="Phone" help="9 digits after +998." error="Enter 9 digits after +998 — 2 are missing.">
        <TextInput prefix="+998" defaultValue="90 153 85" />
      </Field>,
    );
    const input = host.querySelector("input")!;
    const label = host.querySelector("label")!;
    expect(label.htmlFor).toBe(input.id);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const said = document.getElementById(input.getAttribute("aria-describedby")!)!;
    expect(said.textContent).toBe("Enter 9 digits after +998 — 2 are missing.");
    expect(host.textContent).not.toContain("9 digits after +998.");
    expect(host.textContent).toContain("+998");
  });

  it("says (optional) and shows a counter beside the help", () => {
    render(
      <Field label="SMS text" optional help="Use {STUDENT}, {AMOUNT}, {DATE}." counter="118 / 160 · 1 SMS each">
        <TextInput defaultValue="x" />
      </Field>,
    );
    expect(host.querySelector("label")!.textContent).toBe("SMS text (optional)");
    expect(host.textContent).toContain("118 / 160 · 1 SMS each");
  });
});

describe("money", () => {
  it("groups digits as the console writes money", () => {
    expect(groupDigits("1250000")).toBe("1 250 000");
    expect(groupDigits("0012a5")).toBe("125");
    expect(groupDigits("")).toBe("");
  });

  it("keeps the caret after the same digit once regrouped", () => {
    // "1 250 000": after the 4th digit ("1250|000") the caret sits after "1 250".
    expect(caretAfterDigits("1 250 000", 4)).toBe(5);
    expect(caretAfterDigits("1 250 000", 0)).toBe(0);
    expect(caretAfterDigits("125", 9)).toBe(3);
  });

  it("hands back a whole number, and null when emptied", () => {
    const seen: (number | null)[] = [];
    function Box() {
      const [v, setV] = useState<number | null>(1250000);
      return <MoneyInput value={v} onChange={(n) => (seen.push(n), setV(n))} aria-label="Amount" />;
    }
    render(<Box />);
    const input = host.querySelector("input")!;
    expect(input.value).toBe("1 250 000");
    expect(host.textContent).toContain("so'm");
    type(input, "1 250 0007");
    expect(seen.at(-1)).toBe(12500007);
    expect(input.value).toBe("12 500 007");
    type(input, "");
    expect(seen.at(-1)).toBeNull();
  });
});

describe("Select", () => {
  it("skips a disabled option, jumps by typing, picks with Enter and gives focus back", () => {
    const picked: string[] = [];
    render(<Select aria-label="Level" value="middle" options={LEVELS} onChange={(v) => picked.push(v)} />);
    const button = host.querySelector("button")!;
    expect(button.textContent).toContain("Middle");
    key(button, "ArrowDown");
    const list = host.querySelector('[role="listbox"]')!;
    expect(list).toBeTruthy();
    const active = () => document.getElementById(list.getAttribute("aria-activedescendant")!)!.textContent;
    expect(active()).toContain("Middle");
    key(list, "ArrowDown"); // Senior is disabled → No level
    expect(active()).toContain("No level");
    key(list, "f");
    expect(active()).toContain("Foundation");
    key(list, "Enter");
    expect(picked).toEqual(["foundation"]);
    expect(document.activeElement).toBe(button);
  });

  it("finds the next enabled option and type-ahead matches", () => {
    expect(nextEnabled(LEVELS, 2, 1)).toBe(4);
    expect(nextEnabled(LEVELS, 4, 1)).toBe(0);
    expect(typeAhead(LEVELS, 0, "ju")).toBe(1);
    expect(typeAhead(LEVELS, 0, "se")).toBe(-1); // Senior can't be picked
  });
});

describe("Combobox", () => {
  const CLASSES = [
    { value: "m3", label: "Middle M3 · English · Kamola", sub: "Tue Thu Sat 16:00 · 14 seats" },
    { value: "m7", label: "Middle M7 · Math", sub: "No teacher yet", meta: "Run by lc-up" },
    { value: "m5", label: "Middle M5 · Math · Muxlisa", disabledReason: "Add seats in lc-up — this class is synced" },
    { value: "j6", label: "Junior J6 · Math" },
  ];

  it("narrows as you type (accents and case aside), and says when nothing matches, offering Create", () => {
    expect(filterOptions(CLASSES, "MID").map((o) => o.value)).toEqual(["m3", "m7", "m5"]);
    expect(filterOptions(CLASSES, "lc-up").map((o) => o.value)).toEqual(["m7"]);
    const created: string[] = [];
    render(<Combobox aria-label="Add to class" noun="class" options={CLASSES} value={null} onChange={() => {}} onCreate={(t) => created.push(t)} />);
    const input = host.querySelector("input")!;
    act(() => input.focus());
    type(input, "xyz");
    expect(host.textContent).toContain("No class matches “xyz”.");
    key(input, "Enter");
    expect(created).toEqual(["xyz"]);
  });

  it("picks several as chips, skips the disabled one, and Backspace drops the last chip", () => {
    function Box() {
      const [v, setV] = useState<string[]>(["j6"]);
      return (
        <Combobox
          multiple
          aria-label="Send to"
          noun="class"
          options={CLASSES}
          value={v}
          onChange={setV}
          summary={(p) => `${p.length} classes`}
        />
      );
    }
    render(<Box />);
    const input = host.querySelector("input")!;
    act(() => input.focus());
    type(input, "middle");
    key(input, "ArrowDown"); // m3 → m7
    key(input, "ArrowDown"); // m5 is disabled → back to m3
    key(input, "Enter");
    expect(host.textContent).toContain("Middle M3 · English · Kamola");
    expect(host.textContent).toContain("2 classes");
    key(input, "Backspace");
    expect(host.textContent).not.toContain("2 classes");
    expect(host.querySelector('[aria-label="Remove Junior J6 · Math"]')).toBeTruthy();
  });
});

describe("Date and time", () => {
  it("draws November 2026 Monday first, whole weeks only", () => {
    const days = calendarDays(2026, 10);
    expect(days[0]).toMatchObject({ iso: "2026-10-26", inMonth: false });
    expect(days[6]).toMatchObject({ iso: "2026-11-01", inMonth: true });
    expect(days.length).toBe(42); // 1 Nov is a Sunday and 30 Nov a Monday: six weeks
    expect(calendarDays(2027, 1).length).toBe(28); // Feb 2027 starts on a Monday
  });

  it("moves months without losing the day's end, and writes days as people read them", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-12-15", 1)).toBe("2027-01-15");
    expect(formatDay("2026-11-12")).toBe("12 Nov 2026");
  });

  it("reads 24-hour times and refuses what is not one", () => {
    expect(normalizeTime("1600")).toBe("16:00");
    expect(normalizeTime("9:5")).toBe("09:05");
    expect(normalizeTime("7")).toBe("07:00");
    expect(normalizeTime("24:00")).toBeNull();
    expect(normalizeTime("16:75")).toBeNull();
  });

  it("knows the periods, ending today", () => {
    expect(periodRange("7d", "2026-11-11")).toEqual({ from: "2026-11-05", to: "2026-11-11" });
    expect(periodRange("month", "2026-11-11")).toEqual({ from: "2026-11-01", to: "2026-11-11" });
  });

  it("opens on the chosen day, arrows move it, a click picks", () => {
    const picked: string[] = [];
    render(<DateField aria-label="Lesson date" value="2026-11-12" today="2026-11-11" onChange={(d) => picked.push(d)} />);
    const button = host.querySelector("button")!;
    expect(button.textContent).toContain("12 Nov 2026");
    click(button);
    const grid = host.querySelector('[role="grid"]')!;
    expect(grid.getAttribute("aria-label")).toBe("November 2026");
    expect(host.querySelector('[aria-current="date"]')!.getAttribute("data-day")).toBe("2026-11-11");
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-11-12");
    key(document.activeElement!, "ArrowDown");
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-11-19");
    expect(host.textContent).toContain("Asia/Tashkent");
    click(document.activeElement!);
    expect(picked).toEqual(["2026-11-19"]);
  });
});

describe("Choice", () => {
  it("radios are real, and a disabled one says why", () => {
    const picked: string[] = [];
    render(
      <RadioGroup
        legend="Status"
        value="trial"
        onChange={(v) => picked.push(v)}
        options={[
          { value: "trial", label: "Trial", description: "No money yet" },
          { value: "active", label: "Active", description: "Pays from the date" },
          { value: "left", label: "Left", disabledReason: "Only lc-up can mark a student as left" },
        ]}
      />,
    );
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.checked)).toEqual([true, false, false]);
    expect(radios[2].disabled).toBe(true);
    expect(host.textContent).toContain("Only lc-up can mark a student as left");
    click(radios[1]);
    expect(picked).toEqual(["active"]);
  });

  it("a switch is a switch, and off-limits says why", () => {
    const seen: boolean[] = [];
    render(
      <>
        <Switch label="Debt warning SMS" help="Sends on the 5th to everyone who owes." checked={false} onChange={(v) => seen.push(v)} />
        <Switch label="lc-up sync" disabledReason="Super admin only" checked onChange={() => {}} />
      </>,
    );
    const [one, two] = [...host.querySelectorAll('[role="switch"]')] as HTMLButtonElement[];
    expect(one.getAttribute("aria-checked")).toBe("false");
    click(one);
    expect(seen).toEqual([true]);
    expect(two.disabled).toBe(true);
    expect(document.getElementById(two.getAttribute("aria-describedby")!)!.textContent).toBe("Super admin only");
  });

  it("segmented is a radiogroup moved with the arrows", () => {
    function Box() {
      const [v, setV] = useState<"light" | "dark" | "system">("light");
      return <Segmented label="Theme" value={v} onChange={setV} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />;
    }
    render(<Box />);
    const group = host.querySelector('[role="radiogroup"]')!;
    key(group, "ArrowRight");
    const on = host.querySelector('[role="radio"][aria-checked="true"]')!;
    expect(on.textContent).toBe("Dark");
    expect((on as HTMLElement).tabIndex).toBe(0);
  });
});

describe("Tabs", () => {
  const TABS = [
    { id: "overview" as const, label: "Overview" },
    { id: "groups" as const, label: "Groups", count: 3 },
    { id: "payments" as const, label: "Payments", count: 2, tone: "critical" as const },
    { id: "security" as const, label: "Security", disabled: true },
    { id: "history" as const, label: "History" },
  ];

  it("keeps the tab in the address, and the arrows skip a disabled tab", () => {
    search = "tab=payments&q=bek";
    function Box() {
      const [tab, setTab] = useTabParam(TABS.map((t) => t.id), "overview");
      return <Tabs label="Student sections" tabs={TABS} value={tab} onChange={setTab} />;
    }
    render(<Box />);
    const selected = host.querySelector('[role="tab"][aria-selected="true"]')!;
    expect(selected.textContent).toBe("Payments2");
    key(selected, "ArrowRight");
    expect(replace).toHaveBeenLastCalledWith("/ops/students/12?tab=history&q=bek", { scroll: false });
    key(selected, "Home");
    // Back to the first tab: the address drops ?tab= (it is the default).
    expect(replace).toHaveBeenLastCalledWith("/ops/students/12?q=bek", { scroll: false });
  });

  it("falls back on an unknown ?tab=", () => {
    search = "tab=nope";
    function Box() {
      const [tab] = useTabParam(TABS.map((t) => t.id), "overview");
      return <span>{tab}</span>;
    }
    render(<Box />);
    expect(host.textContent).toBe("overview");
  });
});

describe("Avatar and keys", () => {
  it("takes first + last name initials, keeping oʻ and gʻ whole", () => {
    expect(initialsOf("Bekzod Jo'rayev")).toBe("BJ");
    expect(initialsOf("Oʻtkir Gʻaniyev")).toBe("OʻGʻ");
    expect(initialsOf("o'tkir g‘aniyev")).toBe("OʻGʻ");
    expect(initialsOf("Gulnoza Abdurahmonova-Mirzayeva Shavkatovna")).toBe("GS");
    expect(initialsOf("Kamola")).toBe("K");
    expect(initialsOf("  ")).toBe("?");
  });

  it("colours by the name, steadily, whatever the case", () => {
    expect(toneOf("Bekzod Jo'rayev")).toBe(toneOf("  bekzod jo'rayev "));
    expect([1, 2, 3, 4, 5, 6]).toContain(toneOf("Laylo Saidova"));
  });

  it("names a frozen learner as frozen", () => {
    render(<Avatar name="Bekzod Jo'rayev" frozen />);
    expect(host.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Bekzod Jo'rayev (frozen)");
  });

  it("knows a Mac", () => {
    expect(isMacLike("MacIntel")).toBe(true);
    expect(isMacLike("iPhone")).toBe(true);
    expect(isMacLike("Win32")).toBe(false);
    expect(isMacLike("", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true);
  });
});
