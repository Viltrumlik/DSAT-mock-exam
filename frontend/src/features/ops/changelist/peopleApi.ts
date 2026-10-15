"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { ChangeListData } from "./ChangeList";
import type { ChangeListParams } from "./useChangeListParams";

/**
 * `GET /users/admin/people/` — the /ops Students, Public users and Staff lists
 * (backend/users/views_people.py). Search, filters with counts, ordering and pages are the
 * server's; this only names the shapes and asks.
 */

export type PeopleSection = "students" | "public" | "staff";

/** `users.audience.kind_of` for learners; staff are "active" or "frozen". */
export type PeopleStatus = "centre" | "public" | "frozen_debt" | "frozen_admin" | "active" | "frozen";

export interface PeopleRowBase {
  id: number;
  /** The profile photo, when the server sends one; null draws initials. */
  avatar_url?: string | null;
  username: string;
  /** "First Last", "" when the account has neither. */
  name: string;
  email: string;
  phone: string;
  role: string;
  status: PeopleStatus | string;
  is_frozen: boolean;
  /** ISO. */
  date_joined: string | null;
  /** ISO of the newest sign-in session's last activity; null for never. */
  last_seen: string | null;
  /** The two name parts, when the server sends them — the editor saves them separately. */
  first_name?: string;
  last_name?: string;
  /** Graded/submitted rows the account holds — the delete warning, when the server sends it. */
  attempt_count?: number;
}

export interface StudentRow extends PeopleRowBase {
  groups: { id: number; name: string }[];
  /** `balance` is lc-up's, in whole UZS; negative is a debt. */
  lcup: { linked: boolean; balance: number | null };
}

export interface PublicRow extends PeopleRowBase {
  email_verified: boolean;
}

export interface StaffRow extends PeopleRowBase {
  subject: string;
}

export type PeopleRow = StudentRow | PublicRow | StaffRow;

export type PeopleRowFor<S extends PeopleSection> = S extends "students"
  ? StudentRow
  : S extends "public"
    ? PublicRow
    : StaffRow;

export interface PeoplePage<R extends PeopleRowBase = PeopleRow> extends ChangeListData<R> {
  section: PeopleSection;
  ordering: string;
}

/** The filter keys each section understands (anything else in the address is not sent). */
export const PEOPLE_FILTER_KEYS: Record<PeopleSection, readonly string[]> = {
  students: ["status", "group", "teacher", "lcup", "debt", "dupes", "signin"],
  public: ["status", "joined", "verified", "dupes", "signin"],
  staff: ["role", "subject", "status"],
};

/** The query string the endpoint takes, from the list's address state. */
export function peopleQuery(section: PeopleSection, params: ChangeListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key of PEOPLE_FILTER_KEYS[section]) {
    const value = params.filters[key];
    if (value) out[key] = value;
  }
  if (params.q) out.q = params.q;
  if (params.o) out.o = params.o;
  if (params.page > 1) out.page = params.page;
  out.page_size = params.pageSize;
  out.section = section;
  return out;
}

export const peopleApi = {
  async list<S extends PeopleSection>(section: S, params: ChangeListParams): Promise<PeoplePage<PeopleRowFor<S>>> {
    const { data } = await api.get<PeoplePage<PeopleRowFor<S>>>("/users/admin/people/", {
      params: peopleQuery(section, params),
    });
    return data;
  },
};

export const peopleKeys = {
  all: ["ops", "people"] as const,
  list: (section: PeopleSection, params: Record<string, string | number>) => ["ops", "people", section, params] as const,
};

/** One page of a section. The previous page stays on screen while the next loads. */
export function usePeople<S extends PeopleSection>(section: S, params: ChangeListParams) {
  return useQuery({
    queryKey: peopleKeys.list(section, peopleQuery(section, params)),
    queryFn: () => peopleApi.list(section, params),
    placeholderData: keepPreviousData,
  });
}
