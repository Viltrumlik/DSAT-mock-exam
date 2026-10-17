/**
 * The JSON object an API refusal carried, or null when the body is anything else — an HTML 413
 * page from the proxy, a bare string, nothing at all. Spreading such a body with `Object.values`
 * would print its characters one by one.
 */
export function errorBody(e: unknown): Record<string, unknown> | null {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}
