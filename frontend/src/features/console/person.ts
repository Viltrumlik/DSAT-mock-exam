/** `useMe` types the payload as an open record, so the fields are narrowed here. */
export type MeLike = Record<string, unknown> | null | undefined;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** "First Last", else the username, else the email — whatever the account has. */
export function displayName(me: MeLike): string {
  if (!me) return "";
  const full = [str(me.first_name), str(me.last_name)].filter(Boolean).join(" ");
  return full || str(me.username) || str(me.email);
}

/** Two letters for the avatar: first and last name, else the first two of whatever name there is. */
export function initials(me: MeLike): string {
  const first = str(me?.first_name);
  const last = str(me?.last_name);
  if (first || last) return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
  const name = displayName(me).replace(/[^\p{L}\p{N}]/gu, "");
  return name.slice(0, 2).toUpperCase() || "?";
}

const ROLE_WORDS: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Desk admin",
  teacher: "Teacher",
  test_admin: "Test admin",
  test_auditor: "Auditor",
};

/** The role in plain words for the top bar. */
export function roleLabel(me: MeLike): string {
  const role = str(me?.role).toLowerCase();
  if (role === "admin" && me?.is_superuser) return ROLE_WORDS.super_admin;
  return ROLE_WORDS[role] ?? (role ? role.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "");
}

/** Auditors can open everything and change nothing (design handoff v0.3, Main · C). */
export function isReadOnly(me: MeLike): boolean {
  return str(me?.role).toLowerCase() === "test_auditor";
}

/** One of the six muted avatar tones, steady per person (never a status hue). */
export function avatarTone(me: MeLike): 1 | 2 | 3 | 4 | 5 | 6 {
  const key = String(me?.id ?? displayName(me));
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ((h % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}
