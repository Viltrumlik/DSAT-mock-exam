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

import { useState } from "react";
import { useStoryRail } from "@/features/stories/storiesHooks";
// The viewer is FULL-SCREEN and lives in features/stories. It was an inline 460px
// lightbox in this file before, which on a phone showed the picture at about a third of
// the screen with grey around it — see the header comment there.
import { StoryViewer } from "@/features/stories/StoryViewer";

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
          // No clamping here any more: the viewer owns its own bounds — running off the end
          // closes it, the way a story set ends everywhere else — and a clamp on this side
          // would silently pin it to the last slide instead.
          onIndex={setOpen}
        />
      ) : null}
    </>
  );
}
