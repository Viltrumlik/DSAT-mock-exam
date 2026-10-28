/**
 * A page from an older release asking for a file the current release no longer has.
 *
 * Every deploy builds a fresh set of `/_next/static` chunks under new hashes. A phone that kept
 * the old page open — a Telegram in-app browser tab, a restored Chrome tab — still asks for the
 * old hashes, gets a 404, and Next.js falls over with "Application error: a client-side
 * exception has occurred". Loading the page again fetches the current HTML, which names the
 * current chunks, so a single reload is the whole cure.
 */
const STALE_BUILD_PATTERNS = [
  /ChunkLoadError/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

export function isStaleBuildError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  const text = `${typeof name === "string" ? name : ""} ${typeof message === "string" ? message : ""}`;
  return STALE_BUILD_PATTERNS.some((pattern) => pattern.test(text));
}

const RELOAD_KEY = "mastersat:stale-build-reload-at";
/** Long enough that a release which really is missing a file shows the error page instead of
 *  reloading forever; short enough that the next deploy's stale tab still gets its reload. */
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * Reloads the page once for a stale-build error. Returns false — and leaves the error page up —
 * when it already reloaded within the cooldown, or when storage is unavailable, because then
 * there is no way to tell a first attempt from a loop.
 */
export function reloadOnceForStaleBuild(now: number = Date.now()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (now - last < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
