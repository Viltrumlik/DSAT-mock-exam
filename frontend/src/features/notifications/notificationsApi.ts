import api from "@/lib/api";

export type NotificationCategory =
  | "GRADES"
  | "HOMEWORK"
  | "CLASSROOM"
  | "EXAMS"
  | "SUPPORT"
  | "REWARDS"
  | "SYSTEM";

export interface AppNotification {
  id: number;
  category: NotificationCategory;
  category_label: string;
  event: string;
  title: string;
  body: string;
  link_url: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationInbox {
  notifications: AppNotification[];
  unread_total: number;
  unread_by_category: Partial<Record<NotificationCategory, number>>;
  /** Served rather than hardcoded, so a new section appears without a frontend deploy. */
  categories: { value: NotificationCategory; label: string }[];
}

export interface UnreadSummary {
  total: number;
  by_category: Partial<Record<NotificationCategory, number>>;
}

/**
 * What the student has switched off. Only exceptions are stored — an absent category is on —
 * so a section added to the platform later arrives enabled rather than silently muted for
 * everybody who set their preferences before it existed.
 */
export interface NotificationPreferences {
  muted_categories: NotificationCategory[];
  /** Separate from the categories: a student may want the bell but not their phone buzzing. */
  push_enabled: boolean;
  /** Served, like the inbox's — a new section gets a switch without a frontend deploy. */
  categories: { value: NotificationCategory; label: string }[];
}

/**
 * The writable half. Not `Partial<NotificationPreferences>`: `categories` is served, not
 * chosen, and a type that let a caller PATCH it would compile into a request the server
 * silently ignores — the worst kind, because it looks like it worked.
 */
export type NotificationPreferencesPatch = {
  muted_categories?: NotificationCategory[];
  push_enabled?: boolean;
};

export interface PushConfig {
  /** False when the deployment has no VAPID keys. The client must NOT prompt for permission
   *  in that case — a refusal is permanent per origin, so asking without being able to
   *  deliver burns the platform's one chance. */
  enabled: boolean;
  public_key: string;
}

export const notificationsApi = {
  async inbox(category?: NotificationCategory | null): Promise<NotificationInbox> {
    const { data } = await api.get<NotificationInbox>("/notifications/", {
      params: category ? { category } : undefined,
    });
    return data;
  },
  async summary(): Promise<UnreadSummary> {
    const { data } = await api.get<UnreadSummary>("/notifications/summary/");
    return data;
  },
  async markRead(payload: { ids?: number[]; category?: NotificationCategory } = {}) {
    const { data } = await api.post("/notifications/read/", payload);
    return data;
  },
  async getPreferences(): Promise<NotificationPreferences> {
    const { data } = await api.get<NotificationPreferences>("/notifications/preferences/");
    return data;
  },
  /**
   * PATCH, not PUT: the server merges whichever keys are present, so the push toggle and the
   * category switches can be saved independently without either one clobbering the other's
   * value from a stale render.
   */
  async patchPreferences(
    payload: NotificationPreferencesPatch,
  ): Promise<NotificationPreferences> {
    const { data } = await api.patch<NotificationPreferences>(
      "/notifications/preferences/",
      payload,
    );
    return data;
  },
  async pushConfig(): Promise<PushConfig> {
    const { data } = await api.get<PushConfig>("/notifications/push/config/");
    return data;
  },
  async subscribe(subscription: PushSubscriptionJSON) {
    const { data } = await api.post("/notifications/push/subscribe/", subscription);
    return data;
  },
  async unsubscribe(endpoint: string) {
    const { data } = await api.post("/notifications/push/unsubscribe/", { endpoint });
    return data;
  },
};
