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
 *
 * In the console's look (design handoff v0.3): a card with a caption row, the console's badges,
 * form dialog and confirm dialog. The words, the window's time handling and the calls are the
 * page's own.
 */

import { useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Badge, Button, ConfirmDialog, EmptyState, type BadgeTone } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import {
  AREA,
  CaptionCount,
  CheckRow,
  FILE_INPUT,
  FormDialog,
  FormField,
  LoadFailed,
  Notice,
  Panel,
  SkeletonRows,
} from "@/features/ops/settings/settingsParts";
import { CONTROL } from "@/features/questionsAdmin/questionLook";
import { useAdminStories, useDeleteStory, useSaveStory } from "@/features/stories/storiesHooks";
import { fromLocalInput, toLocalInput } from "@/lib/datetimeLocal";
import { SCHOOL_TIME_ZONE } from "@/lib/schoolTime";
import type { Story } from "@/features/stories/storiesApi";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";

const EMPTY = {
  title: "",
  caption: "",
  link_url: "",
  sort_order: "0",
  starts_at: "",
  ends_at: "",
  is_active: true,
};

/** Why a story is not on the rail — or that it is. The server owns `is_live`; this only
 *  explains it, and never re-derives it. */
function statusOf(story: Story): { tone: BadgeTone; label: string } {
  if (story.is_live) return { tone: "positive", label: "Showing now" };
  if (!story.is_active) return { tone: "neutral", label: "Hidden" };
  const now = Date.now();
  if (story.starts_at && new Date(story.starts_at).getTime() > now) {
    return { tone: "attention", label: "Scheduled" };
  }
  if (story.ends_at && new Date(story.ends_at).getTime() <= now) {
    return { tone: "neutral", label: "Finished" };
  }
  // Active, inside its window, and still not live. The only way to reach here is a clock skew
  // between this browser and the server. Say so rather than inventing a reason.
  return { tone: "neutral", label: "Not showing" };
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
    <FormDialog
      open
      onClose={onClose}
      title={story ? "Edit story" : "Add a story"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            state={save.isPending ? "busy" : "idle"}
            disabled={save.isPending}
            onClick={submit}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <FormField label="Title" htmlFor="story-title" hint="The word under the circle. Keep it short.">
          <input
            id="story-title"
            className={CONTROL}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </FormField>
        <FormField label="Caption" htmlFor="story-caption" hint="What a student reads once they have opened it.">
          <textarea
            id="story-caption"
            className={AREA}
            rows={3}
            value={form.caption}
            onChange={(e) => setForm({ ...form, caption: e.target.value })}
          />
        </FormField>
        <FormField
          label="Picture"
          htmlFor="story-image"
          hint={story ? "Leave empty to keep the current one." : "Required — this is the story."}
        >
          <input
            id="story-image"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={FILE_INPUT}
          />
        </FormField>
        <FormField label="Link" htmlFor="story-link" hint="Optional. Where tapping the story takes a student.">
          <input
            id="story-link"
            className={CONTROL}
            placeholder="/shop"
            value={form.link_url}
            onChange={(e) => setForm({ ...form, link_url: e.target.value })}
          />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Starts" htmlFor="story-starts" hint="Empty = show it straight away.">
            <input
              id="story-starts"
              type="datetime-local"
              className={cn(CONTROL, "tabular-nums")}
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
            />
          </FormField>
          <FormField label="Ends" htmlFor="story-ends" hint="Empty = leave it up.">
            <input
              id="story-ends"
              type="datetime-local"
              className={cn(CONTROL, "tabular-nums")}
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
            />
          </FormField>
        </div>
        <FormField label="Sort order" htmlFor="story-sort" hint="Lower shows first on the rail.">
          <input
            id="story-sort"
            type="number"
            className={cn(CONTROL, "tabular-nums")}
            value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
          />
        </FormField>
        <CheckRow
          id="story-active"
          checked={form.is_active}
          onChange={(checked) => setForm({ ...form, is_active: checked })}
        >
          Show on the dashboard
        </CheckRow>
      </div>
    </FormDialog>
  );
}

