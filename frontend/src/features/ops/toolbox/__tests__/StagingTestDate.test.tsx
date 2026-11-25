/** The test copy's banner names the test date once the clock script has moved the browser (+N days). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { StagingTestDate } from "@/components/StagingTestDate";

type ClockWindow = Window & { __STG_OFFSET_DAYS__?: number };

function rendered(): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<StagingTestDate />));
  const text = host.textContent ?? "";
  act(() => root.unmount());
  return text;
}

afterEach(() => {
  delete (window as ClockWindow).__STG_OFFSET_DAYS__;
  vi.useRealTimers();
});

describe("StagingTestDate", () => {
  it("says the test date and the offset when the clock is moved", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T10:00:00+05:00"));
    (window as ClockWindow).__STG_OFFSET_DAYS__ = 2;
    expect(rendered()).toBe(" · Test date: 27 Nov 2026 (+2 days)");
    (window as ClockWindow).__STG_OFFSET_DAYS__ = 1;
    expect(rendered()).toBe(" · Test date: 27 Nov 2026 (+1 day)");
  });

  it("says nothing when the clock is not moved", () => {
    expect(rendered()).toBe("");
    (window as ClockWindow).__STG_OFFSET_DAYS__ = 0;
    expect(rendered()).toBe("");
  });
});
