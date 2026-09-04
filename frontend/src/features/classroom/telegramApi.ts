import api from "@/lib/api";

/** Where the site thinks this student stands with the class Telegram group. */
export type TelegramMemberStatus = "NONE" | "PENDING" | "JOINED" | "LEFT" | "REMOVED";

export type TelegramRemovalReason =
  | "FROZEN"
  | "NOT_IN_CLASS"
  | "IDENTITY_MISMATCH"
  | "MANUAL"
  | "";

export interface TelegramGroupState {
  /**
   * True when the class group is under the bot's control — a chat id is set and the server
   * has a bot token. False means the old world: a static invite link in `group_url`, or
   * nothing at all. The header button branches on this, so a class nobody has configured
   * keeps behaving exactly as it did.
   */
  managed: boolean;
  /** The legacy static invite link. Still shown for classes that have only this. */
  group_url: string;
  telegram_linked: boolean;
  status: TelegramMemberStatus;
  removed_reason: TelegramRemovalReason;
  eligible: boolean;
  reason: string;
  /** Why they are not eligible, in words meant for the student. */
  message: string;
  /** Empty unless a link has been minted and has not expired. */
  invite_link: string;
  invite_expires_at: string | null;
  rules: string[];
  invite_ttl_minutes: number;
  /** Only on the join response: they were already in the group, so nothing was minted. */
  already_member?: boolean;
}

const base = (classId: number) => `/classes/${classId}/telegram`;

export const telegramGroupApi = {
  state: async (classId: number): Promise<TelegramGroupState> =>
    (await api.get(`${base(classId)}/`)).data,
  join: async (classId: number): Promise<TelegramGroupState> =>
    (await api.post(`${base(classId)}/join/`, {})).data,
};
