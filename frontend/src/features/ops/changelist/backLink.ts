/**
 * A change form remembers the changelist it was opened from, the way Django admin does with
 * `?_changelist_filters=`: Back and the breadcrumb return to the same search, filters and page.
 */
export const LIST_FILTERS_PARAM = "_changelist_filters";

export function withListFilters(href: string, listQueryString: string): string {
  return listQueryString ? `${href}?${LIST_FILTERS_PARAM}=${encodeURIComponent(listQueryString)}` : href;
}

export function listHrefFrom(search: URLSearchParams, listPath: string): string {
  const qs = search.get(LIST_FILTERS_PARAM) ?? "";
  return qs ? `${listPath}?${qs}` : listPath;
}
