/**
 * /download: both apps are always one click away; the visitor's own computer
 * leads; version and size come from latest.json, and the page works without it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DESKTOP_DOWNLOAD_URL, DESKTOP_MAC_DOWNLOAD_URL } from "@/lib/desktop/routes";

import { DownloadPage } from "../DownloadPage";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const MANIFEST = {
  version: "0.3.1",
  windows: { url: DESKTOP_DOWNLOAD_URL, bytes: 26329264, sha256: "4c35b2f6".padEnd(64, "0") },
  mac: { url: DESKTOP_MAC_DOWNLOAD_URL, bytes: 31818348, sha256: "a3daa4bd".padEnd(64, "0") },
};

let container: HTMLDivElement;
let root: Root;
const realUserAgent = navigator.userAgent;

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

async function render() {
  await act(async () => {
    root.render(<DownloadPage />);
  });
  // Let the manifest fetch settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const card = (id: "windows" | "mac") => container.querySelector(`[aria-labelledby="download-${id}"]`)!;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setUserAgent(realUserAgent);
  vi.unstubAllGlobals();
});

describe("DownloadPage", () => {
  it("links both apps, and the Windows card leads on a Windows computer", async () => {
    setUserAgent(WINDOWS);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => MANIFEST })));
    await render();

    const links = [...container.querySelectorAll("a")].map((a) => [a.textContent?.trim(), a.getAttribute("href")]);
    expect(links).toContainEqual(["Download for Windows", DESKTOP_DOWNLOAD_URL]);
    expect(links).toContainEqual(["Download for Mac", DESKTOP_MAC_DOWNLOAD_URL]);
    expect(card("windows").getAttribute("data-recommended")).toBe("true");
    expect(card("mac").getAttribute("data-recommended")).toBe("false");
    expect(card("windows").textContent).toContain("This computer");
  });

  it("the Mac card leads on a Mac", async () => {
    setUserAgent(MAC);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => MANIFEST })));
    await render();

    expect(card("mac").getAttribute("data-recommended")).toBe("true");
    expect(card("windows").getAttribute("data-recommended")).toBe("false");
  });

  it("shows the version and sizes from latest.json", async () => {
    setUserAgent(WINDOWS);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => MANIFEST })));
    await render();

    expect(container.textContent).toContain("Version 0.3.1");
    expect(card("windows").textContent).toContain("26 MB");
    expect(card("mac").textContent).toContain("32 MB");
  });

  it("without latest.json the buttons still work, with no version line", async () => {
    setUserAgent(WINDOWS);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await render();

    expect(container.querySelector(`a[href="${DESKTOP_DOWNLOAD_URL}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="${DESKTOP_MAC_DOWNLOAD_URL}"]`)).not.toBeNull();
    expect(container.textContent).not.toContain("Version");
    expect(container.textContent).not.toContain("MB");
  });
});
