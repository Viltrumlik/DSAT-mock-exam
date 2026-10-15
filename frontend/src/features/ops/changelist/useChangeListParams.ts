"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * A changelist keeps its state in the address, the way Django admin does:
 * `?q=` search, `?o=` ordering, `?p=` page, `?ps=` page size, and one key per filter.
 * Reload, back/forward and a pasted link all land on the same list.
 */

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

/** Keys the changelist owns; everything else in the query string is a filter. */
const RESERVED = new Set(["q", "o", "p", "ps"]);

export type ChangeListParams = {
  q: string;
  /** "" when the address names none — the server then applies its default. */
  o: string;
  page: number;
  pageSize: number;
  /** Active filters, `{status: "frozen_debt"}`; only the keys the list declared. */
  filters: Record<string, string>;
};

function positiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Reads the list's state from the query string. `filterKeys` limits which keys count as filters. */
export function readChangeListParams(search: URLSearchParams, filterKeys?: readonly string[]): ChangeListParams {
  const size = positiveInt(search.get("ps"));
  const filters: Record<string, string> = {};
  search.forEach((value, key) => {
    if (RESERVED.has(key) || !value) return;
    if (filterKeys && !filterKeys.includes(key)) return;
    filters[key] = value;
  });
  return {
    q: (search.get("q") ?? "").trim(),
    o: search.get("o") ?? "",
    page: positiveInt(search.get("p")) ?? 1,
    pageSize: size && (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
    filters,
  };
}

export type ChangeListPatch = Record<string, string | number | null | undefined>;

/**
 * The query string after `patch` (a null/empty value removes the key). Unless `keepPage`, the
 * page goes back to 1 — a new search, filter, sort or page size starts at the top, as in Django.
 */
export function patchSearch(current: URLSearchParams, patch: ChangeListPatch, keepPage = false): string {
  const next = new URLSearchParams(current.toString());
  if (!keepPage) next.delete("p");
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
  }
  // Defaults stay out of the address.
  if (next.get("p") === "1") next.delete("p");
  if (next.get("ps") === String(DEFAULT_PAGE_SIZE)) next.delete("ps");
  return next.toString();
}

export function useChangeListParams(filterKeys?: readonly string[]) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryString = search.toString();

  const params = useMemo(
    () => readChangeListParams(new URLSearchParams(queryString), filterKeys),
    // `filterKeys` is a module constant at every call site; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryString, filterKeys?.join(",")],
  );

  /** The address for this list with `patch` applied — for links that can open in a new tab. */
  const hrefFor = useCallback(
    (patch: ChangeListPatch, keepPage = false) => {
      const qs = patchSearch(new URLSearchParams(queryString), patch, keepPage);
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, queryString],
  );

  const update = useCallback(
    (patch: ChangeListPatch, keepPage = false) => {
      router.replace(hrefFor(patch, keepPage), { scroll: false });
    },
    [router, hrefFor],
  );

  return { params, queryString, hrefFor, update };
}
