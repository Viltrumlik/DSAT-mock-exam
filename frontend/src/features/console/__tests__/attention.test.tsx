/**
 * "Needs you" — the bell and the dashboards share these rows. A count of 0 shows nothing; a source
 * that failed says so with Retry and is never read as "nothing to do"; the bell counts KINDS.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionBell } from "../AttentionBell";
import {
  attentionCount,
  debtItem,
  noTeacherCount,
  smsItem,
  tashkentMonth,
  trialsItem,
  type AttentionSource,
} from "../attention";

const page = (count: number, filters: { key: string; options: { value: string; label: string; count: number }[] }[]) => ({ count, filters });

describe("the items", () => {
  it("counts undelivered, rejected and failed SMS today, and says nothing when none", () => {
    const o = (by_status: Record<string, number>, short = false) =>
      ({ today: { total: 9, by_status }, eskiz: { last_error: "" }, forecast: { short, total: 5000 }, balance: 1000 }) as never;
    expect(smsItem(o({ UNDELIVERED: 20, REJECTED: 1, FAILED: 1, DELIVERED: 9 }))?.title).toBe("22 SMS did not arrive today");
    expect(smsItem(o({ DELIVERED: 9 }))).toBeNull();
    expect(smsItem(o({ DELIVERED: 9 }, true))?.title).toBe("SMS balance runs short in the next 24 hours");
  });

  it("puts debt in so'm with the frozen and exempt", () => {
    const item = debtItem({ debtors: 13, total_debt: 9450000, frozen: 3, exempt: 1 } as never)!;
    expect(item.title).toBe("13 students owe 9 450 000 so'm");
    expect(item.detail).toBe("3 frozen for debt · 1 exempt");
    expect(debtItem({ debtors: 0, total_debt: 0, frozen: 0, exempt: 0 } as never)).toBeNull();
  });

  it("reads trials waiting from lc-up's pending count", () => {
    expect(trialsItem({ pending: 16, trials: [], not_on_list: new Array(9) } as never)?.title).toBe("16 trial students to call back");
    expect(trialsItem({ pending: 0, trials: [], not_on_list: [] } as never)).toBeNull();
  });

  it("finds classes with no teacher from the teacher facet", () => {
    const p = page(14, [{ key: "teacher", options: [{ value: "1", label: "A", count: 8 }, { value: "2", label: "B", count: 5 }] }]);
    expect(noTeacherCount(p)).toBe(1);
    expect(noTeacherCount(page(3, []))).toBe(0);
  });

  it("knows the month by the learning center's clock", () => {
    // 2026-11-30 21:00 UTC is already 1 December in Tashkent (UTC+5).
    expect(tashkentMonth(new Date("2026-11-30T21:00:00Z"))).toBe("2026-12");
  });
});

const src = (id: string, status: AttentionSource["status"], title?: string, retry = vi.fn()): AttentionSource => ({
  id,
  label: id,
  status,
  retry,
  item: title ? { id, icon: "warn", tone: "attention", title, action: { label: "Open", href: `/ops/${id}` } } : null,
});

let host: HTMLDivElement;
let root: Root;
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

describe("AttentionBell", () => {
  it("counts kinds of problem, and lists them", () => {
    const sources = [src("sms", "done", "22 SMS did not arrive today"), src("debt", "done", "13 students owe"), src("lcup", "done")];
    expect(attentionCount(sources)).toBe(2);
    act(() => root.render(<AttentionBell sources={sources} />));
    const bell = host.querySelector("button")!;
    expect(bell.getAttribute("aria-label")).toBe("2 things need you");
    act(() => bell.click());
    expect(host.textContent).toContain("22 SMS did not arrive today");
    expect(host.textContent).not.toContain("Nothing needs you");
  });

  it("says a failed source failed, offers Retry, and does not call it 'nothing'", () => {
    const retry = vi.fn();
    act(() => root.render(<AttentionBell sources={[src("sms", "error", undefined, retry)]} />));
    act(() => host.querySelector("button")!.click());
    expect(host.textContent).toContain("Couldn’t check sms.");
    expect(host.textContent).not.toContain("Nothing needs you");
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry")!.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("says nothing needs you only when every source answered empty", () => {
    act(() => root.render(<AttentionBell sources={[src("sms", "done"), src("debt", "done")]} />));
    act(() => host.querySelector("button")!.click());
    expect(host.textContent).toContain("Nothing needs you right now.");
  });

  it("is not drawn for someone with no sources", () => {
    act(() => root.render(<AttentionBell sources={[]} />));
    expect(host.innerHTML).toBe("");
  });
});
