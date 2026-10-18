import { describe, expect, it } from "vitest";

import { detectPlatform, formatSize, parseManifest } from "../downloadModel";

const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";
const CHROMEBOOK = "Mozilla/5.0 (X11; CrOS x86_64 15917.71.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

const file = (name: string, bytes: number) => ({ url: `https://mastersat.uz/downloads/desktop/${name}`, bytes, sha256: "a".repeat(64) });

describe("detectPlatform", () => {
  it("tells Windows and Mac computers apart", () => {
    expect(detectPlatform(WINDOWS)).toBe("windows");
    expect(detectPlatform(MAC)).toBe("mac");
  });

  it("an iPad asking for the desktop site is not a Mac: it has a touch screen", () => {
    expect(detectPlatform(MAC, 5)).toBe("other");
  });

  it("phones and Chromebooks run neither app", () => {
    expect(detectPlatform(IPHONE)).toBe("other");
    expect(detectPlatform(ANDROID)).toBe("other");
    expect(detectPlatform(CHROMEBOOK)).toBe("other");
    expect(detectPlatform("")).toBe("other");
  });
});

describe("parseManifest", () => {
  const good = { version: "0.3.1", windows: file("MasterSAT-Setup.exe", 26329264), mac: file("MasterSAT.dmg", 31818348) };

  it("reads latest.json", () => {
    expect(parseManifest(good)).toEqual(good);
  });

  it("gives up on anything incomplete, so the page falls back to the plain buttons", () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest("0.3.1")).toBeNull();
    expect(parseManifest({ ...good, version: "latest" })).toBeNull();
    expect(parseManifest({ ...good, mac: undefined })).toBeNull();
    expect(parseManifest({ ...good, windows: { ...good.windows, bytes: 0 } })).toBeNull();
    expect(parseManifest({ ...good, windows: { ...good.windows, sha256: 5 } })).toBeNull();
  });
});

describe("formatSize", () => {
  it("rounds to whole megabytes", () => {
    expect(formatSize(26329264)).toBe("26 MB");
    expect(formatSize(31818348)).toBe("32 MB");
    expect(formatSize(1200)).toBe("1 MB");
  });
});
