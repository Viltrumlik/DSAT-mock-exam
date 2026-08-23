"use client";

/**
 * A YouTube player that does not load YouTube until somebody presses play.
 *
 * The iframe is replaced by a poster image and a play button until the first click. That is
 * not a performance nicety here — it is the point. Every student who opens the registration
 * dialog would otherwise be handed to Google's trackers whether or not they watch, and this
 * app's users are schoolchildren. Pressing play is a choice; opening a dialog is not.
 *
 * The player runs on `youtube-nocookie.com`, YouTube's privacy-enhanced host, for the same
 * reason. Both hosts and the thumbnail CDN are allowlisted in
 * `backend/config/security_headers.py` — without those entries `default-src 'self'` blocks
 * the embed the day `CSP_ENFORCE` is turned on.
 */

import { useState } from "react";
import { Play } from "lucide-react";

export function YouTubeEmbed({ videoId, title }: { videoId: string; title: string }) {
  const [playing, setPlaying] = useState(false);

  // `hqdefault` rather than `maxresdefault`: not every video has a max-res thumbnail, and a
  // missing one renders as a grey box rather than falling back.
  const poster = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-surface-2">
      {playing ? (
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group absolute inset-0 h-full w-full cursor-pointer border-0 p-0"
          aria-label={`Play: ${title}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={poster}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/30 transition group-hover:bg-black/40">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-lg">
              <Play className="ml-0.5 h-6 w-6 fill-current text-black" aria-hidden />
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
