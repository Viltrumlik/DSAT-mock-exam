/**
 * The teacher kit's load-bearing states.
 *
 * The one that matters most is the pair: `ErrorState` and `EmptyState` must never be mistaken
 * for one another. This product has drawn a failed request as "there is nothing here" more than
 * once, which teaches a teacher that their class is empty when the server merely said no — so
 * the error carries an alert role and a retry, and the empty state carries neither.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, DataTable, EmptyState, ErrorState, Pill, Stat, type Column } from "../ui";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

const text = () => host.textContent ?? "";

describe("ErrorState and EmptyState are not the same thing", () => {
  it("an error announces itself and offers the way back", () => {
    const retry = vi.fn();
    render(<ErrorState title="Today's lessons didn't load" detail="Your classes are unchanged." onRetry={retry} />);

    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(text()).toContain("Today's lessons didn't load");
    expect(text()).toContain("Your classes are unchanged.");

    const button = host.querySelector("button");
    expect(button?.textContent).toContain("Try again");
    act(() => { button!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("an empty state announces nothing and offers no retry", () => {
    render(<EmptyState title="No lesson today" hint="Your next lesson is Tuesday." />);

    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("button")).toBeNull();
    expect(text()).toContain("No lesson today");
  });
});

describe("DataTable", () => {
  type Row = { id: number; name: string; count: number };
  const COLUMNS: Column<Row>[] = [
    { key: "name", header: "Class", render: (r) => r.name },
    { key: "count", header: "Waiting", align: "right", render: (r) => r.count },
  ];

  it("renders a row per item, under the headers it was given", () => {
    render(
      <DataTable<Row>
        rows={[{ id: 1, name: "Math Junior 3", count: 7 }, { id: 2, name: "Reading Senior 1", count: 2 }]}
        rowKey={(r) => r.id}
        columns={COLUMNS}
      />,
    );

    expect(host.querySelectorAll("thead th")).toHaveLength(2);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(text()).toContain("Math Junior 3");
    expect(text()).toContain("Reading Senior 1");
  });

  it("with nothing in it, shows the empty case INSTEAD of a headed table with no body", () => {
    render(
      <DataTable<Row>
        rows={[]}
        rowKey={(r) => r.id}
        columns={COLUMNS}
        empty={<EmptyState title="Nothing waiting" />}
      />,
    );

    expect(host.querySelector("table")).toBeNull();
    expect(text()).toContain("Nothing waiting");
  });
});

describe("the small pieces", () => {
  it("a figure that is absent reads as a dash, never as zero", () => {
    render(<div><Stat label="Waiting" value={null} /><Stat label="Turned in" value={0} /></div>);
    expect(text()).toContain("—");
    expect(text()).toContain("0");
  });

  it("a busy button cannot be pressed twice", () => {
    const onClick = vi.fn();
    render(<Button busy onClick={onClick}>Save</Button>);
    const button = host.querySelector("button")!;
    expect(button.disabled).toBe(true);
    act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("a pill says its state in words, not only in colour", () => {
    render(<Pill tone="warning">3 not turned in</Pill>);
    expect(text()).toContain("3 not turned in");
  });
});
