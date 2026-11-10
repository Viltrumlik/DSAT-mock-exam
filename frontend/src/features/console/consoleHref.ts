/** The two consoles. Their home paths are fixed; on the live site each also has its own host. */
export type ConsoleName = "admin" | "builder";

const ROOT: Record<ConsoleName, string> = { admin: "/ops", builder: "/builder" };
const HOST_PREFIX: Record<ConsoleName, string> = { admin: "admin.", builder: "questions." };

/**
 * Where the top bar's console switch (and ⌘K's "Switch to …") goes. On the live site Admin is
 * admin.<domain> and the Builder questions.<domain>, so the switch changes host; anywhere else
 * (localhost, a preview) both consoles share one origin and it is just the other home path.
 */
export function consoleHref(target: ConsoleName, location: { protocol: string; host: string }): string {
  for (const prefix of Object.values(HOST_PREFIX)) {
    if (location.host.startsWith(prefix)) {
      const domain = location.host.slice(prefix.length);
      return `${location.protocol}//${HOST_PREFIX[target]}${domain}${ROOT[target]}`;
    }
  }
  return ROOT[target];
}

/**
 * Whether this person may open `target` — the same role rule AuthGuard applies, so the switch never
 * leads somewhere that bounces them: a test admin works in the Builder only (AuthGuard sends them
 * away from the Admin console), and students belong to neither console.
 */
export function canOpenConsole(target: ConsoleName, me: Record<string, unknown> | null | undefined): boolean {
  const role = String(me?.role ?? "").trim().toLowerCase();
  if (role === "student" || role === "public_student") return false;
  if (target === "admin" && role === "test_admin") return false;
  return true;
}
