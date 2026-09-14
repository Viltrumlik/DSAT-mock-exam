import api from "@/lib/api";

/**
 * The profile's own requests: the devices signed in, signing them out, and the password.
 *
 * Kept here rather than in `lib/api.ts` because nothing else calls them, and the typed rows are
 * what the Devices section renders — `authApi.getSessions` hands back `any[]`.
 */

/** One device signed in to the account — a LIVE refresh-token session (`GET /auth/sessions/`). */
export interface AuthSession {
  id: number;
  created_at: string | null;
  last_seen_at: string | null;
  ip: string;
  user_agent: string;
  /** The session this browser renews with. False on every row when that can't be told. */
  is_current: boolean;
}

/** A save refused field by field, the way DRF says it: `{"new_password": ["Too short."]}`. */
export type FieldErrors = Record<string, string[]>;

/** The field messages out of a failed request, or null when the failure was not a 400. */
export function fieldErrors(err: unknown): FieldErrors | null {
  const res = (err as { response?: { status?: number; data?: unknown } })?.response;
  if (res?.status !== 400 || !res.data || typeof res.data !== "object") return null;
  const out: FieldErrors = {};
  for (const [key, value] of Object.entries(res.data as Record<string, unknown>)) {
    if (Array.isArray(value)) out[key] = value.map(String);
    else if (typeof value === "string") out[key] = [value];
  }
  return out;
}

export const profileApi = {
  async sessions(): Promise<AuthSession[]> {
    const { data } = await api.get<{ sessions?: Partial<AuthSession>[] }>("/auth/sessions/");
    const rows = Array.isArray(data?.sessions) ? data.sessions : [];
    return rows.map((row) => ({
      id: Number(row.id),
      created_at: row.created_at ?? null,
      last_seen_at: row.last_seen_at ?? null,
      ip: row.ip ?? "",
      user_agent: row.user_agent ?? "",
      is_current: Boolean(row.is_current),
    }));
  },

  async signOutDevice(id: number): Promise<void> {
    await api.post(`/auth/sessions/${id}/revoke/`, {});
  },

  /** Every other device. `keptCurrent` is false when the server could not tell which device
   *  this is — it then signed this one out too. */
  async signOutOtherDevices(): Promise<{ revoked: number; keptCurrent: boolean }> {
    const { data } = await api.post("/auth/sessions/revoke_all/", { keep_current: true });
    return { revoked: Number(data?.revoked ?? 0), keptCurrent: Boolean(data?.kept_current) };
  },

  /** Every device, this one included. The caller signs this browser out afterwards. */
  async signOutEverywhere(): Promise<void> {
    await api.post("/auth/sessions/revoke_all/", {});
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<{ signedOutDevices: number; changedAt: string | null }> {
    const { data } = await api.post("/auth/password/change/", {
      current_password: currentPassword,
      new_password: newPassword,
    });
    return {
      signedOutDevices: Number(data?.signed_out_sessions ?? 0),
      changedAt: typeof data?.last_password_change === "string" ? data.last_password_change : null,
    };
  },
};
