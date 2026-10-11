// No browser habits (owner decision; architecture.md §2.5): the page-side guards of the content
// island, its media store, and the content pipeline's own hardening.
import { afterEach, describe, expect, it } from "vitest";

import { installHardening, isBrowserKey, scrub } from "../../src/content/hardening";
import { forwardedKey } from "../../src/content/keys";
import { MediaStore } from "../../src/content/media";
import { hardenContent, rewriteMediaSources, safeHtml } from "../../src/ported/safeHtml";
import { loadModule, mountIsland, rwModule, show, type Harness } from "../helpers";

let off: (() => void) | null = null;
let h: Harness | null = null;
afterEach(() => {
  off?.();
  off = null;
  h?.stop();
  h = null;
  document.body.replaceChildren();
});

const fire = (target: EventTarget, e: Event) => {
  target.dispatchEvent(e);
  return e.defaultPrevented;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("document guards", () => {
  function setup(blockCopy = false) {
    document.body.innerHTML = `
      <div id="ts-passage"><p id="p">Passage text</p></div>
      <div id="chrome"><button id="btn">Mark for Review</button></div>
      <input id="spr" />
      <a id="link" href="https://example.com/">a link</a>`;
    off = installHardening(document, { blockCopy: () => blockCopy });
  }

  it("blocks the context menu everywhere", () => {
    setup();
    expect(fire(document.getElementById("p")!, new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))).toBe(true);
    expect(fire(document.getElementById("btn")!, new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))).toBe(true);
  });

  it("lets selection start only inside the highlightable regions and text fields", () => {
    setup();
    expect(fire(document.getElementById("btn")!, new Event("selectstart", { bubbles: true, cancelable: true }))).toBe(true);
    expect(fire(document.getElementById("p")!.firstChild!, new Event("selectstart", { bubbles: true, cancelable: true }))).toBe(false);
    expect(fire(document.getElementById("spr")!, new Event("selectstart", { bubbles: true, cancelable: true }))).toBe(false);
  });

  it("makes links inert, stops drags, drops and middle-click", () => {
    setup();
    expect(fire(document.getElementById("link")!, new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(true);
    expect(fire(document.getElementById("p")!, new Event("dragstart", { bubbles: true, cancelable: true }))).toBe(true);
    expect(fire(document.body, new Event("drop", { bubbles: true, cancelable: true }))).toBe(true);
    expect(fire(document.body, new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 }))).toBe(true);
    expect(fire(document.body, new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))).toBe(false);
    expect(fire(document.body, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }))).toBe(true);
  });

  it("blocks Ctrl+wheel zoom and window.open", () => {
    setup();
    expect(fire(window, new WheelEvent("wheel", { ctrlKey: true, cancelable: true, deltaY: 100 }))).toBe(true);
    expect(fire(window, new WheelEvent("wheel", { cancelable: true, deltaY: 100 }))).toBe(false);
    expect(window.open("https://example.com")).toBeNull();
  });

  it("blocks copy and cut only when asked (midterms)", () => {
    setup(true);
    expect(fire(document.getElementById("p")!, new Event("copy", { bubbles: true, cancelable: true }))).toBe(true);
    expect(fire(document.getElementById("p")!, new Event("cut", { bubbles: true, cancelable: true }))).toBe(true);
    off?.();
    setup(false);
    expect(fire(document.getElementById("p")!, new Event("copy", { bubbles: true, cancelable: true }))).toBe(false);
  });

  it("strips title tooltips and <select> now and whenever they appear", async () => {
    document.body.innerHTML = `<div title="tip"><select><option>1</option></select><span title="x">t</span></div>`;
    off = installHardening(document, { blockCopy: () => false });
    expect(document.querySelector("[title]")).toBeNull();
    expect(document.querySelector("select")).toBeNull();
    const late = document.createElement("div");
    late.innerHTML = `<b title="later">x</b><select></select>`;
    document.body.appendChild(late);
    await tick();
    expect(document.querySelector("[title]")).toBeNull();
    expect(document.querySelector("select")).toBeNull();
    document.body.firstElementChild!.setAttribute("title", "again");
    await tick();
    expect(document.querySelector("[title]")).toBeNull();
  });

  it("uninstalls cleanly", () => {
    setup();
    off!();
    off = null;
    expect(fire(document.getElementById("p")!, new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))).toBe(false);
  });
});

