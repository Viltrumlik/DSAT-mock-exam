"use client";

/**
 * The full-screen story viewer — the thing that opens when a student taps a circle.
 *
 * It used to be a card floating in the middle of a dim overlay: 460px wide, the image capped
 * at 70vh, with "Back" and "Next" buttons underneath. That is a lightbox, not a story, and on
 * the phone most of this school uses it left the picture occupying about a third of the screen
 * with grey around it.
 *
 * So this fills the viewport, and everything follows from that one decision:
 *
 *   * **The image gets the whole screen** and is `contain`-fitted inside it, so a portrait
 *     photo fills a portrait phone and a landscape poster still fits without cropping. Never
 *     `cover` — these are posters and announcements with text on them, and cropping one is
 *     how the date at the bottom of a notice disappears.
 *   * **Tap zones replace the buttons.** Left third goes back, right two-thirds go forward,
 *     which is the gesture every student already knows. The buttons remain underneath as real
 *     focusable controls for keyboards and screen readers — a tap zone is invisible, and
 *     invisible controls are not controls for everybody.
 *   * **It advances on its own**, because a story that requires a tap per slide is a gallery.
 *     Holding pauses it, which is the other half of that gesture: the reason to hold is that
 *     you are still reading.
 *
 * `100dvh`, not `100vh`: on mobile Safari `vh` is the tallest the viewport ever gets, so the
 * last slice of a `100vh` layer sits underneath the browser's own toolbar — which is exactly
 * where the caption is.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import type { Story } from "./storiesApi";

/** How long one story holds the screen before moving on. */
const ADVANCE_MS = 6000;
/** The progress bar is redrawn on this cadence — smooth enough, cheap enough. */
const TICK_MS = 50;

