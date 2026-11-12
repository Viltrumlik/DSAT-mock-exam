import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The options the SMS hooks hand React Query. Worth pinning, because each is about money:
 * a POST that reached the server before it failed has already sent its SMS — so no SMS mutation
 * is retried, whatever the app-wide default says. A paid POST that failed without an
 * answer may still have gone out, so the panel is refreshed to show it. And the pages that wait
 * on the server (a campaign going out, "Send now") poll — but only while there is something to see.
 */

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useMutation: (options: unknown) => options,
  useQuery: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries }),
}));

const hooks = await import("@/features/ops/sms/smsHooks");

type Options = {
  retry?: unknown;
  onError?: (e: unknown) => void;
  refetchInterval?: number | false | ((query: unknown) => number | false | undefined);
};
const options = (result: unknown) => result as Options;
const interval = (result: unknown, data: unknown) => {
  const { refetchInterval } = options(result);
  return typeof refetchInterval === "function" ? refetchInterval({ state: { data } }) : refetchInterval;
};

const MUTATIONS: [string, () => unknown][] = [
  ["create campaign", () => hooks.useCreateCampaign()],
  ["preview campaign", () => hooks.usePreviewCampaign()],
  ["cancel campaign", () => hooks.useCancelCampaign(7)],
  ["retry campaign", () => hooks.useRetryCampaign(7)],
  ["preview an audience", () => hooks.usePreviewAudience()],
  ["rename a template", () => hooks.useRenameTemplate()],
  ["debt send now", () => hooks.useDebtSendNow()],
  ["test SMS", () => hooks.useSendTestSms()],
  ["submit template", () => hooks.useSubmitTemplate()],
  ["settings PATCH", () => hooks.useUpdateSmsSettings()],
  ["templates sync", () => hooks.useSyncTemplates()],
  ["resend", () => hooks.useResendMessages()],
];

beforeEach(() => invalidateQueries.mockReset());

describe("the campaigns list", () => {
  const list = () => hooks.useSmsCampaigns();

  it("is asked again only while one is on its way out", () => {
    expect(interval(list(), [{ status: "SENDING", scheduled_at: "2026-10-20T09:30:00+05:00" }])).toBe(hooks.CAMPAIGN_POLL_MS);
    expect(interval(list(), [{ status: "SCHEDULED", scheduled_at: "2020-01-01T09:30:00+05:00" }])).toBe(hooks.CAMPAIGN_POLL_MS);
    expect(interval(list(), [{ status: "DONE", scheduled_at: "2020-01-01T09:30:00+05:00" }])).toBe(false);
    expect(interval(list(), undefined)).toBe(false);
  });

  it("wakes up when the next scheduled one comes due, or nothing would ever ask again", () => {
    const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
    const scheduled = (m: number) => ({ status: "SCHEDULED", scheduled_at: inMinutes(m) });
    const wait = interval(list(), [scheduled(30), scheduled(2)]) as number;
    expect(wait).toBeGreaterThan(115_000);
    expect(wait).toBeLessThanOrEqual(120_000);
    // Moments away is still no faster than the poll.
    expect(interval(list(), [scheduled(0.01)])).toBe(hooks.CAMPAIGN_POLL_MS);
    // Far away is checked hourly: a timer past about 24 days overflows and fires at once.
    expect(interval(list(), [{ status: "SCHEDULED", scheduled_at: "2099-01-01T09:30:00+05:00" }])).toBe(60 * 60_000);
  });
});

describe("SMS mutations", () => {
  it.each(MUTATIONS)("%s is never retried by React Query", (_name, hook) => {
    expect(options(hook()).retry).toBe(false);
  });

  it.each([
    ["create campaign", () => hooks.useCreateCampaign()],
    ["debt send now", () => hooks.useDebtSendNow()],
    ["test SMS", () => hooks.useSendTestSms()],
    ["resend", () => hooks.useResendMessages()],
  ] as [string, () => unknown][])("%s refreshes the panel when it failed with no answer", (_name, hook) => {
    const { onError } = options(hook());
    onError?.(new Error("Network Error"));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["sms"] });
    invalidateQueries.mockReset();
    onError?.(Object.assign(new Error("AUTH_TEMPORAL_STALE"), { __mastersatTemporalStale: true }));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["sms"] });
    invalidateQueries.mockReset();
    // An answer — a refusal — means nothing went out: nothing to refresh.
    onError?.({ response: { status: 400, data: { detail: "No." } } });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

describe("polling", () => {
  it("polls a campaign only while it is scheduled or sending", () => {
    const at = (status: string) => interval(hooks.useSmsCampaign(7), { campaign: { status }, messages: [] });
    expect(at("SCHEDULED")).toBe(hooks.CAMPAIGN_POLL_MS);
    expect(at("SENDING")).toBe(hooks.CAMPAIGN_POLL_MS);
    expect(at("DONE")).toBe(false);
    expect(at("FAILED")).toBe(false);
    expect(at("CANCELLED")).toBe(false);
    expect(interval(hooks.useSmsCampaign(7), undefined)).toBe(false);
    // The composer reads the campaign it repeats once: its figures are not what it is there for.
    expect(interval(hooks.useSmsCampaign(7, false), { campaign: { status: "SENDING" }, messages: [] })).toBe(false);
  });

  it("polls the debt preview after Send now while warnings are left, for about two minutes", () => {
    const soon = Date.now() + 60_000;
    expect(interval(hooks.useDebtPreview("", soon), { to_send: 3 })).toBe(hooks.DEBT_POLL_MS);
    expect(interval(hooks.useDebtPreview("", soon), { to_send: 0 })).toBe(false);
    expect(interval(hooks.useDebtPreview("", Date.now() - 1), { to_send: 3 })).toBe(false);
    expect(interval(hooks.useDebtPreview(""), { to_send: 3 })).toBe(false);
    expect(interval(hooks.useDebtRuns(soon), [])).toBe(hooks.DEBT_POLL_MS);
    expect(interval(hooks.useDebtRuns(), [])).toBe(false);
    expect(hooks.DEBT_POLL_FOR_MS).toBeLessThanOrEqual(2 * 60_000);
  });
});
