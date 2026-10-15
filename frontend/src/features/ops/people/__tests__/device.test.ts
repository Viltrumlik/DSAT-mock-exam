import { describe, expect, it } from "vitest";

import { describeDevice } from "../device";

/** Real user agents, as `RefreshSession.user_agent` keeps them. */
const CASES: [string, string][] = [
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Chrome on Windows",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Safari on iOS",
  ],
  [
    "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
    "Chrome on Android",
  ],
  ["Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "Firefox on Linux"],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
    "Edge on Windows",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0",
    "Opera on Windows",
  ],
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Safari on macOS",
  ],
  [
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1",
    "Chrome on iOS",
  ],
  [
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Chrome on ChromeOS",
  ],
  [
    "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 Telegram-Android/10.6.2 (Samsung SM-A536B; Android 13; SDK 33; HIGH)",
    "Telegram on Android",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 YaBrowser/24.6.0.0 Safari/537.36",
    "Yandex Browser on Windows",
  ],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Unknown browser on Windows"],
  ["Mozilla/5.0 Firefox/130.0", "Firefox"],
  // Not a browser: the apps and tools name themselves first.
  ["MasterSAT/7 CFNetwork/1568.100.1 Darwin/24.6.0", "MasterSAT/7"],
  ["MasterSAT-Windows/0.2.6", "MasterSAT-Windows/0.2.6"],
  ["curl/8.4.0", "curl/8.4.0"],
  ["", "Unknown device"],
  ["   ", "Unknown device"],
  // What the server used to send for an empty one.
  ["Unknown device", "Unknown device"],
];

describe("describeDevice", () => {
  it.each(CASES)("%s → %s", (ua, label) => {
    expect(describeDevice(ua)).toBe(label);
  });

  it("cuts a long first token to 40 characters", () => {
    const label = describeDevice(`${"x".repeat(60)}/1.0 extra`);
    expect(label).toHaveLength(40);
    expect(label.endsWith("…")).toBe(true);
  });
});
