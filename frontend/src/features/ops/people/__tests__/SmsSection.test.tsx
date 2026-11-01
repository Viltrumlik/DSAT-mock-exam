import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { message } from "@/features/ops/sms/__tests__/fixtures";

/** A student's page, SMS tab (plan 2026-11-01-sms-v2, Task 10): every SMS they were sent, newest first. */

const studentSms = vi.fn();
vi.mock("@/features/ops/sms/smsHooks", () => ({ useStudentSms: (id: number) => studentSms(id) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { SmsSection } = await import("@/features/ops/people/sections/SmsSection");

let host: HTMLDivElement;
let root: Root;
const text = () => host.textContent ?? "";

async function render(state: Record<string, unknown>) {
  studentSms.mockReturnValue({ isPending: false, isError: false, refetch: vi.fn(), ...state });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<SmsSection id={5} />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("SmsSection", () => {
  it("asks for this student's SMS and lists them with how each went", async () => {
    await render({
      data: {
        summary: { DELIVERED: 1, UNDELIVERED: 1 },
        results: [
          message({ id: 8, status: "UNDELIVERED", eskiz_status: "REJECTED", source: { type: "debt_warning", id: null, label: "Debt warning" } }),
          message({ id: 7 }),
        ],
      },
    });
    expect(studentSms).toHaveBeenCalledWith(5);
    expect(text()).toContain("1 delivered");
    expect(text()).toContain("1 not delivered");
    expect(text()).toContain("Operator rejected");
    expect(text()).toContain("Debt warning");
    expect(text()).toContain("MASTER SAT'dan yozyabmiz");
  });

  it("says so when no SMS was ever sent", async () => {
    await render({ data: { summary: {}, results: [] } });
    expect(text()).toContain("No SMS sent to this student yet.");
  });

  it("tells a non-admin it is for admins, not that the load failed", async () => {
    await render({ isError: true, data: undefined, error: { response: { status: 403 } } });
    expect(text()).toContain("Only admins can see SMS.");
  });
});
