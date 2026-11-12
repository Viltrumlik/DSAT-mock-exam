/**
 * The changelist (design handoff v0.3, DataDisplay board): the address holds its state (search,
 * ordering, page, page size, filters), a filter or a search starts again at page 1, ticked rows
 * bring up the bulk bar, and a failed load says so with a Retry — it never reads as an empty list.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChangeListAction, ChangeListColumn, ChangeListData, ChangeListProps } from "../ChangeList";

const replace = vi.fn();
const push = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/ops/students",
}));

const { ChangeList, pageWindow } = await import("../ChangeList");
const { toast } = await import("@/features/console/toast");

type Row = { id: number; name: string; joined: string };

const COLUMNS: ChangeListColumn<Row>[] = [
  { key: "name", label: "Name", sortKey: "name", render: (r) => r.name },
  { key: "joined", label: "Joined", sortKey: "joined", render: (r) => r.joined },
  { key: "note", label: "Note", render: () => "plain" },
];

function data(over: Partial<ChangeListData<Row>> = {}): ChangeListData<Row> {
  return {
    count: 219,
    page: 1,
    pages: 9,
    page_size: 25,
    ordering: "-joined",
    results: [
      { id: 1, name: "Aziz Tursunov", joined: "Oct 1" },
      { id: 2, name: "Malika Karimova", joined: "Oct 2" },
      { id: 3, name: "Bekzod Rahimov", joined: "Oct 3" },
    ],
    filters: [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "active", label: "Active", count: 200 },
          { value: "frozen_debt", label: "Frozen — unpaid", count: 19 },
        ],
        selected: null,
      },
    ],
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

function render(props: Partial<ChangeListProps<Row>> = {}) {
  const all: ChangeListProps<Row> = {
    title: "Students",
    noun: { singular: "student", plural: "students" },
    columns: COLUMNS,
    data: data(),
    loading: false,
    error: false,
    onRetry: vi.fn(),
    filterKeys: ["status"],
    ...props,
  };
  act(() => root.render(<ChangeList<Row> {...all} />));
  return all;
}

const text = () => host.textContent ?? "";
const buttons = (label: string) =>
  [...host.querySelectorAll("button")].filter(
    (b) => b.textContent?.trim().startsWith(label) || b.getAttribute("aria-label") === label,
  );
const link = (label: string) =>
  [...host.querySelectorAll("a")].find(
    (a) => a.getAttribute("aria-label") === label || a.textContent?.replace(/\d+$/, "").trim() === label,
  ) as HTMLAnchorElement | undefined;
const click = (el: Element | undefined) => {
  if (!el) throw new Error("element not found");
  act(() => (el as HTMLElement).click());
};
function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** The address the last router.replace went to, as params. */
function lastAddress(): { path: string; params: URLSearchParams; options: unknown } {
  const [href, options] = replace.mock.calls.at(-1) ?? [];
  const url = new URL(String(href), "http://ops.test");
  return { path: url.pathname, params: url.searchParams, options };
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  search = "";
  replace.mockReset();
  push.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("ChangeList", () => {
  it("renders the title with the total, the rows and the filter choices with counts", () => {
    render();
    expect(host.querySelector("h1")?.textContent).toBe("Students 219");
    const rows = [...host.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Aziz Tursunov");
    expect(host.querySelector('aside[aria-label="Filters"] h3')?.textContent).toBe("Status");
    const frozen = link("Frozen — unpaid");
    expect(frozen?.textContent).toContain("19");
    // Nothing chosen: "All" is the current choice.
    expect(link("All")?.getAttribute("aria-current")).toBe("true");
  });

  it("choosing a filter puts it in the address and goes back to page 1", () => {
    search = "q=ali&p=3";
    render();
    click(link("Frozen — unpaid"));
    const { path, params, options } = lastAddress();
    expect(path).toBe("/ops/students");
    expect(params.get("status")).toBe("frozen_debt");
    expect(params.get("q")).toBe("ali");
    expect(params.has("p")).toBe(false);
    expect(options).toEqual({ scroll: false });
  });

  it("marks the chosen filter, shows it as a chip, and clears all filters from the chip bar", () => {
    search = "status=frozen_debt&q=ali";
    render();
    expect(link("Frozen — unpaid")?.getAttribute("aria-current")).toBe("true");
    expect(link("All")?.getAttribute("aria-current")).toBeNull();
    expect([...host.querySelectorAll("[data-filter-chip]")].map((c) => c.textContent)).toEqual(["Status: Frozen — unpaid"]);
    click(buttons("Clear all")[0]);
    const { params } = lastAddress();
    expect(params.has("status")).toBe(false);
    expect(params.get("q")).toBe("ali");
  });

  it("sorting a column toggles `o` between ascending and descending", () => {
    render();
    const th = (label: string) =>
      [...host.querySelectorAll("th")].find((t) => t.textContent?.startsWith(label)) as HTMLTableCellElement;
    // The server's default (-joined) shows on Joined; the unsortable column has no aria-sort.
    expect(th("Joined").getAttribute("aria-sort")).toBe("descending");
    expect(th("Name").getAttribute("aria-sort")).toBe("none");
    expect(th("Note").hasAttribute("aria-sort")).toBe(false);

    click(th("Name").querySelector("button")!);
    expect(lastAddress().params.get("o")).toBe("name");

    search = "o=name&p=2";
    render({ data: data({ ordering: "name" }) });
    expect(th("Name").getAttribute("aria-sort")).toBe("ascending");
    expect(th("Name").querySelector("button")?.dataset.dir).toBe("asc");
    click(th("Name").querySelector("button")!);
    expect(lastAddress().params.get("o")).toBe("-name");
    expect(lastAddress().params.has("p")).toBe(false);
  });

  it("ticking rows brings up the bulk bar; an action runs on their ids, then the bar goes", async () => {
    const run = vi.fn<ChangeListAction["run"]>(() => Promise.resolve(true));
    const remove = vi.fn<ChangeListAction["run"]>();
    render({
      actions: [
        { key: "freeze", label: "Freeze selected students", short: "Freeze", icon: "snow", run },
        { key: "delete", label: "Delete selected students", short: "Delete…", run: remove },
      ],
    });
    const bar = () => host.parentElement!.querySelector('[role="toolbar"][aria-label="Bulk actions"]');
    expect(bar()).toBeNull();

    click(host.querySelector('input[aria-label="Select 1"]')!);
    click(host.querySelector('input[aria-label="Select 3"]')!);
    expect(bar()?.textContent).toContain("2 selected");
    // The bar shows the short word; the button's name is the whole action.
    const freeze = bar()!.querySelector<HTMLButtonElement>('button[aria-label="Freeze selected students"]')!;
    expect(freeze.textContent).toBe("Freeze");

    await act(async () => {
      freeze.click();
    });
    expect(run).toHaveBeenCalledWith([1, 3]);
    expect(remove).not.toHaveBeenCalled();
    expect(bar()).toBeNull();
  });

  it("keeps the ticks when an action is cancelled, and × clears them", async () => {
    const run = vi.fn<ChangeListAction["run"]>(() => Promise.resolve(false));
    render({ actions: [{ key: "freeze", label: "Freeze selected students", run }] });
    click(host.querySelector('input[aria-label="Select 2"]')!);
    const bar = () => host.querySelector('[role="toolbar"][aria-label="Bulk actions"]');
    await act(async () => {
      bar()!.querySelector<HTMLButtonElement>('button[aria-label="Freeze selected students"]')!.click();
    });
    expect(bar()?.textContent).toContain("1 selected");
    click(bar()!.querySelector('button[aria-label="Clear selection"]')!);
    expect(bar()).toBeNull();
  });

  it("selects every row on the page from the header checkbox, which shows some as a dash", () => {
    render({ actions: [{ key: "freeze", label: "Freeze", run: vi.fn() }] });
    const all = host.querySelector<HTMLInputElement>('input[aria-label="Select all on this page"]')!;
    click(host.querySelector('input[aria-label="Select 2"]')!);
    expect(all.indeterminate).toBe(true);
    click(all);
    expect(all.indeterminate).toBe(false);
    expect(host.querySelector('[aria-label="Bulk actions"]')?.textContent).toContain("3 selected");
  });

  it("opens a row on click, but not when its checkbox is clicked", () => {
    const onRowClick = vi.fn();
    render({ onRowClick, actions: [{ key: "freeze", label: "Freeze", run: vi.fn() }] });
    click(host.querySelectorAll("tbody tr")[1].querySelectorAll("td")[2]);
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    onRowClick.mockClear();
    click(host.querySelector('input[aria-label="Select 1"]')!);
    expect(onRowClick).not.toHaveBeenCalled();
    // The first column is a button too, so a keyboard can open the row.
    click(host.querySelectorAll("tbody tr")[0].querySelector("button")!);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("with rowHref, the first cell is a real link to the row's change form", () => {
    render({ rowHref: (r) => "/ops/students/" + r.id, actions: [{ key: "freeze", label: "Freeze", run: vi.fn() }] });
    // Cell 0 is the checkbox; the first column follows it.
    const first = host.querySelectorAll("tbody tr")[1].querySelectorAll("td")[1];
    const a = first.querySelector("a");
    expect(a?.getAttribute("href")).toMatch(/\/ops\/students\/2$/);
    expect(a?.textContent).toBe("Malika Karimova");
    // A link, so it opens in a new tab; not a button that can only navigate in place.
    expect(first.querySelector("button")).toBeNull();
  });

  it("with rowHref, a plain click elsewhere on the row goes there through the router", () => {
    render({ rowHref: (r) => "/ops/students/" + r.id, actions: [{ key: "freeze", label: "Freeze", run: vi.fn() }] });
    const row = host.querySelectorAll("tbody tr")[1];
    click(row.querySelectorAll("td")[2]);
    expect(push).toHaveBeenCalledWith("/ops/students/2");
    push.mockClear();

    // Picking the row is not opening it.
    click(host.querySelector('input[aria-label="Select 2"]')!);
    expect(push).not.toHaveBeenCalled();

    // A held modifier asks for a new tab — the link's job — never a navigation in place.
    act(() => {
      row.querySelectorAll("td")[2].dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    });
    expect(push).not.toHaveBeenCalled();

    // The link navigates by itself; its click does not reach the row and navigate a second time.
    const stopNavigation = (e: Event) => e.preventDefault();
    document.addEventListener("click", stopNavigation, true);
    try {
      click(row.querySelector("a")!);
    } finally {
      document.removeEventListener("click", stopNavigation, true);
    }
    expect(push).not.toHaveBeenCalled();
  });

  it("a failed load shows the error with Retry — never the empty state", () => {
    const onRetry = vi.fn();
    render({ data: undefined, error: true, onRetry });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn’t load students");
    expect(text()).not.toContain("No students match");
    click(buttons("Retry")[0]);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("an empty page says so, and offers to clear the filters that emptied it; loading shows skeleton rows", () => {
    render({ data: data({ count: 0, pages: 1, results: [] }) });
    expect(text()).toContain("No students match");
    expect(buttons("Clear filters")).toHaveLength(0);
    search = "status=frozen_debt";
    render({ data: data({ count: 0, pages: 1, results: [] }) });
    click(buttons("Clear filters")[0]);
    expect(lastAddress().params.has("status")).toBe(false);
    render({ data: undefined, loading: true });
    expect(host.querySelectorAll("tbody tr[data-skeleton]").length).toBeGreaterThan(0);
    expect(text()).not.toContain("No students match");
  });

  it("paginates: page links keep the search, the page size starts again at page 1", () => {
    search = "q=ali";
    render();
    const nav = host.querySelector('nav[aria-label="Pagination"]')!;
    expect(nav.textContent).toContain("…");
    expect(nav.textContent).toContain("1–25 of 219 students");
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe("1");
    expect(link("Previous page")).toBeUndefined();

    click(link("Page 2"));
    expect(lastAddress().params.get("p")).toBe("2");
    expect(lastAddress().params.get("q")).toBe("ali");

    click(link("Next page"));
    expect(lastAddress().params.get("p")).toBe("2");

    search = "q=ali&p=4";
    render({ data: data({ page: 4 }) });
    choose(host.querySelector('nav[aria-label="Pagination"] select') as HTMLSelectElement, "100");
    expect(lastAddress().params.get("ps")).toBe("100");
    expect(lastAddress().params.has("p")).toBe(false);
  });

  it("searches on Enter, and on its own 300 ms after typing stops", () => {
    vi.useFakeTimers();
    search = "p=2&status=active";
    render();
    const input = host.querySelector('input[type="search"]') as HTMLInputElement;

    typeInto(input, "mal");
    act(() => vi.advanceTimersByTime(299));
    expect(replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(lastAddress().params.get("q")).toBe("mal");
    expect(lastAddress().params.get("status")).toBe("active");
    expect(lastAddress().params.has("p")).toBe(false);

    typeInto(input, "malika ");
    act(() => {
      input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(lastAddress().params.get("q")).toBe("malika");
    const calls = replace.mock.calls.length;
    act(() => vi.advanceTimersByTime(500));
    // Enter already sent it; the debounce does not send it again.
    expect(replace.mock.calls.length).toBe(calls);
  });
});

describe("ChangeList chip bar and filter column", () => {
  it("offers the first filter's choices as quick chips, with counts", () => {
    search = "status=active";
    render();
    const quick = host.querySelector('[role="group"][aria-label="Quick filter: Status"]')!;
    const chips = [...quick.querySelectorAll("a")];
    expect(chips.map((a) => a.textContent)).toEqual(["All", "Active200", "Frozen — unpaid19"]);
    expect(chips[1].getAttribute("aria-current")).toBe("true");
    click(chips[2]);
    expect(lastAddress().params.get("status")).toBe("frozen_debt");
  });

  it("removes one filter chip at a time", () => {
    search = "status=frozen_debt&q=ali";
    render();
    click(host.querySelector('button[aria-label="Remove Status: Frozen — unpaid"]')!);
    expect(lastAddress().params.has("status")).toBe(false);
    expect(lastAddress().params.get("q")).toBe("ali");
  });

  it("names the page's own chips when it passes them, and clears exactly those", () => {
    search = "from=2026-11-01&status=active";
    render({ filterKeys: ["status", "from"], filterChips: [{ key: "from", label: "From 1 Nov 2026" }] });
    expect([...host.querySelectorAll("[data-filter-chip]")].map((c) => c.textContent)).toEqual(["From 1 Nov 2026"]);
    click(buttons("Clear all")[0]);
    expect(lastAddress().params.has("from")).toBe(false);
    expect(lastAddress().params.get("status")).toBe("active");
  });

  it("folds a long filter group behind “Show N more”, keeping the chosen choice in view", () => {
    const options = Array.from({ length: 10 }, (_, i) => ({ value: `g${i}`, label: `Group ${i}`, count: i }));
    search = "group=g9";
    render({ filterKeys: ["group"], data: data({ filters: [{ key: "group", label: "Group", options, selected: "g9" }] }) });
    const aside = host.querySelector('aside[aria-label="Filters"]')!;
    const labels = () => [...aside.querySelectorAll("a")].map((a) => a.querySelector("span")?.textContent);
    expect(labels()).toEqual(["All", "Group 0", "Group 1", "Group 2", "Group 3", "Group 4", "Group 9"]);
    // A choice with nothing in it stays, greyed.
    expect(aside.querySelector('a[href*="group=g0"]')?.className).toContain("text-ms-fg-disabled");
    click([...aside.querySelectorAll("button")].find((b) => b.textContent === "Show 4 more"));
    expect(labels()).toHaveLength(11);
  });

  it("puts the cursor in the search on “/”, but not while typing in a field", () => {
    render();
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    });
    expect(document.activeElement).toBe(input);
    const other = document.createElement("textarea");
    document.body.appendChild(other);
    other.focus();
    const typed = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    act(() => {
      other.dispatchEvent(typed);
    });
    expect(typed.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(other);
    other.remove();
  });
});

describe("ChangeList motion", () => {
  it("lights up, once, the row you come back to from its page", () => {
    window.sessionStorage.setItem("ms-flash", "/ops/students#2");
    render({ rowHref: (r) => "/ops/students/" + r.id });
    const flashing = [...host.querySelectorAll("tbody tr")].filter((tr) => tr.querySelector(".animate-ms-flash"));
    expect(flashing.map((tr) => tr.getAttribute("data-row-id"))).toEqual(["2"]);
    expect(window.sessionStorage.getItem("ms-flash")).toBeNull();
  });

  it("notes the row it opens, so coming back finds it", () => {
    render({ rowHref: (r) => "/ops/students/" + r.id });
    click(host.querySelectorAll("tbody tr")[2].querySelectorAll("td")[1]);
    expect(window.sessionStorage.getItem("ms-flash")).toBe("/ops/students#3");
    window.sessionStorage.clear();
  });

  it("clears the filters at once and offers Undo, which puts them back", () => {
    const show = vi.spyOn(toast, "show");
    search = "status=frozen_debt&q=ali";
    render();
    click(buttons("Clear all")[0]);
    expect(lastAddress().params.has("status")).toBe(false);
    const shown = show.mock.calls.at(-1)![0];
    expect(shown.message).toBe("Cleared 1 filter");
    act(() => void shown.undo!());
    expect(lastAddress().params.get("status")).toBe("frozen_debt");
    show.mockRestore();
  });
});

describe("ChangeList groups and cards", () => {
  it("draws one header before the first row of each group, in order", () => {
    render({ groupBy: (r) => (r.id < 3 ? "early" : "late"), groupLabel: (k) => `Group ${k}` });
    const headers = [...host.querySelectorAll("[data-group-header]")].map((el) => el.textContent);
    expect(headers).toEqual(["Group early", "Group late"]);
    const cells = [...host.querySelectorAll("tbody tr")].map((tr) => tr.textContent);
    expect(cells[0]).toBe("Group early");
    expect(cells[3]).toBe("Group late");
  });

  it("draws no header without groupBy", () => {
    render();
    expect(host.querySelectorAll("[data-group-header]").length).toBe(0);
  });

  it("offers a card per row for narrow screens when given mobileCard", () => {
    render({ mobileCard: (r) => <span>{`card ${r.name}`}</span> });
    expect([...host.querySelectorAll("[data-mobile-card]")].map((el) => el.textContent)).toEqual([
      "card Aziz Tursunov",
      "card Malika Karimova",
      "card Bekzod Rahimov",
    ]);
  });

  it("says it is loading, or that nothing matches, on narrow screens too", () => {
    render({ mobileCard: (r) => <span>{r.name}</span>, data: undefined, loading: true });
    expect(host.querySelector("[data-mobile-state]")?.textContent).toBe("Loading…");
    render({ mobileCard: (r) => <span>{r.name}</span>, data: data({ count: 0, results: [] }) });
    expect(host.querySelector("[data-mobile-state]")?.textContent).toBe("No students match.");
  });
});

describe("pageWindow", () => {
  it("lists every page when there are few, and the ends plus the neighbours otherwise", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(1, 9)).toEqual([1, 2, "…", 9]);
    expect(pageWindow(5, 9)).toEqual([1, "…", 4, 5, 6, "…", 9]);
    expect(pageWindow(3, 9)).toEqual([1, 2, 3, 4, "…", 9]);
    expect(pageWindow(9, 9)).toEqual([1, "…", 8, 9]);
  });
});
