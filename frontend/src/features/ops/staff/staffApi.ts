import api from "@/lib/api";
import type { CanonicalRole } from "@/lib/roles";

/**
 * Staff management, the owner's alone (`manage_staff`, plan 2026-11-12-crm-roles PR 4): a new staff account,
 * one person's permissions (the role's preset plus the owner's ticks), and turning an employee's access off.
 */

export type StaffPermissions = {
  role: string;
  /** Every permission a tick may move, in the order the card lists them. */
  tickable: string[];
  /** What the role gives. */
  preset: string[];
  /** The owner's ticks: true gives one the role does not, false takes one the role gives. */
  ticks: Record<string, boolean>;
  /** What the person holds now. */
  effective: string[];
};

export type NewStaff = {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  username: string;
  role: CanonicalRole;
  subject?: string;
  password: string;
};

export const staffKeys = {
  permissions: (id: number) => ["ops", "staff", "permissions", id] as const,
};

export const staffApi = {
  async create(body: NewStaff): Promise<{ id: number }> {
    const payload = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== "" && v !== undefined));
    return (await api.post<{ id: number }>("/users/create/", payload)).data;
  },
  async permissions(id: number): Promise<StaffPermissions> {
    return (await api.get<StaffPermissions>(`/users/admin/people/${id}/permissions/`)).data;
  },
  async setTicks(id: number, ticks: Record<string, boolean | null>): Promise<StaffPermissions> {
    return (await api.put<StaffPermissions>(`/users/admin/people/${id}/permissions/`, { ticks })).data;
  },
  async setAccess(id: number, active: boolean): Promise<{ active: boolean; revoked: number }> {
    return (await api.post<{ active: boolean; revoked: number }>(`/users/admin/people/${id}/access/`, { active })).data;
  },
};

/** What each permission is called on the Staff page (the names `access.0012` gives them). */
export const PERMISSION_LABELS: Record<string, string> = {
  view_people: "View people and groups",
  edit_people: "Edit learners' details",
  view_money: "View money",
  take_payment: "Take payments and refunds",
  void_payment: "Void payments",
  adjust_balance: "Adjust balances",
  set_prices: "Set prices",
  debt_freeze: "Debt-freeze exemptions",
  enroll: "Enrol students",
  manage_seats: "Manage seats",
  manage_groups: "Manage groups",
  send_sms: "Send SMS campaigns",
  send_debt_sms: "Send debt SMS",
  view_reports: "View money totals",
  events_shop: "Events, shop and posts",
  lcup_tools: "lc-up tools",
};
