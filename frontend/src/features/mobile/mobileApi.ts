import api from "@/lib/api";

/**
 * The iOS app's release policy, as the console edits it — `GET/PUT /mobile/admin/policy/`.
 *
 * Every field is mapped by hand in `toPolicy`, not cast: a mapper that forwards `data as
 * Policy` passes a renamed server field through as `undefined` and the form shows an empty box
 * for a value that is actually set.
 */
export interface ReleasePolicy {
  platform: string;
  /** The newest build in the App Store. Older builds are ASKED to update. Empty = ask nobody. */
  latest_version: string;
  /** The oldest build allowed in. Older builds see an update screen and nothing else. */
  minimum_version: string;
  update_url: string;
  message: string;
  updated_at: string | null;
  updated_by: string | null;
}

export type DiagnosticKind = "crash" | "hang" | "cpu" | "disk" | "error";

export interface DiagnosticGroup {
  signature: string;
  kind: DiagnosticKind;
  count: number;
  /** Distinct installations — one phone crashing forty times is not forty phones. */
  installs: number;
  first_seen: string | null;
  last_seen: string | null;
  /** The newest report in the group, for the detail view. */
  sample_id: number;
}

export interface DiagnosticRow {
  id: number;
  kind: DiagnosticKind;
  signature: string;
  message: string;
  app_version: string;
  build: string;
  os_version: string;
  device_model: string;
  occurred_at: string | null;
  received_at: string | null;
  user: string | null;
  /** Only on the detail endpoint: MetricKit's document (call stacks) or the error context. */
  payload?: unknown;
}

export interface DiagnosticsSummary {
  days: number;
  totals: Record<DiagnosticKind, number>;
  app_versions: string[];
  groups: DiagnosticGroup[];
  recent: DiagnosticRow[];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const optStr = (v: unknown) => (typeof v === "string" && v ? v : null);
const KINDS: DiagnosticKind[] = ["crash", "hang", "cpu", "disk", "error"];
const kind = (v: unknown): DiagnosticKind => (KINDS.includes(v as DiagnosticKind) ? (v as DiagnosticKind) : "error");

function toPolicy(d: Record<string, unknown>): ReleasePolicy {
  return {
    platform: str(d.platform) || "ios",
    latest_version: str(d.latest_version),
    minimum_version: str(d.minimum_version),
    update_url: str(d.update_url),
    message: str(d.message),
    updated_at: optStr(d.updated_at),
    updated_by: optStr(d.updated_by),
  };
}

function toRow(d: Record<string, unknown>): DiagnosticRow {
  return {
    id: num(d.id),
    kind: kind(d.kind),
    signature: str(d.signature),
    message: str(d.message),
    app_version: str(d.app_version),
    build: str(d.build),
    os_version: str(d.os_version),
    device_model: str(d.device_model),
    occurred_at: optStr(d.occurred_at),
    received_at: optStr(d.received_at),
    user: optStr(d.user),
    ...("payload" in d ? { payload: d.payload } : {}),
  };
}

export const mobileApi = {
  async policy(): Promise<ReleasePolicy> {
    const { data } = await api.get<Record<string, unknown>>("/mobile/admin/policy/", { params: { platform: "ios" } });
    return toPolicy(data);
  },
  async savePolicy(body: Pick<ReleasePolicy, "latest_version" | "minimum_version" | "update_url" | "message">): Promise<ReleasePolicy> {
    const { data } = await api.put<Record<string, unknown>>("/mobile/admin/policy/", { platform: "ios", ...body });
    return toPolicy(data);
  },
  async diagnostics(params: { days: number; kind?: DiagnosticKind | ""; app_version?: string }): Promise<DiagnosticsSummary> {
    const { data } = await api.get<Record<string, unknown>>("/mobile/admin/diagnostics/", {
      params: { days: params.days, kind: params.kind || undefined, app_version: params.app_version || undefined },
    });
    const totals = (data.totals ?? {}) as Record<string, unknown>;
    return {
      days: num(data.days) || params.days,
      totals: Object.fromEntries(KINDS.map((k) => [k, num(totals[k])])) as Record<DiagnosticKind, number>,
      app_versions: Array.isArray(data.app_versions) ? data.app_versions.map(str).filter(Boolean) : [],
      groups: Array.isArray(data.groups)
        ? (data.groups as Record<string, unknown>[]).map((g) => ({
            signature: str(g.signature),
            kind: kind(g.kind),
            count: num(g.count),
            installs: num(g.installs),
            first_seen: optStr(g.first_seen),
            last_seen: optStr(g.last_seen),
            sample_id: num(g.sample_id),
          }))
        : [],
      recent: Array.isArray(data.recent) ? (data.recent as Record<string, unknown>[]).map(toRow) : [],
    };
  },
  async diagnostic(id: number): Promise<DiagnosticRow> {
    const { data } = await api.get<Record<string, unknown>>(`/mobile/admin/diagnostics/${id}/`);
    return toRow(data);
  },
};
