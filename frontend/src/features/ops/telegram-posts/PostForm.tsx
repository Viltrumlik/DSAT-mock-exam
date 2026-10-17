"use client";

import { useMemo, useState } from "react";

import { Alert, Button, Checkbox, Field, Input, Modal, Textarea } from "@/components/ui";
import { fromLocalInput, toLocalInput } from "@/lib/datetimeLocal";
import { AudiencePicker } from "./AudiencePicker";
import { WEEKDAYS, draftChats, draftFrom, draftToFields, type AudienceDraft } from "./audience";
import type { GroupPostDetail, PostWhen } from "./telegramPostsApi";
import { useSavePost, useTelegramGroups } from "./telegramPostsHooks";

/** Telegram's limits, as the server checks them (telegram_posts/render.py). */
const CAPTION_MAX = 1024;
const TEXT_MAX = 4096;

type When = Exclude<PostWhen, "EVENT">;
const WHEN_LABEL: Record<When, string> = { NOW: "Now", ONCE: "Once, at a set time", WEEKLY: "Every week" };

function errorText(e: unknown): string {
  const data = (e as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (typeof data?.detail === "string") return data.detail;
  return data ? Object.values(data).flat().join(" ") : "Couldn't save that. Try again.";
}

export function PostForm({ post, onClose }: { post: GroupPostDetail | null; onClose: () => void }) {
  const save = useSavePost();
  const groups = useTelegramGroups();
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
    <Modal open onClose={onClose} title={post ? "Edit post" : "New post"}>
      <div className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Message" hint={`${length}/${limit} characters`}>
          <Textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ertaga yakshanba soat 10:00 da mock! …"
          />
        </Field>
        <Field
          label="Picture"
          hint={post?.image_url && !file ? "The current picture is kept." : "Optional. Under a picture Telegram takes 1024 characters."}
        >
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Button label" hint="Optional.">
            <Input value={buttonText} onChange={(e) => setButtonText(e.target.value)} placeholder="Ro'yxatdan o'tish" />
          </Field>
          <Field label="Button link" hint="https://…">
            <Input value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} />
          </Field>
        </div>
        <Field label="To">
          <AudiencePicker groups={groups.data?.groups ?? []} value={audience} onChange={setAudience} />
        </Field>
        <Field label="When" hint={timingLocked ? "This post has already run — its timing can't change." : undefined}>
          <div className="flex flex-wrap gap-4 text-sm font-semibold">
            {(Object.keys(WHEN_LABEL) as When[]).map((w) => (
              <label key={w} className="inline-flex items-center gap-1.5">
                <input type="radio" checked={when === w} disabled={timingLocked} onChange={() => setWhen(w)} />
                {WHEN_LABEL[w]}
              </label>
            ))}
          </div>
        </Field>
        {when === "ONCE" ? (
          <Field label="Goes out at">
            <Input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
          </Field>
        ) : null}
        {when === "WEEKLY" ? (
          <Field label="Every week on" hint="Tashkent time.">
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((day, i) => (
                <Checkbox
                  key={day}
                  label={day}
                  checked={weekdays.includes(i)}
                  onChange={() =>
                    setWeekdays(weekdays.includes(i) ? weekdays.filter((d) => d !== i) : [...weekdays, i].sort((a, b) => a - b))
                  }
                />
              ))}
            </div>
            <Input type="time" aria-label="Time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} className="mt-2 w-32" />
          </Field>
        ) : null}
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Preview</p>
          <div className="whitespace-pre-wrap rounded-2xl bg-surface-2 p-3 text-sm">
            {text.trim() || "…"}
            {buttonText.trim() && buttonUrl.trim() ? (
              <span className="mt-2 block rounded-lg border border-border px-3 py-1.5 text-center text-xs font-bold">
                {buttonText.trim()}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={save.isPending}>{when === "NOW" ? "Post now" : "Schedule"}</Button>
        </div>
      </div>
    </Modal>
  );
}
