"use client";

import { useId, useMemo, useState } from "react";

import { Button } from "@/features/console/ui";
import { CONTROL, FIELD_LABEL, HINT } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";
import { fromLocalInput, toLocalInput } from "@/lib/datetimeLocal";
import { AudiencePicker } from "./AudiencePicker";
import { errorBody } from "./apiError";
import { WEEKDAYS, draftChats, draftFrom, draftToFields, type AudienceDraft } from "./audience";
import { AREA, CAPTION, CheckRow, FILE_INPUT, FormDialog, Notice, RadioPill } from "./telegramLook";
import type { GroupPostDetail, PostWhen } from "./telegramPostsApi";
import { useSavePost, useTelegramGroups } from "./telegramPostsHooks";

/** Telegram's limits, as the server checks them (telegram_posts/render.py). */
const CAPTION_MAX = 1024;
const TEXT_MAX = 4096;

type When = Exclude<PostWhen, "EVENT">;
const WHEN_LABEL: Record<When, string> = { NOW: "Now", ONCE: "Once, at a set time", WEEKLY: "Every week" };

function errorText(e: unknown): string {
  const body = errorBody(e);
  if (typeof body?.detail === "string") return body.detail;
  // DRF field errors: { field: ["message", …] }. Only strings are words; anything else is noise.
  const messages = body ? Object.values(body).flat().filter((m): m is string => typeof m === "string") : [];
  return messages.length ? messages.join(" ") : "Couldn't save that. Try again.";
}

/**
 * Write or edit a post (design handoff v0.3: the console dialog, its fields and a Telegram-like preview). The
 * checks, the confirm sentence and the body the server gets are the form's own.
 */
