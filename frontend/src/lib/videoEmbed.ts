/**
 * Turn a teacher-pasted video URL into something playable inline.
 *
 * Known hosts (YouTube, Vimeo, Loom, Google Drive) become an embeddable iframe src; a
 * direct video file (.mp4/.webm/...) plays in a <video> tag; anything else falls back to
 * a plain "Open video" link so we never embed an arbitrary/untrusted iframe.
 */

export type VideoEmbed =
  | { kind: "iframe"; src: string; title: string }
  | { kind: "video"; src: string }
  | { kind: "link"; src: string };

export function resolveVideoEmbed(rawUrl: string | null | undefined): VideoEmbed | null {
  const raw = (rawUrl || "").trim();
  if (!raw) return null;

  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  // YouTube — watch / youtu.be / embed / shorts / live
  if (["youtube.com", "m.youtube.com", "youtube-nocookie.com", "youtu.be"].includes(host)) {
    let id = "";
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
    else if (/^\/(embed|shorts|live)\//.test(u.pathname)) id = u.pathname.split("/")[2] || "";
    id = (id || "").split(/[/?&#]/)[0];
    if (id) {
      const t = u.searchParams.get("t") || u.searchParams.get("start") || "";
      const secs = parseInt(t, 10);
      const q = Number.isFinite(secs) && secs > 0 ? `?start=${secs}` : "";
      return {
        kind: "iframe",
        src: `https://www.youtube-nocookie.com/embed/${id}${q}`,
        title: "YouTube video player",
      };
    }
  }

  // Vimeo
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/(\d+)/);
    if (m) {
      return { kind: "iframe", src: `https://player.vimeo.com/video/${m[1]}`, title: "Vimeo video player" };
    }
  }

  // Loom
  if (host === "loom.com") {
    const m = u.pathname.match(/\/(?:share|embed)\/([A-Za-z0-9]+)/);
    if (m) {
      return { kind: "iframe", src: `https://www.loom.com/embed/${m[1]}`, title: "Loom video player" };
    }
  }

  // Google Drive
  if (host === "drive.google.com") {
    const m = u.pathname.match(/\/file\/d\/([^/]+)/);
    const id = (m && m[1]) || u.searchParams.get("id") || "";
    if (id) {
      return { kind: "iframe", src: `https://drive.google.com/file/d/${id}/preview`, title: "Google Drive video player" };
    }
  }

  // Direct video file
  if (/\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(u.pathname)) {
    return { kind: "video", src: u.toString() };
  }

  return { kind: "link", src: u.toString() };
}
