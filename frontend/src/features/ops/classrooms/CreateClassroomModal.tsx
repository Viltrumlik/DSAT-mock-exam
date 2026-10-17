"use client";

import { useEffect, useMemo, useState } from "react";
import { classesApi, examsAdminApi } from "@/lib/api";
import { levelsForSubject, levelLabel } from "@/lib/levels";
import { useBranches, useRegions } from "@/features/org/orgHooks";
import { Alert, Button, Checkbox, Field, Input, Modal, Select } from "@/components/ui";
import { serverReason, telegramChatIdProblem } from "./classroomsApi";

/**
 * "Add classroom" — moved unchanged from the old Classroom governance page when Classrooms became a
 * changelist. Admins create classrooms here; teachers do not create their own. The teacher and the
 * support teachers are written server-side in the same request.
 */

type StaffOpt = { id: number; email: string; name: string; subject: string | null };

/**
 * Does this member of staff cover the classroom's subject? "both" covers either — a plain `===`
 * hid every support teacher this school has (all are `subject="both"`). A blank subject covers
 * nothing, as on the server.
 */
export function coversSubject(staffSubject: string | null | undefined, classDomain: string): boolean {
  const s = (staffSubject ?? "").trim().toLowerCase();
  if (!s) return false;
  return s === "both" || s === classDomain;
}

/** "math" | "english" for a classroom, mirroring `Classroom.domain_subject` on the server. */
export function classDomainOf(subject: string | null | undefined): string {
  return (subject ?? "").trim().toLowerCase() === "math" ? "math" : "english";
}

type CreateForm = {
  name: string;
  subject: "ENGLISH" | "MATH";
  level: string;
  lesson_days: "ODD" | "EVEN";
  lesson_time: string;
  room_number: string;
  teacherId: string; // "" = assign a teacher later
  supportIds: number[];
  telegramChatId: string;
  /** Only a filter for the branch picker: a classroom stores its BRANCH. */
  regionId: string;
  branchId: string;
};
const BLANK: CreateForm = {
  name: "", subject: "ENGLISH", level: "", lesson_days: "ODD", lesson_time: "", room_number: "",
  teacherId: "", supportIds: [], telegramChatId: "", regionId: "", branchId: "",
};

