import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The client half of the SMS panel's contract (plan 2026-10-18-sms-ops-panel-api.md): every call
 * goes to its root-relative path through the one axios instance, with the body the contract names.
 */

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
  },
}));

const { smsApi, messagesQuery } = await import("../smsApi");

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: {} });
  post.mockReset().mockResolvedValue({ data: {} });
  patch.mockReset().mockResolvedValue({ data: {} });
});

describe("messagesQuery", () => {
  it("sends the search, the three filters and the page, and nothing else from the address", () => {
    const q = messagesQuery({
      q: "9989",
      o: "-created_at",
      page: 2,
      pageSize: 25,
      filters: { kind: "campaign", status: "FAILED", when: "7d", junk: "1" },
    });
    expect(q).toEqual({ q: "9989", kind: "campaign", status: "FAILED", when: "7d", page: 2, page_size: 25 });
  });

  it("leaves page 1 and the empty search out", () => {
    expect(messagesQuery({ q: "", o: "", page: 1, pageSize: 50, filters: {} })).toEqual({ page_size: 50 });
  });
});

describe("smsApi", () => {
  it("reads from the admin paths", async () => {
    await smsApi.overview();
    await smsApi.messages({ q: "", o: "", page: 1, pageSize: 50, filters: { kind: "test" } });
    await smsApi.campaigns();
    await smsApi.campaign(7);
    await smsApi.settings();
    await smsApi.debtPreview();
    await smsApi.debtPreview("2026-11-05");
    await smsApi.debtRuns();
    await smsApi.templates();
    await smsApi.classrooms();
    await smsApi.students("mal");
    expect(get.mock.calls).toEqual([
      ["/sms/admin/overview/"],
      ["/sms/admin/messages/", { params: { kind: "test", page_size: 50 } }],
      ["/sms/admin/campaigns/"],
      ["/sms/admin/campaigns/7/"],
      ["/sms/admin/settings/"],
      ["/sms/admin/debt/preview/", { params: {} }],
      ["/sms/admin/debt/preview/", { params: { day: "2026-11-05" } }],
      ["/sms/admin/debt/runs/"],
      ["/sms/admin/templates/"],
      ["/sms/admin/audience/classrooms/"],
      ["/sms/admin/audience/students/", { params: { q: "mal" } }],
    ]);
  });

  it("writes to the admin paths with the contract's bodies", async () => {
    const draft = {
      template_id: 64942,
      slot_roles: ["student" as const],
      slot_texts: [""],
      audience: "student" as const,
      audience_ids: [5, 9],
      scheduled_at: null,
    };
    await smsApi.previewCampaign(draft);
    await smsApi.createCampaign(draft);
    await smsApi.cancelCampaign(7);
    await smsApi.retryCampaign(7);
    await smsApi.debtSendNow();
    await smsApi.syncTemplates();
    await smsApi.submitTemplate("Salom (STUDENT)!");
    await smsApi.sendTest({ phone: "998880032508", template_id: 64942, slot_texts: [""] });
    expect(post.mock.calls).toEqual([
      ["/sms/admin/campaigns/preview/", draft],
      ["/sms/admin/campaigns/", draft],
      ["/sms/admin/campaigns/7/cancel/"],
      ["/sms/admin/campaigns/7/retry/"],
      ["/sms/admin/debt/send-now/"],
      ["/sms/admin/templates/sync/"],
      ["/sms/admin/templates/", { text: "Salom (STUDENT)!" }],
      ["/sms/admin/test/", { phone: "998880032508", template_id: 64942, slot_texts: [""] }],
    ]);

    await smsApi.updateSettings({ debt_hour: 9 });
    expect(patch.mock.calls).toEqual([["/sms/admin/settings/", { debt_hour: 9 }]]);
  });

  it("answers empty lists, not undefined, when a list body is missing", async () => {
    expect(await smsApi.campaigns()).toEqual([]);
    expect(await smsApi.debtRuns()).toEqual([]);
    expect(await smsApi.classrooms()).toEqual([]);
    expect(await smsApi.students("x")).toEqual([]);
    expect(await smsApi.templates()).toEqual({ templates: [], synced_at: null });
  });
});
