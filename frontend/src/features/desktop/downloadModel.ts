/**
 * The download page's logic, kept out of React so it can be tested on its own: which computer
 * the visitor is on, and what the release manifest next to the installers says.
 */

export type DownloadPlatform = "windows" | "mac" | "other";

/**
 * The visitor's computer, from the user agent. An iPad asks for desktop sites with a Mac user
 * agent; its touch screen gives it away (a Mac has no touch points). Phones, tablets and
 * Chromebooks are "other": the app runs on neither.
 */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): DownloadPlatform {
  const ua = userAgent.toLowerCase();
  if (/android|iphone|ipad|ipod|cros/.test(ua)) return "other";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("macintosh") || ua.includes("mac os x")) return maxTouchPoints > 1 ? "other" : "mac";
  return "other";
}

export type DownloadFile = { url: string; bytes: number; sha256: string };
export type ReleaseManifest = { version: string; windows: DownloadFile; mac: DownloadFile };

function file(value: unknown): DownloadFile | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.url !== "string" || typeof v.bytes !== "number" || typeof v.sha256 !== "string") return null;
  if (!(v.bytes > 0)) return null;
  return { url: v.url, bytes: v.bytes, sha256: v.sha256 };
}

/** `latest.json`, or null when it is missing a part (the page then shows the plain buttons). */
export function parseManifest(json: unknown): ReleaseManifest | null {
  if (!json || typeof json !== "object") return null;
  const m = json as Record<string, unknown>;
  const windows = file(m.windows);
  const mac = file(m.mac);
  if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+$/.test(m.version) || !windows || !mac) return null;
  return { version: m.version, windows, mac };
}

/** 26329264 → "26 MB". */
export function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}
