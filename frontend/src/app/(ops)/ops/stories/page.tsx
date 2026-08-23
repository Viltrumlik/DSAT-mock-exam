"use client";

/**
 * /ops/stories — put a notice on every student's dashboard.
 *
 * Built as a sibling of /ops/shop, which is the closest existing job: an admin-authored list
 * with a picture, an active flag and a sort order, feeding a student-facing surface.
 *
 * The one thing this page has that shop does not is a publish WINDOW, and the whole design of
 * the list is bent around making that legible. A story can be saved-but-not-showing for three
 * different reasons — unticked, not started yet, already finished — and an admin who cannot
 * tell those apart at a glance will re-upload a story that was going to appear on Friday. So
 * the server computes `is_live` and every row says plainly which of the four states it is in.
 */

import { useState } from "react";
import { CalendarClock, Image as ImageIcon, ImagePlus, Pencil, Trash2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { useAdminStories, useDeleteStory, useSaveStory } from "@/features/stories/storiesHooks";
import type { BadgeVariant } from "@/components/ui";
import type { Story } from "@/features/stories/storiesApi";

const EMPTY = {
  title: "",
  caption: "",
  link_url: "",
  sort_order: "0",
  starts_at: "",
  ends_at: "",
  is_active: true,
};

/**
 * `datetime-local` speaks "YYYY-MM-DDTHH:mm" in LOCAL time with no zone; the API speaks ISO
 * with one. These two helpers are the only place that gap is crossed.
 *
 * Going out we hand the browser the local wall-clock reading of the instant, because an admin
 * setting "Friday 09:00" means Friday 09:00 in Tashkent, not in UTC. Coming back we let
 * `new Date(...)` interpret the field in the viewer's own zone and send the resulting instant.
 * Round-tripping is therefore lossless for the person who typed it, which is the only
 * property that matters here.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Why a story is not on the rail — or that it is. The server owns `is_live`; this only
 *  explains it, and never re-derives it. */
function statusOf(story: Story): { variant: BadgeVariant; label: string } {
  if (story.is_live) return { variant: "success", label: "Showing now" };
  if (!story.is_active) return { variant: "neutral", label: "Hidden" };
  const now = Date.now();
  if (story.starts_at && new Date(story.starts_at).getTime() > now) {
    return { variant: "warning", label: "Scheduled" };
  }
  if (story.ends_at && new Date(story.ends_at).getTime() <= now) {
    return { variant: "neutral", label: "Finished" };
  }
  // Active, inside its window, and still not live. The only way to reach here is a clock skew
  // between this browser and the server. Say so rather than inventing a reason.
  return { variant: "neutral", label: "Not showing" };
}

function StoryForm({ story, onClose }: { story: Story | null; onClose: () => void }) {
  const save = useSaveStory();
  const [form, setForm] = useState(
    story
      ? {
          title: story.title,
          caption: story.caption,
          link_url: story.link_url,
          sort_order: String(story.sort_order),
          starts_at: toLocalInput(story.starts_at),
          ends_at: toLocalInput(story.ends_at),
          is_active: story.is_active,
        }
      : EMPTY,
  );
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    // A picture is REQUIRED on create and optional on edit — the API enforces both, but
    // saying so here saves a round trip and gives the admin the sentence in the right place.
    if (!story && !file) {
      setError("Pick a picture — the picture is the story.");
      return;
    }

    const fields: Record<string, unknown> = {
      title: form.title,
      caption: form.caption,
      link_url: form.link_url,
      sort_order: Number(form.sort_order),
      is_active: form.is_active,
      starts_at: fromLocalInput(form.starts_at),
      ends_at: fromLocalInput(form.ends_at),
    };

    // FormData only when there is a file, exactly as /ops/shop does: a bare JSON body reads
    // better in the network tab, and axios must own the multipart boundary when there is one.
    let body: FormData | Record<string, unknown>;
    if (file) {
      const fd = new FormData();
      Object.entries(fields).forEach(([k, v]) => {
        // An empty window end must reach the server as "", which DRF reads as null. Sending
        // the string "null" would set the field to that literal and schedule the story to
        // vanish at an unparseable date.
        fd.append(k, v === null ? "" : String(v));
      });
      fd.append("image", file);
      body = fd;
    } else {
      body = fields;
    }

    save.mutate(
      { id: story?.id, body },
      {
        onSuccess: onClose,
        onError: (e) => {
          const data = (e as { response?: { data?: Record<string, string[]> } })?.response?.data;
          setError(
            data ? Object.values(data).flat().join(" ") : "Couldn't save that. Try again.",
          );
        },
      },
    );
  };

  return (
    <Modal open onClose={onClose} title={story ? "Edit story" : "Add a story"}>
      <div className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Title" hint="The word under the circle. Keep it short.">
          <Input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Caption" hint="What a student reads once they have opened it.">
          <Textarea
            rows={3}
            value={form.caption}
            onChange={(e) => setForm({ ...form, caption: e.target.value })}
          />
        </Field>
        <Field
          label="Picture"
          hint={story ? "Leave empty to keep the current one." : "Required — this is the story."}
        >
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </Field>
        <Field label="Link" hint="Optional. Where tapping the story takes a student.">
          <Input
            placeholder="/shop"
            value={form.link_url}
            onChange={(e) => setForm({ ...form, link_url: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" hint="Empty = show it straight away.">
            <Input
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
            />
          </Field>
          <Field label="Ends" hint="Empty = leave it up.">
            <Input
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Sort order" hint="Lower shows first on the rail.">
          <Input
            type="number"
            value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Show on the dashboard
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function OpsStoriesPage() {
  const stories = useAdminStories();
  const remove = useDeleteStory();
  // `undefined` = the modal is closed; `null` = open on a new story; a Story = open on that
  // one. Three states in one variable, which is the same trick /ops/shop uses.
  const [editing, setEditing] = useState<Story | null | undefined>(undefined);

  const liveCount = stories.data?.filter((s) => s.is_live).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Stories</h1>
          <p className="text-sm font-medium text-muted-foreground">
            The ring of circles across the top of every student&apos;s dashboard.
          </p>
        </div>
        <Button onClick={() => setEditing(null)}>
          <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden />
          Add a story
        </Button>
      </div>

      <Card className="space-y-3">
        <h2 className="text-base font-extrabold">
          All stories
          {liveCount > 0 ? (
            <span className="ml-2 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-extrabold text-primary">
              {liveCount} showing
            </span>
          ) : null}
        </h2>

        {/* Four branches: loading, error, empty, data. An error rendered as "no stories yet"
            would tell an admin their noticeboard is empty when in fact it failed to load —
            and the obvious next move, posting the notice again, is exactly the wrong one. */}
        {stories.isPending ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : stories.isError ? (
          <Alert tone="danger">
            The stories didn&apos;t load.{" "}
            <button className="underline" onClick={() => void stories.refetch()}>
              Try again
            </button>
          </Alert>
        ) : stories.data.length === 0 ? (
          <p className="text-sm font-semibold text-muted-foreground">
            No stories yet — add one and it appears on every student&apos;s dashboard.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {stories.data.map((story) => {
              const status = statusOf(story);
              return (
                <li
                  key={story.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3"
                >
                  {/* A plain <img>, not next/image: these are signed R2 URLs on a host the
                      image optimiser is not configured for, and an un-optimisable remote
                      source is a build-time error rather than a graceful fallback. */}
                  {story.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={story.image_url}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-primary/30"
                    />
                  ) : (
                    <span
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                      title="Saved without a picture"
                    >
                      <ImageIcon className="h-5 w-5" aria-hidden />
                    </span>
                  )}

                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      {story.title || <span className="text-muted-foreground">Untitled</span>}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-muted-foreground">
                      <Badge variant={status.variant}>{status.label}</Badge>
                      <span>#{story.sort_order}</span>
                      {story.starts_at || story.ends_at ? (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="h-3 w-3" aria-hidden />
                          {story.starts_at
                            ? new Date(story.starts_at).toLocaleDateString()
                            : "now"}
                          {" – "}
                          {story.ends_at ? new Date(story.ends_at).toLocaleDateString() : "open"}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  {/* Editing is the routine act and destruction is the exception, so only one
                      of these is a button. Same weighting as the shop's order rows. */}
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(story)}>
                      <Pencil className="mr-1.5 h-4 w-4" aria-hidden />
                      Edit
                    </Button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground underline-offset-2 hover:text-danger hover:underline"
                      onClick={() => {
                        if (window.confirm(`Delete "${story.title}"? This cannot be undone.`)) {
                          remove.mutate(story.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editing !== undefined ? (
        <StoryForm story={editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </div>
  );
}
