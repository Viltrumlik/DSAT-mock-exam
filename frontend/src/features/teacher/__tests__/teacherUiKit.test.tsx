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

  /**
   * A clickable row is not a link, and a teacher only discovers the difference when they want
   * two classes open at once. `rowHref` is what closes that gap; these pin the three gestures
   * apart, because getting any one of them wrong silently costs the teacher their list.
   *
   * What jsdom CAN check is which handler ran and with what — not that a real browser opened a
   * tab. `window.open` is spied on rather than called.
   */
  describe("a row that has somewhere to go", () => {
    const ROWS: Row[] = [{ id: 1, name: "Math Junior 3", count: 7 }];

    function renderRows(onRowClick: (r: Row) => void) {
      render(
        <DataTable<Row>
          rows={ROWS}
          rowKey={(r) => r.id}
          columns={COLUMNS}
          onRowClick={onRowClick}
          rowHref={(r) => `/teacher/classrooms/${r.id}`}
        />,
      );
      return host.querySelector("tbody tr")!;
    }

    it("sends a plain click through the router, not the browser", () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const go = vi.fn();
      const row = renderRows(go);

      act(() => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

      expect(go).toHaveBeenCalledTimes(1);
      expect(open).not.toHaveBeenCalled();
    });

    it("holds the list still when a modifier says 'not here'", () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const go = vi.fn();
      const row = renderRows(go);

      act(() => { row.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); });

      // The router must NOT have run: that is the whole bug — a cmd-click that navigated in
      // place threw away the list the teacher was working through.
      expect(go).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith("/teacher/classrooms/1", "_blank", "noopener,noreferrer");
    });

    it("answers a middle-click, which never arrives as a click at all", () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const go = vi.fn();
      const row = renderRows(go);

      act(() => { row.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 })); });

      expect(open).toHaveBeenCalledWith("/teacher/classrooms/1", "_blank", "noopener,noreferrer");
      expect(go).not.toHaveBeenCalled();
    });

    it("without a href, leaves both gestures alone rather than guessing", () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const go = vi.fn();
      render(<DataTable<Row> rows={ROWS} rowKey={(r) => r.id} columns={COLUMNS} onRowClick={go} />);
      const row = host.querySelector("tbody tr")!;

      act(() => { row.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); });
      act(() => { row.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 })); });

      expect(open).not.toHaveBeenCalled();
      expect(go).toHaveBeenCalledTimes(1); // the modified click, handled as an ordinary one
    });
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
