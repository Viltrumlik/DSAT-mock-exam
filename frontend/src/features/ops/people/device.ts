/**
 * "Chrome on Windows" out of a sign-in's user agent, for the person page's device list.
 *
 * Order matters in both lookups: Edge, Opera, Yandex and Samsung Internet all also say "Chrome",
 * Chrome also says "Safari", and Android and ChromeOS also say "Linux". The student's own device
 * list has a sibling (features/profile/profileModel.ts `describeDevice`) that calls every
 * MasterSAT user agent the iPhone app; ops shows what the app sent ("MasterSAT-Windows/0.2.6").
 */

const BROWSERS: [RegExp, string][] = [
  [/Telegram-(Android|iOS)\//, "Telegram"],
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|OPT\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/YaBrowser\//, "Yandex Browser"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Version\/[\d.]+.*Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux|X11/, "Linux"],
];

const MAX = 40;

const first = (table: [RegExp, string][], ua: string) => table.find(([re]) => re.test(ua))?.[1] ?? null;
const cut = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);

export function describeDevice(ua: string): string {
  const s = (ua ?? "").trim();
  if (!s) return "Unknown device";
  // No "name/version" token at all: not a user agent, say it as it is.
  if (!s.includes("/")) return cut(s);
  // Every browser opens with "Mozilla/5.0" (old Opera with "Opera/"); anything else — the apps,
  // curl — names itself in its first token.
  if (!/^(Mozilla|Opera)\//.test(s)) return cut(s.split(/\s+/)[0]);
  const browser = first(BROWSERS, s);
  const os = first(SYSTEMS, s);
  if (browser && os) return `${browser} on ${os}`;
  if (os) return `Unknown browser on ${os}`;
  return browser ?? "Unknown browser";
}
