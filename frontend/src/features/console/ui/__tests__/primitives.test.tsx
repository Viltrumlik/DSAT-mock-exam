/**
 * The console's controls (design handoff v0.3, Controls + DataDisplay boards): what each promises
 * the list pages — a square icon button, a verdict that is a word, a checkbox that is a real one,
 * chips that name and drop a filter, pages that count, a bulk bar that counts and clears, and an
 * error that never looks empty.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Badge, BulkBar, Button, Checkbox, EmptyState, ErrorState, FilterChip, Pagination, buttonClass } from "..";

let host: HTMLDivElement;
let root: Root;
const render = (node: React.ReactNode) => act(() => root.render(node));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Button", () => {
  it("is a plain button unless told otherwise, square when it has only an icon", () => {
    render(
      <>
        <Button icon="plus">Add student</Button>
        <Button size="sm" icon="more" aria-label="Actions" />
      </>,
    );
    const [words, square] = [...host.querySelectorAll("button")];
    expect(words.type).toBe("button");
    expect(words.className).toContain("px-[18px]");
    expect(square.className).toContain("size-9");
    expect(square.className).not.toContain("px-3");
    expect(square.getAttribute("aria-label")).toBe("Actions");
  });

  it("dresses a link the same way", () => {
    expect(buttonClass({ variant: "primary" })).toContain("bg-ms-primary");
    expect(buttonClass()).toContain("bg-ms-surface-2");
  });
});

describe("Badge", () => {
  it("always carries its word, with an icon or a dot beside it", () => {
    render(
      <>
        <Badge tone="frozen" icon="snow">Frozen for debt</Badge>
        <Badge tone="positive" dot>Active</Badge>
      </>,
    );
    const [frozen, active] = [...host.querySelectorAll(":scope > span")];
    expect(frozen.textContent).toBe("Frozen for debt");
    expect(frozen.className).toContain("bg-ms-frozen-soft");
    expect(frozen.querySelector("svg")).not.toBeNull();
    expect(active.querySelector("span.rounded-full")).not.toBeNull();
  });
});

describe("Checkbox", () => {
  it("is a real checkbox with a name, and says “some” as indeterminate", () => {
    const onChange = vi.fn();
    render(<Checkbox label="Select all on this page" checked={false} indeterminate onChange={onChange} />);
    const input = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(input.getAttribute("aria-label")).toBe("Select all on this page");
    expect(input.indeterminate).toBe(true);
    act(() => input.click());
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("FilterChip", () => {
  it("names the filter with its value in bold, and drops it with its own ×", () => {
    const onRemove = vi.fn();
    render(<FilterChip label="Branch: Chilonzor" onRemove={onRemove} />);
    const chip = host.querySelector("[data-filter-chip]")!;
    expect(chip.textContent).toBe("Branch: Chilonzor");
    expect(chip.querySelector("b")?.textContent).toBe("Chilonzor");
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Remove Branch: Chilonzor"]')!.click());
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe("Pagination", () => {
  const props = {
    pages: 9,
    count: 219,
    pageSize: 25,
    pageSizes: [25, 50, 100],
    noun: { singular: "student", plural: "students" },
    hrefFor: (p: number) => `/ops/students?p=${p}`,
    onPageSize: vi.fn(),
  };

  it("says which rows are shown and of how many", () => {
    render(<Pagination {...props} page={2} onPage={vi.fn()} />);
    expect(host.textContent).toContain("26–50 of 219 students");
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe("2");
  });

  it("cannot step before the first page, and steps by a real link otherwise", () => {
    const onPage = vi.fn();
    render(<Pagination {...props} page={1} onPage={onPage} />);
    const prev = host.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')!;
    expect(prev.tagName).toBe("BUTTON");
    expect(prev.disabled).toBe(true);
    const next = host.querySelector<HTMLAnchorElement>('a[aria-label="Next page"]')!;
    expect(next.getAttribute("href")).toBe("/ops/students?p=2");
    act(() => next.click());
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe("BulkBar", () => {
  it("counts the ticked rows and clears them", () => {
    const onClear = vi.fn();
    render(
      <BulkBar count={2} onClear={onClear}>
        <button type="button">Freeze</button>
      </BulkBar>,
    );
    const bar = host.querySelector('[role="toolbar"][aria-label="Bulk actions"]')!;
    expect(bar.textContent).toContain("2 selected");
    act(() => bar.querySelector<HTMLButtonElement>('button[aria-label="Clear selection"]')!.click());
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("states", () => {
  it("an error names what failed and offers Retry; it is never an empty state", () => {
    const onRetry = vi.fn();
    render(<ErrorState what="students" onRetry={onRetry} />);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t load students. This is not zero.");
    act(() => host.querySelector("button")!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("an empty state says why and offers the next step", () => {
    render(<EmptyState title="No students match" detail="Try another search." action={<button type="button">Clear filters</button>} />);
    expect(host.textContent).toContain("No students match");
    expect(host.textContent).toContain("Clear filters");
  });
});
