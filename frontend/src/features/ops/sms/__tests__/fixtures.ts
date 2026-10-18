import type { Campaign, EskizTemplate, SmsMessage } from "../smsApi";

/** Contract-shaped rows the SMS panel tests share (plan 2026-10-18-sms-ops-panel-api.md). */

export function template(over: Partial<EskizTemplate> = {}): EskizTemplate {
  return {
    eskiz_id: 64942,
    status: "service",
    pattern:
      "MASTER SAT'dan yozyabmiz. %w{1,4} sizda qarzdorlik mavjud. To'lovni amalga oshirish uchun zudlik bilan administratsiyaga uchrang!",
    original:
      "MASTER SAT'dan yozyabmiz. (STUDENT), sizda qarzdorlik mavjud. To'lovni amalga oshirish uchun zudlik bilan administratsiyaga uchrang!",
    slots: [{ kind: "w", min: 1, max: 4 }],
    guessed_roles: ["student"],
    parts: 1,
    ascii: true,
    usable: true,
    synced_at: "2026-10-18T09:00:00+05:00",
    submitted_by_name: "",
    submitted_at: null,
    ...over,
  };
}

/** Two word-and-number slots the server could not guess: both `text`. */
export const EVENT_TEMPLATE = template({
  eskiz_id: 70001,
  pattern: "Ertaga %w{1,3} soat %d da.",
  original: "Ertaga (EVENT) soat (TIME) da.",
  slots: [{ kind: "w", min: 1, max: 3 }, { kind: "d", min: 1, max: 1 }],
  guessed_roles: ["text", "text"],
});

export const LAST_DAY_TEMPLATE = template({
  eskiz_id: 52393,
  pattern: "Bugun oxirgi kun! MASTER SAT'dan yozyabmiz. %w{1,4} sizda qarzdorlik mavjud.",
  original: "Bugun oxirgi kun! MASTER SAT'dan yozyabmiz. (STUDENT), sizda qarzdorlik mavjud.",
});

export const REJECTED_TEMPLATE = template({ eskiz_id: 50000, status: "rejected", usable: false, original: "Rad etilgan matn" });

export function campaign(over: Partial<Campaign> = {}): Campaign {
  return {
    id: 7,
    status: "SCHEDULED",
    template_eskiz_id: 64942,
    pattern: template().pattern,
    original: template().original,
    slot_roles: ["student"],
    slot_texts: [""],
    audience: "group",
    audience_ids: [61],
    audience_label: "Group: Junior G21 | Math",
    scheduled_at: "2026-10-20T09:30:00+05:00",
    created_at: "2026-10-18T21:00:00+05:00",
    started_at: null,
    finished_at: null,
    created_by_name: "Admin Aliyev",
    error: "",
    result: { delivered: 0, undelivered: 0 },
    ...over,
  };
}

export function message(over: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 3,
    created_at: "2026-10-20T09:30:01+05:00",
    sent_at: "2026-10-20T09:30:02+05:00",
    kind: "campaign",
    status: "DELIVERED",
    eskiz_status: "DELIVRD",
    phone: "998901234567",
    text: "MASTER SAT'dan yozyabmiz. Karimova Malika, sizda qarzdorlik mavjud.",
    parts: 1,
    request_id: "5f1c2a9e",
    error: "",
    user: { id: 5, name: "Malika Karimova" },
    lcup_student_id: 101,
    campaign_id: 7,
    created_by_name: "Admin Aliyev",
    ...over,
  };
}
