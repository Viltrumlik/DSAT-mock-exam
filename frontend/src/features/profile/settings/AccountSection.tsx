"use client";

import { useEffect, useRef, useState } from "react";
import { AtSign, Camera, Trash2, UserRound } from "lucide-react";

import { useToast } from "@/components/ToastProvider";
import { Avatar, Field, Input } from "@/components/ui";
import { usersApi } from "@/lib/api";
import { cn } from "@/lib/cn";

import { fieldErrors, type FieldErrors } from "../profileApi";
import { Panel, PanelHeader, pill, TONE } from "../profileUi";
import { toProfileMe, type ProfileMe } from "../types";

/** The server's own ceiling (`USER_PROFILE_MAX_IMAGE_BYTES`), checked here first so a student
 *  isn't made to wait for an upload the server would refuse. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type Draft = { first_name: string; last_name: string; username: string; phone_number: string };

const fromMe = (me: ProfileMe): Draft => ({
  first_name: me.first_name,
  last_name: me.last_name,
  username: me.username,
  phone_number: me.phone_number,
});

/**
 * Photo, name, username and phone — the edit-profile modal's fields, in the settings they
 * belong to. The photo saves the moment it is chosen; the text fields save together.
 * Email is not here: it changes only by confirming a code, in "Sign-in & password".
 */
export function AccountSection({ me, onSaved }: { me: ProfileMe; onSaved: (me: ProfileMe) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => fromMe(me));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // A save elsewhere (the photo) hands back a fresh `me`; keep the unsaved text as typed.
  const saved = fromMe(me);
  const dirty = (Object.keys(saved) as (keyof Draft)[]).some((k) => draft[k].trim() !== saved[k].trim());
  useEffect(() => {
    if (!dirty) setDraft(fromMe(me));
    // Only when the saved profile changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft((d) => ({ ...d, [key]: e.target.value }));
    setErrors((errs) => ({ ...errs, [key]: [] }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setErrors({});
    try {
      const latest = await usersApi.patchMe({
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        username: draft.username.trim(),
        phone_number: draft.phone_number.trim() || null,
      });
      onSaved(toProfileMe(latest));
      toast.push({ tone: "success", message: "Your details are saved." });
    } catch (err) {
      const fields = fieldErrors(err);
      if (fields) setErrors(fields);
      else toast.push({ tone: "error", message: "That didn't save. Nothing has changed — try again." });
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.push({ tone: "error", message: "Choose a photo — a JPG or PNG image." });
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.push({ tone: "error", message: "That photo is over 5 MB. Choose a smaller one." });
      return;
    }
    setPhotoBusy(true);
    try {
      const form = new FormData();
      form.append("profile_image", file);
      onSaved(toProfileMe(await usersApi.patchMe(form)));
      toast.push({ tone: "success", message: "Your new photo is up." });
    } catch (err) {
      const message = fieldErrors(err)?.profile_image?.[0];
      toast.push({ tone: "error", message: message ?? "The photo didn't upload. Try again." });
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      onSaved(toProfileMe(await usersApi.patchMe({ clear_profile_image: true })));
      toast.push({ tone: "success", message: "Your photo is removed." });
    } catch {
      toast.push({ tone: "error", message: "The photo wasn't removed. Try again." });
    } finally {
      setPhotoBusy(false);
    }
  };

  const fullName = `${me.first_name} ${me.last_name}`.trim() || me.username;
  const error = (key: string) => errors[key]?.[0];
  const general = errors.non_field_errors?.[0] ?? errors.detail?.[0];

  return (
    <Panel>
      <PanelHeader icon={UserRound} tone="primary" title="Account" description="How your teachers and classmates see you." />

      <div className={cn("squircle mt-5 flex flex-col gap-4 p-4 sm:flex-row sm:items-center [--sq:11px]", TONE.primary.well)}>
        <Avatar src={me.profile_image_url} name={fullName} size={72} className="squircle ring-4 ring-card [--sq:13px]" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-extrabold text-foreground">Profile photo</p>
          <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">A clear photo of your face. JPG or PNG, up to 5 MB.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            id="profile-photo"
            onChange={(e) => void uploadPhoto(e.target.files?.[0])}
          />
          <label htmlFor="profile-photo" className={cn(pill("soft", "primary", "sm"), "cursor-pointer", photoBusy && "pointer-events-none opacity-50")}>
            <Camera className="h-3.5 w-3.5" aria-hidden />
            {me.profile_image_url ? "Change photo" : "Upload photo"}
          </label>
          {me.profile_image_url ? (
            <button type="button" onClick={() => void removePhoto()} disabled={photoBusy} className={pill("quiet", "rose", "sm")}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <form onSubmit={save} className="mt-5 flex flex-col gap-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="acc-first" error={error("first_name")}>
            <Input id="acc-first" autoComplete="given-name" value={draft.first_name} onChange={set("first_name")} invalid={!!error("first_name")} />
          </Field>
          <Field label="Last name" htmlFor="acc-last" error={error("last_name")}>
            <Input id="acc-last" autoComplete="family-name" value={draft.last_name} onChange={set("last_name")} invalid={!!error("last_name")} />
          </Field>
          <Field label="Username" htmlFor="acc-username" error={error("username")} hint="At least 3 characters. Classmates find you by it.">
            <Input
              id="acc-username"
              autoComplete="username"
              leftIcon={<AtSign />}
              value={draft.username}
              onChange={set("username")}
              invalid={!!error("username")}
            />
          </Field>
          <Field label="Phone number" htmlFor="acc-phone" error={error("phone_number")} hint="Optional. So your learning center can reach you.">
            <Input
              id="acc-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+998 90 123 45 67"
              value={draft.phone_number}
              onChange={set("phone_number")}
              invalid={!!error("phone_number")}
            />
          </Field>
        </div>

        {general ? <p className="text-[13px] font-semibold text-danger">{general}</p> : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-primary/10 pt-4">
          <button type="submit" disabled={!dirty || saving} className={pill("solid")}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          {dirty ? (
            <button
              type="button"
              onClick={() => {
                setDraft(fromMe(me));
                setErrors({});
              }}
              className={pill("quiet")}
            >
              Undo
            </button>
          ) : (
            <span className="text-[12.5px] font-medium text-muted-foreground">Everything here is saved.</span>
          )}
        </div>
      </form>
    </Panel>
  );
}