describe("keys", () => {
  const key = (k: string, init: KeyboardEventInit = {}, target?: EventTarget) => {
    const e = new KeyboardEvent("keydown", { key: k, ...init });
    if (target) Object.defineProperty(e, "target", { value: target });
    return e;
  };

  it("isBrowserKey covers reload, find, print, save, zoom, history, caret browsing and dev tools", () => {
    for (const e of [key("F5"), key("F12"), key("F7"), key("F3"), key("r", { ctrlKey: true }), key("R", { ctrlKey: true }), key("f", { ctrlKey: true }), key("p", { metaKey: true }), key("s", { ctrlKey: true }), key("=", { ctrlKey: true }), key("-", { ctrlKey: true }), key("0", { ctrlKey: true }), key("ArrowLeft", { altKey: true }), key("BrowserBack")]) {
      expect(isBrowserKey(e), `${e.key} ctrl=${e.ctrlKey} alt=${e.altKey}`).toBe(true);
    }
    for (const e of [key("a"), key("ArrowLeft"), key("Escape"), key("Enter")]) expect(isBrowserKey(e)).toBe(false);
  });

  it("keeps editing keys inside a text field, but still swallows reload there", () => {
    const input = document.createElement("input");
    for (const k of ["a", "c", "v", "x", "z"]) expect(isBrowserKey(key(k, { ctrlKey: true }, input))).toBe(false);
    expect(isBrowserKey(key("Backspace", {}, input))).toBe(false);
    expect(isBrowserKey(key("r", { ctrlKey: true }, input))).toBe(true);
    expect(isBrowserKey(key("Backspace", {}, document.body))).toBe(true);
  });

  it("forwardedKey maps Shift letters to the same key and ignores composing input", () => {
    expect(forwardedKey(key("D"))).toBe("d");
    expect(forwardedKey(key("?", { shiftKey: true }))).toBe("?");
    expect(forwardedKey(key("a", { isComposing: true }))).toBeNull();
    expect(forwardedKey(key("e"))).toBeNull();
  });
});

describe("media", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("put → a URL, bound images follow, later puts repoint them", () => {
    const store = new MediaStore(window as Window & typeof globalThis);
    const img = document.createElement("img");
    store.bind(img, "fig.png");
    expect(img.getAttribute("src")).toBeNull();
    const url = store.put("fig.png", "image/png", PNG);
    expect(img.src).toBe(url);
    expect(img.dataset.mediaKey).toBe("fig.png");
    const url2 = store.put("fig.png", "image/png", PNG);
    expect(img.src).toBe(url2);
    expect(store.size).toBe(1);
  });

  it("rejects bytes that are not base64", () => {
    const store = new MediaStore(window as Window & typeof globalThis);
    expect(() => store.put("bad", "image/png", "@@not base64@@")).toThrow();
  });

  it("media:<key> sources in content survive sanitising and bind to media.put", () => {
    expect(rewriteMediaSources('<img src="media:a/b.png" alt="x">')).toBe('<img data-ms-media="a/b.png" alt="x">');
    const store = new MediaStore(window as Window & typeof globalThis);
    store.put("a/b.png", "image/png", PNG);
    const el = safeHtml('<p>See <img src="media:a/b.png" alt="figure"></p>', { media: store });
    const img = el.querySelector("img")!;
    expect(img.src).toBe(store.url("a/b.png"));
    expect(img.getAttribute("draggable")).toBe("false");
  });

  it("an image named by media.put on a fixture question is shown from its blob/data URL", () => {
    h = mountIsland();
    const m = rwModule();
    const qs = loadModule(h, m);
    const q = qs.find((x) => x.question_image_key)!;
    show(h, q, qs.indexOf(q), qs.length);
    const img = h.island.main.querySelector("img")!;
    expect(img.src).toBe(h.island.media.url(q.question_image_key));
  });
});

describe("content pipeline hardening", () => {
  it("sanitises scripts and handlers away, and neutralises links, tooltips, selects and stray controls", () => {
    const el = safeHtml(
      '<p title="t" onclick="alert(1)">x<script>alert(2)</script><a href="https://example.com" target="_blank">l</a><select><option>o</option></select><button>b</button><img src="x.png" onerror="alert(3)"></p>',
    );
    expect(el.querySelector("script")).toBeNull();
    expect(el.innerHTML).not.toContain("onclick");
    expect(el.innerHTML).not.toContain("onerror");
    expect(el.querySelector("[title]")).toBeNull();
    expect(el.querySelector("select")).toBeNull();
    const a = el.querySelector("a")!;
    expect(a.hasAttribute("href")).toBe(false);
    expect(a.hasAttribute("target")).toBe(false);
    const b = el.querySelector("button")!;
    expect(b.type).toBe("button");
    expect(b.getAttribute("tabindex")).toBe("-1");
  });

  it("hardenContent never changes text (so stored highlight offsets stay valid)", () => {
    const div = document.createElement("div");
    div.innerHTML = '<p title="a">One <a href="#">two</a> <b title="b">three</b></p>';
    const before = div.textContent;
    hardenContent(div);
    scrub(div);
    expect(div.textContent).toBe(before);
  });
});