export function StoryViewer({
  stories,
  index,
  onClose,
  onIndex,
}: {
  stories: Story[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const story = stories[index];
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mounted, setMounted] = useState(false);
  // `onClose` is passed as an inline arrow, so it is a new function every render. Held in a
  // ref and read only from the timer, so that `go` stays stable — depending on it directly
  // would rebuild `go` each render, and the auto-advance interval below is keyed on `go`, so
  // the countdown would restart on every render and never reach the end.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Portalled to <body>. `position: fixed` is only fixed to the VIEWPORT while no ancestor
  // has a transform, filter or backdrop-filter — any of those makes it fixed to that ancestor
  // instead, and this renders deep inside the app shell's <main>. A story that is 90% of the
  // screen because a parent card is animating is exactly the bug this rewrite is fixing.
  // Mounted-after-effect so the server render matches the first client render.
  useEffect(() => setMounted(true), []);

  const go = useCallback(
    (next: number) => {
      if (next < 0) return;
      // Past the last story closes the viewer, the way a story set ends everywhere else.
      // Stopping dead on the final slide leaves the student to find the X themselves.
      if (next >= stories.length) {
        closeRef.current();
        return;
      }
      onIndex(next);
    },
    [stories.length, onIndex],
  );

  // Escape closes, arrows move. A full-screen overlay that traps a keyboard user is worse
  // than no overlay, and this one covers the whole page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go, onClose]);

  // The page behind must not scroll while this is up. Without it a phone scrolls the
  // dashboard under the overlay and the student closes the story somewhere they never were.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Auto-advance. Reset on every index change so each story gets its own full turn.
  useEffect(() => {
    setProgress(0);
  }, [index]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setProgress((p) => {
        const next = p + (TICK_MS / ADVANCE_MS) * 100;
        if (next >= 100) {
          // Deferred out of the state updater: advancing synchronously here would call a
          // parent setState during this component's render phase, which React warns about
          // and which can drop the update.
          window.setTimeout(() => go(index + 1), 0);
          return 100;
        }
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [index, paused, go]);

  if (!story || !mounted) return null;

  const hold = () => setPaused(true);
  const release = () => setPaused(false);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={story.title || "Story"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        height: "100dvh",
        width: "100vw",
        background: "#000",
        display: "flex",
        flexDirection: "column",
        overscrollBehavior: "contain",
      }}
    >
      {/* Progress pips — one per story, the current one filling as it plays. */}
      <div
        style={{
          position: "absolute",
          top: "max(10px, env(safe-area-inset-top))",
          left: 10,
          right: 10,
          zIndex: 3,
          display: "flex",
          gap: 4,
        }}
      >
        {stories.map((s, i) => (
          <span
            key={s.id}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 999,
              background: "rgba(255,255,255,.32)",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                display: "block",
                height: "100%",
                borderRadius: 999,
                background: "#fff",
                width: i < index ? "100%" : i === index ? `${progress}%` : "0%",
                // Only the live bar animates. Transitioning the others makes the whole row
                // slide about whenever the student skips.
                transition: i === index ? `width ${TICK_MS}ms linear` : "none",
              }}
            />
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: "absolute",
          top: "calc(max(10px, env(safe-area-inset-top)) + 16px)",
          right: 8,
          zIndex: 4,
          background: "transparent",
          border: 0,
          color: "#fff",
          cursor: "pointer",
          padding: 10,
          lineHeight: 0,
        }}
      >
        <X size={26} />
      </button>

      {/* The picture. `flex: 1` with `minHeight: 0` so it takes the space the caption does
          not — without the min-height a flex child refuses to shrink below its content and
          the caption gets pushed off a short screen. */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {story.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={story.image_url}
            alt={story.title || ""}
            draggable={false}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              width: "auto",
              height: "auto",
              objectFit: "contain",
              userSelect: "none",
            }}
          />
        ) : (
          <div style={{ padding: 32, textAlign: "center" }}>
            <p style={{ color: "#fff", fontWeight: 800, fontSize: 22 }}>{story.title}</p>
          </div>
        )}

        {/* Tap zones. Above the image, below the buttons — hence the explicit z-index on
            everything that must stay clickable. */}
        <button
          type="button"
          aria-label="Previous story"
          onClick={() => go(index - 1)}
          onPointerDown={hold}
          onPointerUp={release}
          onPointerLeave={release}
          style={{ ...ZONE, left: 0, width: "33%" }}
        />
        <button
          type="button"
          aria-label="Next story"
          onClick={() => go(index + 1)}
          onPointerDown={hold}
          onPointerUp={release}
          onPointerLeave={release}
          style={{ ...ZONE, right: 0, width: "67%" }}
        />

        {/* Visible arrows on wide screens. A tap zone is undiscoverable with a mouse, where
            there is no muscle memory to fall back on. */}
        {index > 0 ? (
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => go(index - 1)}
            style={{ ...ARROW, left: 10 }}
            className="hidden md:flex"
          >
            <ChevronLeft size={20} />
          </button>
        ) : null}
        {index < stories.length - 1 ? (
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => go(index + 1)}
            style={{ ...ARROW, right: 10 }}
            className="hidden md:flex"
          >
            <ChevronRight size={20} />
          </button>
        ) : null}
      </div>

      {/* Caption. Its own band under the image rather than floating over it: these are school
          notices, and text laid over an arbitrary photograph is a contrast gamble that some
          of them will lose. */}
      {story.title || story.caption || story.link_url ? (
        <div
          style={{
            position: "relative",
            zIndex: 3,
            padding: "14px 18px calc(18px + env(safe-area-inset-bottom))",
            background: "linear-gradient(to top, rgba(0,0,0,.92), rgba(0,0,0,0))",
            textAlign: "center",
          }}
        >
          {story.title ? (
            <p style={{ color: "#fff", fontWeight: 800, fontSize: 17, margin: 0 }}>
              {story.title}
            </p>
          ) : null}
          {story.caption ? (
            <p
              style={{
                color: "rgba(255,255,255,.85)",
                fontSize: 14,
                fontWeight: 500,
                margin: "5px 0 0",
              }}
            >
              {story.caption}
            </p>
          ) : null}
          {story.link_url ? (
            <a
              href={story.link_url}
              // Opens away from the story rather than navigating the app out from under it.
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-block",
                marginTop: 12,
                padding: "9px 20px",
                borderRadius: 999,
                background: "#fff",
                color: "#111",
                fontWeight: 800,
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Open
            </a>
          ) : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/** A transparent half of the screen that moves the story along. */
const ZONE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  zIndex: 2,
  background: "transparent",
  border: 0,
  padding: 0,
  cursor: "pointer",
  // No focus ring: these duplicate the arrow controls and the Escape/arrow keys, and a
  // keyboard user tabbing into an invisible full-height button has no idea what it is.
  outline: "none",
};

const ARROW: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  zIndex: 3,
  height: 36,
  width: 36,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,.25)",
  background: "rgba(0,0,0,.35)",
  color: "#fff",
  cursor: "pointer",
};

export default StoryViewer;
