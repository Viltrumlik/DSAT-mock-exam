"use client";

import { ExternalLink } from "lucide-react";
import { resolveVideoEmbed } from "@/lib/videoEmbed";

/**
 * Inline lesson-video player. Embeds YouTube/Vimeo/Loom/Drive, plays a direct video file,
 * or falls back to an "Open video" link for anything else. Renders a responsive 16:9 frame.
 * Returns null for an empty/invalid URL, so callers can gate purely on `url`.
 */
export default function VideoPlayer({ url, className = "" }: { url?: string | null; className?: string }) {
  const embed = resolveVideoEmbed(url);
  if (!embed) return null;

  if (embed.kind === "link") {
    return (
      <a
        href={embed.src}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline ${className}`}
      >
        <ExternalLink className="h-4 w-4 shrink-0" /> Open video
      </a>
    );
  }

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl bg-black ${className}`}
      style={{ aspectRatio: "16 / 9" }}
    >
      {embed.kind === "iframe" ? (
        <iframe
          src={embed.src}
          title={embed.title}
          className="absolute inset-0 h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
        />
      ) : (
        <video src={embed.src} controls playsInline className="absolute inset-0 h-full w-full" />
      )}
    </div>
  );
}
