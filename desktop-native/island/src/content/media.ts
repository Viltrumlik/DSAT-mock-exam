// Images for the question card arrive as `media.put` (key, mime, base64) — the island never
// fetches anything (CSP: img-src blob: data:). Each image becomes a blob: URL; every <img>
// that names the key (question figure, option image) is pointed at it, including images in
// questions pre-rendered before the bytes arrived.

export class MediaStore {
  private readonly urls = new Map<string, string>();
  private readonly bound = new Map<string, Set<HTMLImageElement>>();

  constructor(private readonly win: Window & typeof globalThis = window) {}

  get size(): number {
    return this.urls.size;
  }

  has(key: string): boolean {
    return this.urls.has(key);
  }

  url(key: string | null | undefined): string | undefined {
    return key ? this.urls.get(key) : undefined;
  }

  /** Store one image and repoint every bound <img>. Returns its URL. */
  put(key: string, mime: string, b64: string): string {
    const url = this.makeUrl(mime, b64);
    const previous = this.urls.get(key);
    this.urls.set(key, url);
    if (previous && previous.startsWith("blob:")) this.win.URL.revokeObjectURL?.(previous);
    for (const img of this.bound.get(key) ?? []) img.src = url;
    return url;
  }

  /** Point `img` at `key` now, or as soon as its bytes arrive. */
  bind(img: HTMLImageElement, key: string): void {
    img.dataset.mediaKey = key;
    let set = this.bound.get(key);
    if (!set) this.bound.set(key, (set = new Set()));
    set.add(img);
    const url = this.urls.get(key);
    if (url) img.src = url;
  }

  /** Forget image bindings (a new module's cards replace the old ones). URLs are kept. */
  unbindAll(): void {
    this.bound.clear();
  }

  private makeUrl(mime: string, b64: string): string {
    const clean = b64.replace(/\s+/g, "");
    const createObjectURL = this.win.URL?.createObjectURL;
    if (typeof createObjectURL === "function" && typeof this.win.Blob === "function") {
      const bin = this.win.atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return this.win.URL.createObjectURL(new this.win.Blob([bytes], { type: mime }));
    }
    // jsdom has no createObjectURL; data: is equally allowed by the CSP.
    this.win.atob(clean); // still reject malformed base64
    return `data:${mime};base64,${clean}`;
  }
}