export function PostForm({ post, onClose }: { post: GroupPostDetail | null; onClose: () => void }) {
  const save = useSavePost();
  const groups = useTelegramGroups();
  const uid = useId();
  const [text, setText] = useState(post?.text ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [buttonText, setButtonText] = useState(post?.button_text ?? "");
  const [buttonUrl, setButtonUrl] = useState(post?.button_url ?? "");
  const [audience, setAudience] = useState<AudienceDraft>(draftFrom(post ?? undefined));
  const [when, setWhen] = useState<When>(post && post.when !== "EVENT" ? post.when : "NOW");
  const [sendAt, setSendAt] = useState(toLocalInput(post?.send_at ?? null));
  const [weekdays, setWeekdays] = useState<number[]>(post?.weekdays ?? []);
  const [timeOfDay, setTimeOfDay] = useState((post?.time_of_day ?? "18:00").slice(0, 5));
  const [error, setError] = useState<string | null>(null);

  // The server refuses a changed `when` once a post has run (code `already_ran`); the days and
  // the time of a weekly post may still change, so only the radios lock.
  const timingLocked = Boolean(post?.last_run);
  const hasPicture = Boolean(file || post?.image_url);
  const limit = hasPicture ? CAPTION_MAX : TEXT_MAX;
  const length = text.trim().length;
  const chats = useMemo(() => draftChats(groups.data?.groups ?? [], audience), [groups.data, audience]);

  const submit = () => {
    setError(null);
    if (!length) return setError("Write the message first.");
    if (length > limit) {
      return setError(`Telegram takes ${limit} characters${hasPicture ? " under a picture" : ""}; this is ${length}.`);
    }
    if (when === "ONCE" && !fromLocalInput(sendAt)) return setError("Pick when it goes out.");
    if (when === "WEEKLY" && weekdays.length === 0) return setError("Pick at least one day.");
    if (chats.length === 0) return setError("No connected group matches — pick at least one.");

    const n = chats.length;
    const groupsWord = `${n} Telegram group${n === 1 ? "" : "s"}`;
    const question =
      when === "NOW"
        ? `Post this to ${groupsWord} now? The bot can delete it from the groups for 48 hours.`
        : `Schedule this for ${groupsWord}?`;
    if (!window.confirm(question)) return;

    const fields: Record<string, unknown> = {
      text: text.trim(),
      button_text: buttonText.trim(),
      button_url: buttonUrl.trim(),
      ...draftToFields(audience),
      when,
      send_at: when === "ONCE" ? fromLocalInput(sendAt) : null,
      weekdays: when === "WEEKLY" ? weekdays : [],
      time_of_day: when === "WEEKLY" ? timeOfDay : null,
    };
    let body: FormData | Record<string, unknown> = fields;
    if (file) {
      // A multipart form carries strings only: the lists travel as JSON (JsonListField).
      const fd = new FormData();
      Object.entries(fields).forEach(([k, v]) => {
        if (v === null) return;
        fd.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
      });
      fd.append("image", file);
      body = fd;
    }
    save.mutate({ id: post?.id, body }, { onSuccess: onClose, onError: (e) => setError(errorText(e)) });
  };

  return (
    <FormDialog
      title={post ? "Edit post" : "New post"}
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={when === "NOW" ? "send" : "clock"}
            state={save.isPending ? "busy" : "idle"}
            disabled={save.isPending}
            onClick={submit}
          >
            {when === "NOW" ? "Post now" : "Schedule"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {groups.data?.enabled === false ? (
          <Notice tone="warning">
            Posting is switched off on this server — Now posts are refused; scheduled posts go out at their time once it
            is on.
          </Notice>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}

        <div>
          <label htmlFor={`${uid}-text`} className={FIELD_LABEL}>
            Message
          </label>
          <textarea
            id={`${uid}-text`}
            data-autofocus
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ertaga yakshanba soat 10:00 da mock! …"
            className={AREA}
          />
          <p className={cn(HINT, "tabular-nums", length > limit && "font-medium text-ms-critical-fg")}>
            {`${length}/${limit} characters`}
          </p>
        </div>

        <div>
          <label htmlFor={`${uid}-picture`} className={FIELD_LABEL}>
            Picture
          </label>
          <input
            id={`${uid}-picture`}
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={FILE_INPUT}
          />
          <p className={HINT}>
            {post?.image_url && !file ? "The current picture is kept." : "Optional. Under a picture Telegram takes 1024 characters."}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor={`${uid}-button-text`} className={FIELD_LABEL}>
              Button label
            </label>
            <input
              id={`${uid}-button-text`}
              value={buttonText}
              onChange={(e) => setButtonText(e.target.value)}
              placeholder="Ro'yxatdan o'tish"
              className={CONTROL}
            />
            <p className={HINT}>Optional.</p>
          </div>
          <div className="min-w-0">
            <label htmlFor={`${uid}-button-url`} className={FIELD_LABEL}>
              Button link
            </label>
            <input id={`${uid}-button-url`} value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} className={CONTROL} />
            <p className={HINT}>https://…</p>
          </div>
        </div>

        <fieldset className="min-w-0">
          <legend className={FIELD_LABEL}>To</legend>
          <AudiencePicker groups={groups.data?.groups ?? []} value={audience} onChange={setAudience} />
        </fieldset>

        <fieldset className="min-w-0">
          <legend className={FIELD_LABEL}>When</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(WHEN_LABEL) as When[]).map((w) => (
              <RadioPill key={w} checked={when === w} disabled={timingLocked} onChange={() => setWhen(w)}>
                {WHEN_LABEL[w]}
              </RadioPill>
            ))}
          </div>
          {timingLocked ? <p className={HINT}>This post has already run — its timing can&apos;t change.</p> : null}
        </fieldset>

        {when === "ONCE" ? (
          <div>
            <label htmlFor={`${uid}-send-at`} className={FIELD_LABEL}>
              Goes out at
            </label>
            <div className="max-w-[16rem]">
              <input id={`${uid}-send-at`} type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} className={CONTROL} />
            </div>
            <p className={HINT}>Tashkent time.</p>
          </div>
        ) : null}

        {when === "WEEKLY" ? (
          <fieldset className="min-w-0">
            <legend className={FIELD_LABEL}>Every week on</legend>
            <div className="flex flex-wrap gap-x-4">
              {WEEKDAYS.map((day, i) => (
                <CheckRow
                  key={day}
                  label={day}
                  checked={weekdays.includes(i)}
                  onChange={() =>
                    setWeekdays(weekdays.includes(i) ? weekdays.filter((d) => d !== i) : [...weekdays, i].sort((a, b) => a - b))
                  }
                />
              ))}
            </div>
            <div className="mt-2 w-32">
              <input type="time" aria-label="Time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} className={CONTROL} />
            </div>
            <p className={HINT}>Tashkent time.</p>
          </fieldset>
        ) : null}

        <div>
          <p className={cn(CAPTION, "mb-1.5")}>Preview</p>
          <div className="rounded-ms-card bg-ms-surface-2 p-3">
            <div className="max-w-md whitespace-pre-wrap rounded-[14px] rounded-bl-[4px] bg-ms-card p-3 text-[14px] leading-5 text-ms-fg shadow-ms-1">
              {text.trim() || "…"}
              {buttonText.trim() && buttonUrl.trim() ? (
                <span className="mt-2 block rounded-ms-ctl border border-ms-border bg-ms-surface px-3 py-1.5 text-center text-[13px] font-semibold text-ms-primary-text">
                  {buttonText.trim()}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </FormDialog>
  );
}
