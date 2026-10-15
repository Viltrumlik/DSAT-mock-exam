/**
 * The Django-style changelist: the address holds its state (search, ordering, page, page size,
 * filters), a filter or a search starts again at page 1, rows are picked for "Action: [ ] Go",
 * and a failed load says so with a Retry — it never reads as an empty list.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChangeListAction, ChangeListColumn, ChangeListData, ChangeListProps } from "../ChangeList";

const replace = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/ops/students",
}));

const { ChangeList, pageWindow } = await import("../ChangeList");

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
    expect(host.querySelector("h1")?.textContent).toBe("Students · 219");
    const rows = [...host.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Aziz Tursunov");
    expect(text()).toContain("By status");
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

  it("marks the chosen filter and clears all filters from the panel", () => {
    search = "status=frozen_debt&q=ali";
    render();
    expect(link("Frozen — unpaid")?.getAttribute("aria-current")).toBe("true");
    expect(link("All")?.getAttribute("aria-current")).toBeNull();
    click(link("Clear all filters"));
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
    expect(th("Name").textContent).toContain("▲");
    click(th("Name").querySelector("button")!);
    expect(lastAddress().params.get("o")).toBe("-name");
    expect(lastAddress().params.has("p")).toBe(false);
  });

  it("runs the chosen action on the selected rows' ids, then clears the selection", async () => {
    const run = vi.fn<ChangeListAction["run"]>(() => Promise.resolve(true));
    const remove = vi.fn<ChangeListAction["run"]>();
    render({
      actions: [
        { key: "freeze", label: "Freeze selected students", run },
        { key: "delete", label: "Delete selected students", run: remove },
      ],
    });
    expect(text()).toContain("0 of 3 selected");
    const go = buttons("Go")[0] as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    click(host.querySelector('input[aria-label="Select 1"]')!);
    click(host.querySelector('input[aria-label="Select 3"]')!);
    expect(text()).toContain("2 of 3 selected");
    choose(host.querySelector("#changelist-action") as HTMLSelectElement, "freeze");
    expect(go.disabled).toBe(false);

    await act(async () => {
      go.click();
    });
    expect(run).toHaveBeenCalledWith([1, 3]);
    expect(remove).not.toHaveBeenCalled();
    expect(text()).toContain("0 of 3 selected");
  });

  it("selects every row on the page from the header checkbox", () => {
    render({ actions: [{ key: "freeze", label: "Freeze", run: vi.fn() }] });
    click(host.querySelector('input[aria-label="Select all on this page"]')!);
    expect(text()).toContain("3 of 3 selected");
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

  it("a failed load shows the error with Retry — never the empty state", () => {
    const onRetry = vi.fn();
    render({ data: undefined, error: true, onRetry });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't load students");
    expect(text()).not.toContain("No students match");
    click(buttons("Retry")[0]);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("an empty page says so in plain text; loading shows skeleton rows", () => {
    render({ data: data({ count: 0, pages: 1, results: [] }) });
    expect(text()).toContain("No students match.");
    render({ data: undefined, loading: true });
    expect(host.querySelectorAll("tbody tr[data-skeleton]").length).toBeGreaterThan(0);
    expect(text()).not.toContain("No students match");
  });

  it("paginates: page links keep the search, the page size starts again at page 1", () => {
    search = "q=ali";
    render();
    const nav = host.querySelector('nav[aria-label="Pagination"]')!;
    expect(nav.textContent).toContain("…");
    expect(nav.textContent).toContain("219 students");
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

describe("pageWindow", () => {
  it("lists every page when there are few, and the ends plus the neighbours otherwise", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(1, 9)).toEqual([1, 2, "…", 9]);
    expect(pageWindow(5, 9)).toEqual([1, "…", 4, 5, 6, "…", 9]);
    expect(pageWindow(3, 9)).toEqual([1, 2, 3, 4, "…", 9]);
    expect(pageWindow(9, 9)).toEqual([1, "…", 8, 9]);
  });
});
