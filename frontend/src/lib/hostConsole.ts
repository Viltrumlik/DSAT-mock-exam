/**
 * Pure host parsing for LMS console routing (middleware + Server Components).
 * Expects a Host / X-Forwarded-Host style value (may include port).
 */
export type LmsConsoleKind = "admin" | "questions";

export function getConsoleFromHostHeader(host: string | null): LmsConsoleKind | null {
  if (!host) return null;
  const h = host.split(":")[0].toLowerCase();
  const labels = h.split(".").filter(Boolean);
  if (!labels.length) return null;
  if (labels[0] === "admin" || h.startsWith("admin.")) return "admin";
  if (labels[0] === "questions" || h.startsWith("questions.")) return "questions";
  if (labels.length >= 2 && labels[1] === "questions") return "questions";
  return null;
}

export function isQuestionsHost(host: string | null): boolean {
  return getConsoleFromHostHeader(host) === "questions";
}