export default function OpsStoriesPage() {
  const stories = useAdminStories();
  const remove = useDeleteStory();
  // `undefined` = the modal is closed; `null` = open on a new story; a Story = open on that
  // one. Three states in one variable, which is the same trick /ops/shop uses.
  const [editing, setEditing] = useState<Story | null | undefined>(undefined);
  // The story being deleted outlives the dialog, so its title stays while the dialog leaves.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Story | null>(null);

  const liveCount = stories.data?.filter((s) => s.is_live).length ?? 0;

  const runDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove.mutateAsync(pendingDelete.id);
    } catch (e) {
      throw new Error(normalizeApiError(e).message);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Stories"
        title="Stories"
        description="The ring of circles across the top of every student's dashboard."
        actions={
          <Button variant="primary" icon="image" onClick={() => setEditing(null)}>
            Add a story
          </Button>
        }
      />

      <Panel
        title="All stories"
        icon="ms-story"
        aside={liveCount > 0 ? <CaptionCount tone="primary">{liveCount} showing</CaptionCount> : null}
      >
        {/* Four branches: loading, error, empty, data. An error rendered as "no stories yet"
            would tell an admin their noticeboard is empty when in fact it failed to load —
            and the obvious next move, posting the notice again, is exactly the wrong one. */}
        {stories.isPending ? (
          <SkeletonRows count={3} thumb="round" />
        ) : stories.isError ? (
          <LoadFailed onRetry={() => void stories.refetch()}>The stories didn&apos;t load.</LoadFailed>
        ) : stories.data.length === 0 ? (
          <EmptyState icon="ms-story" title="No stories yet" detail="Add one and it appears on every student's dashboard." />
        ) : (
          <ul className="divide-y divide-ms-line">
            {stories.data.map((story) => {
              const status = statusOf(story);
              return (
                <li
                  key={story.id}
                  data-story={story.id}
                  className="ms-transition flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 hover:bg-ms-surface"
                >
                  {/* A plain <img>, not next/image: these are signed R2 URLs on a host the
                      image optimiser is not configured for, and an un-optimisable remote
                      source is a build-time error rather than a graceful fallback. */}
                  {story.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={story.image_url}
                      alt=""
                      className="size-12 shrink-0 rounded-full object-cover shadow-[0_0_0_2px_var(--ms-card),0_0_0_4px_var(--ms-primary-soft-2)]"
                    />
                  ) : (
                    <span
                      className="grid size-12 shrink-0 place-items-center rounded-full bg-ms-surface-2 text-ms-fg-3"
                      title="Saved without a picture"
                    >
                      <Icon name="image" />
                    </span>
                  )}

                  <div className="min-w-0 flex-1 basis-[14rem]">
                    <p className="truncate text-[15px] font-semibold leading-[22px] text-ms-fg">
                      {story.title || <span className="font-normal italic text-ms-fg-3">Untitled</span>}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-ms-fg-2">
                      <Badge tone={status.tone} dot={status.tone !== "neutral"}>
                        {status.label}
                      </Badge>
                      <span className="tabular-nums">#{story.sort_order}</span>
                      {story.starts_at || story.ends_at ? (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Icon name="cal" size="sm" className="size-3.5 text-ms-fg-3" />
                          {story.starts_at
                            ? new Date(story.starts_at).toLocaleDateString(undefined, { timeZone: SCHOOL_TIME_ZONE })
                            : "now"}
                          {" – "}
                          {story.ends_at ? new Date(story.ends_at).toLocaleDateString(undefined, { timeZone: SCHOOL_TIME_ZONE }) : "open"}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  {/* Editing is the routine act and destruction is the exception, so only one
                      of these is a button. Same weighting as the shop's order rows. */}
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="secondary" icon="pencil" onClick={() => setEditing(story)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="trash"
                      onClick={() => {
                        setPendingDelete(story);
                        setDeleteOpen(true);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {editing !== undefined ? (
        <StoryForm story={editing} onClose={() => setEditing(undefined)} />
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        tone="critical"
        icon="trash"
        title={pendingDelete ? `Delete "${pendingDelete.title}"?` : ""}
        confirmLabel="Delete"
        onConfirm={runDelete}
      >
        This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}
