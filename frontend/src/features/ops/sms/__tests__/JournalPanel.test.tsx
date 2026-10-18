import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { SmsMessage, SmsMessagePage } from "../smsApi";

/**
 * The journal: every SMS as a changelist on `messages/`. Its state lives in the address next to
 * `?tab=journal`, a filter click keeps the tab, and a row opens the whole message.
 */

let search = "";
const replace = vi.fn();
const messages = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/ops/sms",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSmsMessages: (params: unknown) => messages(params),
}));

const { JournalPanel } = await import("@/features/ops/sms/JournalPanel");

function message(over: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 3,
    created_at: "2026-10-18T10:00:00+05:00",
    sent_at: "2026-10-18T10:00:02+05:00",
    kind: "campaign",
    status: "DELIVERED",
    eskiz_status: "DELIVRD",
    phone: "998901234567",
    text: "MASTER SAT'dan yozyabmiz. Karimova Malika, sizda qarzdorlik mavjud. To'lovni amalga oshirish uchun zudlik bilan administratsiyaga uchrang!",
    parts: 1,
    request_id: "5f1c2a9e-uuid",
    error: "",
    user: { id: 5, name: "Malika Karimova" },
    lcup_student_id: 101,
    campaign_id: 7,
    created_by_name: "Admin Aliyev",
    ...over,
  };
}

const PAGE: SmsMessagePage = {
  count: 2,
  page: 1,
  pages: 1,
  page_size: 50,
  results: [
    message(),
    message({
      id: 4, kind: "debt_warning", status: "FAILED", eskiz_status: "", user: null, phone: "998935550000",
      campaign_id: null, created_by_name: "", error: "HTTP 422: mobile_phone is invalid", request_id: "",
    }),
  ],
  filters: [
    {
      key: "kind",
      label: "Kind",
      options: [
        { value: "debt_warning", label: "Debt warning", count: 1 },
        { value: "campaign", label: "Campaign", count: 1 },
        { value: "test", label: "Test", count: 0 },
      ],
      selected: null,
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";

async function render(query = "tab=journal") {
  search = query;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<JournalPanel />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  replace.mockReset();
  messages.mockReset().mockReturnValue({
    data: PAGE, isPending: false, isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn(),
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("JournalPanel", () => {
  it("shows each SMS: when, to whom, what kind, how it went, its parts, its text and who sent it", async () => {
    await render();
    const heads = [...container.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    expect(heads).toEqual(["Time", "Recipient", "Kind", "Status", "Parts", "Text", "By"]);
    const [first, second] = [...container.querySelectorAll("tbody tr")];
    expect(first.textContent).toContain("Malika Karimova");
    expect(first.textContent).toContain("998901234567");
    expect(first.textContent).toContain("Campaign");
    expect(first.textContent).toContain("Delivered");
    expect(first.textContent).toContain("Admin Aliyev");
    expect(first.querySelector('[title="eskiz: DELIVRD"]')).not.toBeNull();
    expect(second.textContent).toContain("Debt warning");
    expect(second.textContent).toContain("Failed");
    expect(second.textContent).toContain("998935550000");
  });

  it("asks with the journal's state from the address, not the tab", async () => {
    await render("tab=journal&status=FAILED&q=998&p=2&ps=25");
    const params = messages.mock.calls[0][0];
    expect(params).toMatchObject({ q: "998", page: 2, pageSize: 25, filters: { status: "FAILED" } });
    expect(params.filters).not.toHaveProperty("tab");
  });

  it("keeps the tab when a filter is clicked", async () => {
    await render();
    const link = [...container.querySelectorAll("aside a")].find((a) => a.textContent?.startsWith("Campaign"))!;
    await act(async () => (link as HTMLAnchorElement).click());
    expect(replace).toHaveBeenCalledWith("/ops/sms?tab=journal&kind=campaign", { scroll: false });
  });

  it("opens the whole message with its request id, error and campaign", async () => {
    await render();
    const open = container.querySelector("tbody tr button") as HTMLButtonElement;
    await act(async () => open.click());
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("administratsiyaga uchrang!");
    expect(dialog.textContent).toContain("5f1c2a9e-uuid");
    expect(dialog.querySelector('a[href="/ops/sms/campaigns/7"]')).not.toBeNull();

    await act(async () => (dialog.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click());
    await act(async () => (container.querySelectorAll("tbody tr button")[1] as HTMLButtonElement).click());
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain("HTTP 422: mobile_phone is invalid");
  });
});
