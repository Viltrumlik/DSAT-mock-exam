import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { money } from "../format";
import type { SmsMessagePage } from "../smsApi";
import { message } from "./fixtures";

/**
 * The journal (plan 2026-11-01-sms-v2, Task 9): every SMS, grouped by day, said in plain words, with
 * the filters as chips, the whole filtered list as a CSV, and each SMS's story in a drawer.
 */

let search = "";
const replace = vi.fn();
const messages = vi.fn();
const resend = vi.fn();
const exportMessages = vi.fn();
const downloadBlob = vi.fn();
const overview = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/ops/sms",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSmsMessages: (params: unknown) => messages(params),
  useResendMessages: () => ({ mutate: resend, isPending: false }),
  useSmsOverview: () => overview(),
}));
vi.mock("@/features/ops/sms/smsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ops/sms/smsApi")>()),
  smsApi: { exportMessages: (p: unknown) => exportMessages(p) },
}));
vi.mock("@/lib/download", () => ({ downloadBlob: (...a: unknown[]) => downloadBlob(...a) }));

const { JournalPanel } = await import("@/features/ops/sms/JournalPanel");

const PAGE: SmsMessagePage = {
  count: 3,
  page: 1,
  pages: 1,
  page_size: 50,
  results: [
    message({ id: 3, created_at: "2026-11-03T09:00:00+05:00", sent_at: "2026-11-03T09:00:02+05:00", checked_at: "2026-11-03T09:05:00+05:00" }),
    message({
      id: 4, created_at: "2026-11-02T10:00:00+05:00", kind: "debt_warning", status: "UNDELIVERED", eskiz_status: "REJECTED",
      user: null, phone: "998935550000", campaign_id: null, created_by_name: "", operator: "Ucell", groups: [],
      source: { type: "debt_warning", id: null, label: "Debt warning" }, request_id: "", can_resend: true,
    }),
    message({ id: 5, created_at: "2026-10-30T10:00:00+05:00" }),
  ],
  filters: [
    {
      key: "operator",
      label: "Operator",
      options: [
        { value: "Beeline", label: "Beeline", count: 2 },
        { value: "Ucell", label: "Ucell", count: 1 },
      ],
      selected: null,
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
const dialog = () => document.body.querySelector('[role="dialog"]');

async function render(query = "tab=journal") {
  search = query;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<JournalPanel />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T08:00:00Z"));
  replace.mockReset();
  resend.mockReset();
  overview.mockReset().mockReturnValue({ data: { price_per_part: 170 } });
  downloadBlob.mockReset();
  exportMessages.mockReset().mockResolvedValue(new Blob(["x"]));
  messages.mockReset().mockReturnValue({
    data: PAGE, isPending: false, isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn(),
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
});

describe("JournalPanel", () => {
  it("offers no Resend in the drawer until it knows the price", async () => {
    overview.mockReturnValue({ data: undefined });
    await render();
    const openers = container.querySelectorAll<HTMLButtonElement>("tbody tr td:first-child button");
    await act(async () => openers[1].click());
    const button = [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Resend")!;
    expect(button.disabled).toBe(true);
  });

  it("lists each SMS under its day: time, who and their class, phone, source, status in words, text", async () => {
    await render();
    const heads = [...container.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    expect(heads).toEqual(["Time", "Recipient", "Phone", "Source", "Status", "Text"]);
    const headers = [...container.querySelectorAll("table [data-group-header]")].map((el) => el.textContent);
    expect(headers).toEqual(["Today", "Yesterday", "30 Oct 2026"]);
    const rows = [...container.querySelectorAll("tbody tr")].filter((tr) => !tr.querySelector("[data-group-header]"));
    expect(rows[0].textContent).toContain("Malika Karimova");
    expect(rows[0].textContent).toContain("Junior G21 | Math");
    expect(rows[0].textContent).toContain("Delivered 09:05");
    expect(rows[1].textContent).toContain("Debt warning");
    expect(rows[1].textContent).toContain("Operator rejected");
    expect(rows[1].querySelector("[aria-label='Ucell']")).not.toBeNull();
  });

  it("links a name to that student's SMS", async () => {
    await render();
    expect(container.querySelector('a[href="/ops/students/5?tab=sms"]')).not.toBeNull();
  });

  it("asks with the journal's state from the address, the new filters and dates included", async () => {
    await render("tab=journal&status=FAILED&operator=Ucell&from=2026-11-01&to=2026-11-03&q=998&p=2&ps=25");
    const params = messages.mock.calls[0][0];
    expect(params).toMatchObject({
      q: "998", page: 2, pageSize: 25, filters: { status: "FAILED", operator: "Ucell", from: "2026-11-01", to: "2026-11-03" },
    });
    expect(params.filters).not.toHaveProperty("tab");
  });

  it("shows the chosen filters as chips that clear one by one, or all at once", async () => {
    await render("tab=journal&operator=Ucell&from=2026-11-01");
    const chips = [...container.querySelectorAll("[data-filter-chip]")].map((c) => c.textContent);
    expect(chips).toEqual(["Operator: Ucell", "From 1 Nov 2026"]);
    const clear = container.querySelector<HTMLButtonElement>("button[aria-label='Remove Operator: Ucell']")!;
    await act(async () => clear.click());
    expect(replace).toHaveBeenLastCalledWith("/ops/sms?tab=journal&from=2026-11-01", { scroll: false });
    const all = [...container.querySelectorAll("button")].find((b) => b.textContent === "Clear all")!;
    await act(async () => all.click());
    expect(replace).toHaveBeenLastCalledWith("/ops/sms?tab=journal", { scroll: false });
  });

  it("sets the dates from the quick buttons", async () => {
    await render();
    const week = [...container.querySelectorAll("button")].find((b) => b.textContent === "7 days")!;
    await act(async () => week.click());
    expect(replace).toHaveBeenLastCalledWith("/ops/sms?tab=journal&from=2026-10-28&to=2026-11-03", { scroll: false });
  });

  it("exports the filtered list as a CSV", async () => {
    await render("tab=journal&operator=Ucell");
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Export")!;
    await act(async () => button.click());
    expect(exportMessages.mock.calls[0][0]).toMatchObject({ filters: { operator: "Ucell" } });
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "sms-journal-2026-11-03.csv");
  });

  it("opens an SMS's story: the text, the timeline and the request id; Resend only when it did not arrive", async () => {
    await render();
    const openers = container.querySelectorAll<HTMLButtonElement>("tbody tr td:first-child button");
    await act(async () => openers[0].click());
    expect(dialog()!.textContent).toContain("Created");
    expect(dialog()!.textContent).toContain("Sent to eskiz");
    expect(dialog()!.textContent).toContain("Delivered");
    expect(dialog()!.textContent).toContain("5f1c2a9e");
    expect([...dialog()!.querySelectorAll("button")].some((b) => b.textContent === "Resend")).toBe(false);

    await act(async () => (dialog()!.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click());
    await act(async () => openers[1].click());
    expect(dialog()!.textContent).toContain("Not delivered");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const button = [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Resend")!;
    await act(async () => button.click());
    expect(confirm).toHaveBeenCalledWith(`Resend 1 SMS, ~${money(170)}?`);
    expect(resend.mock.calls[0][0]).toEqual([4]);
    confirm.mockRestore();
  });
});
