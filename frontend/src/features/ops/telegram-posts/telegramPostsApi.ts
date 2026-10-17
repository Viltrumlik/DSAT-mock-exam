import api from "@/lib/api";

/**
 * Posts the class bot makes into the class Telegram groups (plan 2026-10-17).
 *
 * Paths are root-relative to the axios instance, whose baseURL already ends in the API prefix
 * (see eventsApi.ts) — writing the prefix again would double it and trip `check:api-layer`.
 */
export type PostKind = "MANUAL" | "EVENT_ANNOUNCE" | "EVENT_REMINDER";
export type PostWhen = "NOW" | "ONCE" | "WEEKLY" | "EVENT";
export type PostState =
  | "scheduled" | "sending" | "sent" | "failed" | "missed" | "paused" | "deleted" | "done" | "event_cancelled";
export type DeliveryStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "MISSED" | "DELETED";
export type PostAction = "pause" | "resume" | "retry" | "send-missed" | "delete-from-groups";

export interface RunCounts {
  run_on: string;
  total: number;
  sent: number;
  failed: number;
  missed: number;
  pending: number;
  deleted: number;
}

export interface GroupPost {
  id: number;
  kind: PostKind;
  text: string;
  /** The message as it is sent (HTML), built by the server — event posts have no `text`. */
  preview: string;
  image_url: string | null;
  button_text: string;
  button_url: string;
  subjects: string[];
  levels: string[];
  classroom_ids: number[];
  when: PostWhen;
  send_at: string | null;
  /** 0 = Monday … 6 = Sunday. */
  weekdays: number[];
  /** "HH:MM:SS", Tashkent time. */
  time_of_day: string | null;
  is_paused: boolean;
  deleted_at: string | null;
  event_id: number | null;
  event_title: string;
  created_at: string;
  audience_label: string;
  next_send_at: string | null;
  last_run: RunCounts | null;
  /** Server-computed. The page never re-derives it. */
  state: PostState;
}

export interface Delivery {
  id: number;
  chat_id: string;
  group_names: string;
  status: DeliveryStatus;
  error: string;
  sent_at: string | null;
  attempts: number;
}

export interface GroupPostDetail extends GroupPost {
  runs: { run_on: string; deliveries: Delivery[] }[];
}

export interface TelegramGroup {
  id: number;
  name: string;
  subject: string;
  level: string;
  chat_id: string;
}

/** Empty lists mean "all". A non-empty `classroom_ids` means exactly those classes. */
export interface Audience {
  subjects: string[];
  levels: string[];
  classroom_ids?: number[];
}

export const telegramPostsApi = {
  async list(): Promise<{ enabled: boolean; posts: GroupPost[] }> {
    const { data } = await api.get<{ enabled: boolean; posts: GroupPost[] }>("/telegram-posts/admin/");
    return { enabled: Boolean(data?.enabled), posts: data?.posts ?? [] };
  },
  async detail(id: number): Promise<GroupPostDetail> {
    const { data } = await api.get<GroupPostDetail>(`/telegram-posts/admin/${id}/`);
    return data;
  },
  /** `body` is FormData when a picture is attached — axios must own the boundary. */
  async create(body: FormData | Record<string, unknown>): Promise<GroupPostDetail> {
    const { data } = await api.post<GroupPostDetail>("/telegram-posts/admin/", body);
    return data;
  },
  async update(id: number, body: FormData | Record<string, unknown>): Promise<GroupPostDetail> {
    const { data } = await api.patch<GroupPostDetail>(`/telegram-posts/admin/${id}/`, body);
    return data;
  },
  async action(id: number, action: PostAction): Promise<{ result: Record<string, number>; post: GroupPostDetail }> {
    const { data } = await api.post<{ result: Record<string, number>; post: GroupPostDetail }>(
      `/telegram-posts/admin/${id}/${action}/`,
    );
    return data;
  },
  async groups(): Promise<{ enabled: boolean; groups: TelegramGroup[] }> {
    const { data } = await api.get<{ enabled: boolean; groups: TelegramGroup[] }>("/telegram-posts/admin/groups/");
    return { enabled: Boolean(data?.enabled), groups: data?.groups ?? [] };
  },
};