export function CreateClassroomModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** The new class's id (null if the server did not say) and what to tell the admin. */
  onCreated: (id: number | null, notice: string) => void;
}) {
  const [form, setForm] = useState<CreateForm>(BLANK);
  const [teachers, setTeachers] = useState<StaffOpt[]>([]);
  const [supportOpts, setSupportOpts] = useState<StaffOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regions = useRegions();
  const branches = useBranches();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const u = await examsAdminApi.getUsers();
        const list = (Array.isArray(u) ? u : (u as { results?: unknown[] })?.results ?? []) as Record<string, unknown>[];
        const toOpt = (x: Record<string, unknown>): StaffOpt => ({
          id: Number(x.id),
          email: String(x.email ?? ""),
          name: [x.first_name, x.last_name].filter(Boolean).join(" ").trim() || String(x.email ?? `#${x.id}`),
          subject: (x.subject as string | null) ?? null,
        });
        const role = (x: Record<string, unknown>) => String(x.role).toLowerCase();
        if (!alive) return;
        setTeachers(list.filter((x) => role(x) === "teacher").map(toOpt));
        setSupportOpts(list.filter((x) => role(x) === "support_teacher").map(toOpt));
      } catch {
        /* the pickers are optional: a class can be created and staffed later */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Branches inside the region chosen in this form. */
  const branchOptions = useMemo(
    () => (branches.data ?? []).filter((b) => String(b.region) === form.regionId && b.is_active),
    [branches.data, form.regionId],
  );
  /** Does the school have anywhere to put a classroom at all? */
  const hasAnyBranch = (branches.data ?? []).some((b) => b.is_active);
  const chatIdProblem = telegramChatIdProblem(form.telegramChatId);

  async function submit() {
    if (!form.name.trim()) return setError("Give the classroom a name.");
    if (!form.level) return setError("Choose a level for the classroom.");
    // Required only once the school has a branch: a school without regions is not blocked.
    if (hasAnyBranch && !form.branchId) return setError("Choose the region and branch this class meets at.");
    if (chatIdProblem) return setError(chatIdProblem);
    setBusy(true);
    setError(null);
    try {
      const made = await classesApi.create({
        name: form.name.trim(),
        subject: form.subject,
        level: form.level,
        lesson_days: form.lesson_days,
        lesson_time: form.lesson_time.trim() || undefined,
        room_number: form.room_number.trim() || undefined,
        teacher_id: form.teacherId ? Number(form.teacherId) : undefined,
        telegram_chat_id: form.telegramChatId.trim() || undefined,
        support_teacher_ids: form.supportIds.length ? form.supportIds : undefined,
        branch: form.branchId ? Number(form.branchId) : undefined,
      });
      const assigned = form.teacherId ? " Teacher assigned and added to the classroom." : "";
      // What the SERVER accepted: an id whose role or subject does not hold is skipped.
      const supportCount = (made?.support_teacher_ids ?? []).length;
      const wanted = form.supportIds.length;
      const support =
        wanted === 0
          ? ""
          : supportCount === wanted
            ? ` ${supportCount} support teacher${supportCount === 1 ? "" : "s"} assigned.`
            : ` ${supportCount} of ${wanted} support teachers assigned — the rest don’t cover this subject.`;
      const id = typeof made?.id === "number" ? made.id : null;
      onCreated(id, `Classroom “${form.name.trim()}” created.${assigned}${support}`);
    } catch (e: unknown) {
      setError(serverReason(e, "Could not create the classroom."));
    } finally {
      setBusy(false);
    }
  }

  const candidates = supportOpts.filter((o) => coversSubject(o.subject, classDomainOf(form.subject)));

  return (
    <Modal
      open
      onClose={onClose}
      title="Add classroom"
      description="Set up a classroom and assign its teacher. Teachers can’t create their own."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!form.name.trim() || !form.level || (hasAnyBranch && !form.branchId)}
            onClick={() => void submit()}
          >
            Create classroom
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Class name" htmlFor="create-name" required>
          <Input
            id="create-name"
            required
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="SAT Math — Evening Group"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Subject" htmlFor="create-subject">
            <Select
              id="create-subject"
              value={form.subject}
              onChange={(e) => {
                const subject = e.target.value as CreateForm["subject"];
                // Reset the level if the new subject has no such level (English has no Foundation).
                const levelOk = levelsForSubject(subject).includes(form.level as never);
                setForm({ ...form, subject, level: levelOk ? form.level : "" });
              }}
            >
              <option value="ENGLISH">English</option>
              <option value="MATH">Math</option>
            </Select>
          </Field>
          <Field label="Level" htmlFor="create-level" required>
            <Select
              id="create-level"
              required
              value={form.level}
              onChange={(e) => setForm({ ...form, level: e.target.value })}
            >
              <option value="">— Choose level —</option>
              {levelsForSubject(form.subject).map((l) => (
                <option key={l} value={l}>
                  {levelLabel(l)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lesson days" htmlFor="create-days">
            <Select
              id="create-days"
              value={form.lesson_days}
              onChange={(e) => setForm({ ...form, lesson_days: e.target.value as CreateForm["lesson_days"] })}
            >
              <option value="ODD">Odd days</option>
              <option value="EVEN">Even days</option>
            </Select>
          </Field>
          <Field label="Lesson time" htmlFor="create-time">
            <Input
              id="create-time"
              value={form.lesson_time}
              onChange={(e) => setForm({ ...form, lesson_time: e.target.value })}
              placeholder="18:00"
            />
          </Field>
          <Field label="Room" htmlFor="create-room">
            <Input
              id="create-room"
              value={form.room_number}
              onChange={(e) => setForm({ ...form, room_number: e.target.value })}
              placeholder="Optional"
            />
          </Field>
        </div>
        {/* Two selects, ONE stored fact (the branch); the region only narrows the list. Shown only
            when the school has a branch at all. */}
        {hasAnyBranch ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Region" htmlFor="create-region" required>
              <Select
                id="create-region"
                value={form.regionId}
                onChange={(e) => setForm({ ...form, regionId: e.target.value, branchId: "" })}
              >
                <option value="">— Choose region —</option>
                {(regions.data ?? []).map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Branch"
              htmlFor="create-branch"
              required
              hint={
                form.regionId && branchOptions.length === 0
                  ? "This region has no branches yet — add one on the Branches page."
                  : undefined
              }
            >
              <Select
                id="create-branch"
                disabled={!form.regionId}
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              >
                <option value="">{form.regionId ? "— Choose branch —" : "— Pick a region first —"}</option>
                {branchOptions.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}

        <Field label="Teacher" htmlFor="create-teacher">
          <Select
            id="create-teacher"
            value={form.teacherId}
            onChange={(e) => setForm({ ...form, teacherId: e.target.value })}
          >
            <option value="">— Assign a teacher later —</option>
            {teachers.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name} ({t.email})
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Support teachers"
          hint={
            candidates.length === 0
              ? "No support teacher covers this subject yet."
              : "Optional. They can grade, take attendance and be booked by these students."
          }
        >
          {candidates.length === 0 ? null : (
            <div className="space-y-1.5 rounded-xl border border-border bg-surface-2 p-3">
              {candidates.map((o) => (
                <Checkbox
                  key={o.id}
                  label={`${o.name} (${o.email})`}
                  checked={form.supportIds.includes(o.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      supportIds: e.target.checked
                        ? [...form.supportIds, o.id]
                        : form.supportIds.filter((x) => x !== o.id),
                    })
                  }
                />
              ))}
            </div>
          )}
        </Field>

        <Field
          label="Telegram group"
          htmlFor="create-telegram-chat"
          error={chatIdProblem}
          hint="Optional, and the only way to attach a group. Add the bot to it as an administrator (invite + ban rights), send /chatid there, and paste the number here. Each student then gets their own single-use invite from the class page, and a frozen account is taken out automatically."
        >
          <Input
            id="create-telegram-chat"
            value={form.telegramChatId}
            onChange={(e) => setForm({ ...form, telegramChatId: e.target.value })}
            placeholder="-1001234567890"
            invalid={!!chatIdProblem}
          />
        </Field>
      </div>
    </Modal>
  );
}
