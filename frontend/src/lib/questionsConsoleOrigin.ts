/**
 * URL for the questions authoring console (subdomain). Used for CTAs from the main LMS.
 */
export function getQuestionsConsoleOrigin(): string {
  const env = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_QUESTIONS_CONSOLE_ORIGIN?.trim() : "";
  if (env) return env.replace(/\/$/, "");

  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location;
    const labels = hostname.split(".").filter(Boolean);
    if (labels[0] === "questions") return `${protocol}//${hostname}`;
    if (labels.length >= 2) {
      const rest = labels.slice(1).join(".");
      return `${protocol}//questions.${rest}`;
    }
  }

  return "";
}
