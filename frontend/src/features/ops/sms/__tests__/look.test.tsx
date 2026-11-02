import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { reasonOf } from "@/features/ops/sms/format";
import { OperatorDot, StatTile, StatusPill } from "@/features/ops/sms/look";
import { useCountUp, usePrefersReducedMotion } from "@/features/ops/sms/motion";
import { message } from "./fixtures";

/**
 * The SMS panel's status words, counters and colours (plan 2026-11-01-sms-v2, Task 7). A status is
 * said in plain words — what an admin would tell a parent — never only eskiz's code.
 */

describe("reasonOf", () => {
  const at = { checked_at: "2026-10-20T10:02:00+05:00", attempts: 1, error: "", eskiz_status: "" };
  it.each([
    [{ status: "DELIVERED" }, "Delivered 10:02"],
    [{ status: "DELIVERED", checked_at: null }, "Delivered"],
    [{ status: "UNDELIVERED", eskiz_status: "REJECTED" }, "Operator rejected"],
    [{ status: "UNDELIVERED", eskiz_status: "REJECTD" }, "Operator rejected"],
    [{ status: "UNDELIVERED", eskiz_status: "EXPIRED" }, "Phone off or out of reach"],
    [{ status: "UNDELIVERED", eskiz_status: "UNDELIV" }, "Not delivered"],
    [{ status: "REJECTED", error: "HTTP 400: forbidden words: shavkat" }, "Forbidden word"],
    [{ status: "REJECTED", error: "perfectum: Not allowed" }, "eskiz refused"],
    [{ status: "FAILED" }, "eskiz not reached"],
    [{ status: "FAILED", error: "HTTP 400: Please, fill the balance" }, "No balance on eskiz"],
    [{ status: "FAILED", error: "HTTP 400: Please, fill the balance", attempts: 2 }, "No balance on eskiz · try 2"],
    [{ status: "UNCERTAIN" }, "Unknown — may have gone"],
    [{ status: "SENT" }, "Waiting for the operator"],
    [{ status: "PENDING" }, "Waiting for the operator"],
    [{ status: "UNDELIVERED", eskiz_status: "REJECTED", attempts: 2 }, "Operator rejected · try 2"],
  ] as const)("%o → %s", (over, text) => {
    expect(reasonOf({ ...at, ...over } as Parameters<typeof reasonOf>[0])).toBe(text);
  });
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(node: React.ReactNode) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const r = createRoot(el);
  container = el;
  root = r;
  await act(async () => r.render(node));
  return el;
}

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

function Counter({ to }: { to: number }) {
  return <span>{useCountUp(to)}</span>;
}

function Motion() {
  return <span>{usePrefersReducedMotion() ? "still" : "moving"}</span>;
}

describe("motion", () => {
  it("holds still where the browser cannot say (jsdom has no matchMedia)", async () => {
    expect((await render(<Motion />)).textContent).toBe("still");
  });

  it("shows the number at once when motion is off", async () => {
    expect((await render(<Counter to={1234} />)).textContent).toBe("1234");
  });
});

describe("look", () => {
  it("a status pill says the reason in words", async () => {
    const el = await render(<StatusPill message={message({ status: "UNDELIVERED", eskiz_status: "REJECTED", attempts: 2 })} />);
    expect(el.textContent).toBe("Operator rejected · try 2");
    expect(el.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("undelivered");
  });

  it("a stat tile shows its label, figure and hint", async () => {
    const el = await render(<StatTile label="Balance" value={63460} format={(n) => `${n} so'm`} hint="≈ 373 SMS" />);
    expect(el.textContent).toContain("Balance");
    expect(el.textContent).toContain("63460 so'm");
    expect(el.textContent).toContain("≈ 373 SMS");
  });

  it("an operator dot is named for screen readers", async () => {
    const el = await render(<OperatorDot operator="Uzmobile" />);
    expect(el.querySelector("[aria-label='Uzmobile']")).not.toBeNull();
  });
});
