"use client";

/**
 * The story rail — the ring of circles across the top of the dashboard.
 *
 * Styled in the `.dzboard` idiom (inline styles over `--dz-*` tokens) rather than with the
 * shared UI kit, because it sits inside the dashboard and has to belong to it. See the header
 * comment in StudentDashboard.tsx.
 *
 * **The rail hides itself when there is nothing to show, and only then.** A school with no
 * stories posted should not have an empty band of grey circles at the top of every student's
 * screen. But a rail that FAILED to load is not the same thing as a rail with nothing in it,
 * and must not render as one — see the error branch.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useStoryRail } from "@/features/stories/storiesHooks";
import type { Story } from "@/features/stories/storiesApi";

function StoryViewer({
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

  // Escape closes, arrows move. A full-screen overlay that traps a keyboard user is worse
  // than no overlay, and this one covers the whole page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < stories.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, stories.length, onClose, onIndex]);

  if (!story) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={story.title || "Story"}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(8,10,24,.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      {/* Progress pips — which of the set you are on. The only "how many left" signal there
          is, since nothing here tracks what a student has already seen. */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          right: 16,
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
              background: i <= index ? "#fff" : "rgba(255,255,255,.3)",
            }}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: "absolute",
          top: 30,
          right: 16,
          background: "transparent",
          border: 0,
          color: "#fff",
          cursor: "pointer",
          padding: 8,
        }}
      >
        <X size={22} />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460, width: "100%", textAlign: "center" }}
      >
        {story.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={story.image_url}
            alt={story.title || ""}
            style={{
              width: "100%",
              maxHeight: "70vh",
              objectFit: "contain",
              borderRadius: 18,
              background: "rgba(255,255,255,.06)",
            }}
          />
        ) : null}
        {story.title ? (
          <p style={{ color: "#fff", fontWeight: 800, fontSize: 18, marginTop: 16 }}>
            {story.title}
          </p>
        ) : null}
        {story.caption ? (
          <p style={{ color: "rgba(255,255,255,.82)", fontSize: 14, marginTop: 6 }}>
            {story.caption}
          </p>
        ) : null}
        {story.link_url ? (
          <a
            href={story.link_url}
            style={{
              display: "inline-block",
              marginTop: 16,
              padding: "10px 18px",
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

        {/* Prev/next as real buttons rather than tap-zones: a tap-zone that is invisible is
            undiscoverable, and this rail is not something students use every day. */}
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={() => onIndex(index - 1)}
            disabled={index === 0}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,.35)",
              background: "transparent",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              opacity: index === 0 ? 0.4 : 1,
              cursor: index === 0 ? "default" : "pointer",
            }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => onIndex(index + 1)}
            disabled={index >= stories.length - 1}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,.35)",
              background: "transparent",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              opacity: index >= stories.length - 1 ? 0.4 : 1,
              cursor: index >= stories.length - 1 ? "default" : "pointer",
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export function DashboardStories() {
  const stories = useStoryRail();
  const [open, setOpen] = useState<number | null>(null);

  // Loading: render nothing rather than a row of skeleton circles. The rail is optional
  // furniture at the top of the page, and a placeholder that usually resolves to nothing
  // would make every dashboard load look like it is about to show something it is not.
  if (stories.isPending) return null;

  // A failed fetch is NOT an empty rail. Saying so quietly is enough — this is not the
  // student's homework, and a red banner over a noticeboard would be out of proportion — but
  // rendering nothing at all would tell them the school has posted nothing, which is a
  // different and false statement.
  if (stories.isError) {
    return (
      <div style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--dz-mute)" }}>
          Stories didn&apos;t load.{" "}
          <button
            type="button"
            onClick={() => void stories.refetch()}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              color: "var(--dz-indigo)",
              fontWeight: 700,
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </p>
      </div>
    );
  }

  if (stories.data.length === 0) return null;

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 18,
          overflowX: "auto",
          paddingBottom: 6,
          marginBottom: 22,
        }}
      >
        {stories.data.map((story, i) => (
          <button
            key={story.id}
            type="button"
            onClick={() => setOpen(i)}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 7,
              width: 78,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                width: 66,
                height: 66,
                borderRadius: "50%",
                padding: 3,
                background: "linear-gradient(135deg, var(--dz-indigo), #e0559a)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {story.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={story.image_url}
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "2px solid var(--dz-card)",
                  }}
                />
              ) : (
                <span
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "50%",
                    background: "var(--dz-panel)",
                    border: "2px solid var(--dz-card)",
                  }}
                />
              )}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--dz-ink)",
                maxWidth: 78,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {story.title}
            </span>
          </button>
        ))}
      </div>

      {open !== null ? (
        <StoryViewer
          stories={stories.data}
          index={open}
          onClose={() => setOpen(null)}
          onIndex={(i) => setOpen(Math.max(0, Math.min(stories.data.length - 1, i)))}
        />
      ) : null}
    </>
  );
}
