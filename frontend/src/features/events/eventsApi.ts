import api from "@/lib/api";

/**
 * Learning-center events. Named `LearningEvent`, not `Event`: the DOM already owns that name,
 * and a shadowed `Event` in a file that also handles clicks is a type error nobody enjoys.
 *
 * Every path here is root-relative to the axios instance, whose baseURL already ends in the
 * API prefix — writing the prefix again would both double it and trip `check:api-layer`.
 */
export type EventStatus = "DRAFT" | "PUBLISHED" | "CANCELLED";
export type Attendance = "ATTENDED" | "MISSED" | null;

export interface EventSeat {
  id: number;
  status: "REGISTERED" | "CANCELLED";
  attendance: Attendance;
  registered_at: string;
  /** What this seat has actually paid, read from the ledger — 0 until somebody is marked. */
  points_awarded: number;
}

export interface LearningEvent {
  id: number;
  title: string;
  description: string;
  /** Signed and expiring (~1h). Null when the event was saved without a picture. */
  cover_image_url: string | null;
  starts_at: string;
  ends_at: string;
  location: string;
  seats: number;
  seats_left: number;
  status: EventStatus;
  my_registration: EventSeat | null;
  /** Server-computed. The page must never re-derive these, or it becomes a second copy of a
   *  rule that exists server-side precisely to have one copy. */
  can_sign_up: boolean;
  can_cancel: boolean;
}

export interface EventCounts {
  registered: number;
  attended: number;
  missed: number;
  not_marked: number;
  cancelled: number;
}

export interface AdminRegistration {
  id: number;
  student: number;
  student_name: string;
  phone: string;
  status: "REGISTERED" | "CANCELLED";
  registered_at: string;
  attendance: Attendance;
  marked_at: string | null;
}

export interface RegistrationsPayload {
  registrations: AdminRegistration[];
  counts: EventCounts;
  marking_opens_at: string;
}

/** The refusal code the server sends beside its sentence: `full`, `cancel_window_closed`, … */
export function refusalCode(error: unknown): string | undefined {
  const data = (error as { response?: { data?: { code?: unknown } } })?.response?.data;
  return typeof data?.code === "string" ? data.code : undefined;
}

/**
 * Read a DRF error body into one sentence. `detail` covers the hand-written refusals; the
 * field map covers whatever a serializer raises.
 */
export function refusalText(error: unknown): string | undefined {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (!data) return undefined;
  if (typeof data === "string") return data;
  const body = data as Record<string, unknown>;
  if (typeof body.detail === "string") return body.detail;
  for (const [field, value] of Object.entries(body)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") {
      return field === "non_field_errors" ? first : `${field}: ${first}`;
    }
  }
  return undefined;
}

export const eventsApi = {
  // ── student ──────────────────────────────────────────────────────────────
  async upcoming(): Promise<LearningEvent[]> {
    const { data } = await api.get<{ events: LearningEvent[] }>("/events/");
    return data?.events ?? [];
  },
  async mine(): Promise<LearningEvent[]> {
    const { data } = await api.get<{ events: LearningEvent[] }>("/events/mine/");
    return data?.events ?? [];
  },
  async signUp(id: number): Promise<EventSeat> {
    const { data } = await api.post<EventSeat>(`/events/${id}/sign-up/`);
    return data;
  },
  async cancel(id: number): Promise<EventSeat> {
    const { data } = await api.post<EventSeat>(`/events/${id}/cancel/`);
    return data;
  },

  // ── ops ──────────────────────────────────────────────────────────────────
  async adminList(): Promise<LearningEvent[]> {
    const { data } = await api.get<{ events: LearningEvent[] }>("/events/admin/");
    return data?.events ?? [];
  },
  /** `body` is FormData when a picture is attached — axios must own the boundary. */
  async adminCreate(body: FormData | Record<string, unknown>): Promise<LearningEvent> {
    const { data } = await api.post<LearningEvent>("/events/admin/", body);
    return data;
  },
  async adminUpdate(
    id: number,
    body: FormData | Record<string, unknown>,
  ): Promise<LearningEvent> {
    const { data } = await api.patch<LearningEvent>(`/events/admin/${id}/`, body);
    return data;
  },
  async adminDelete(id: number): Promise<void> {
    await api.delete(`/events/admin/${id}/`);
  },
  async adminPublish(id: number): Promise<LearningEvent & { announced: boolean }> {
    const { data } = await api.post<LearningEvent & { announced: boolean }>(
      `/events/admin/${id}/publish/`,
    );
    return data;
  },
  async adminCancel(id: number): Promise<LearningEvent> {
    const { data } = await api.post<LearningEvent>(`/events/admin/${id}/cancel/`);
    return data;
  },
  async adminRegistrations(id: number): Promise<RegistrationsPayload> {
    const { data } = await api.get<RegistrationsPayload>(`/events/admin/${id}/registrations/`);
    // Spread FIRST, then default each field — the house pattern. A field-by-field rebuild
    // here is the mapper-whitelist bug that has already cost this project an outage.
    return {
      ...data,
      registrations: data?.registrations ?? [],
      counts: data?.counts ?? {
        registered: 0, attended: 0, missed: 0, not_marked: 0, cancelled: 0,
      },
    };
  },
  async adminMark(registrationId: number, attendance: Attendance): Promise<AdminRegistration> {
    const { data } = await api.post<AdminRegistration>(
      `/events/admin/registrations/${registrationId}/attendance/`,
      { attendance },
    );
    return data;
  },
};
