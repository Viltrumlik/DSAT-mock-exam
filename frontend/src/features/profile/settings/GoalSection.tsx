"use client";

import { useEffect, useState } from "react";
import { BookOpen, Calculator, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useToast } from "@/components/ToastProvider";
import { usersApi } from "@/lib/api";
import { cn } from "@/lib/cn";

import { fieldErrors, type FieldErrors } from "../profileApi";
import { daysUntil, initialSectionTargets, localDate, SECTION_MAX, SECTION_MIN } from "../profileModel";
import { Eyebrow, Panel, PanelHeader, pill, TONE, type Tone } from "../profileUi";
import { toProfileMe, type ExamDateOption, type ProfileMe } from "../types";

function SectionSlider({
  id,
  label,
  icon: Icon,
  tone,
  value,
  onChange,
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  tone: Tone;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className={cn("squircle p-4 [--sq:11px]", TONE[tone].well)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="inline-flex items-center gap-2 text-[13.5px] font-bold text-foreground">
          <Icon className={cn("h-4 w-4", TONE[tone].text)} aria-hidden />
          {label}
        </label>
        <span className={cn("ds-num text-[26px] font-extrabold leading-none tabular-nums", TONE[tone].text)}>{value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={SECTION_MIN}
        max={SECTION_MAX}
        step={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${value} out of ${SECTION_MAX}`}
        className="mt-4 h-2 w-full cursor-pointer accent-primary"
      />
      <div className="mt-1.5 flex justify-between text-[11px] font-semibold text-muted-foreground">
        <span>{SECTION_MIN}</span>
        <span>{SECTION_MAX}</span>
      </div>
    </div>
  );
}

function longDate(ymd: string): string {
  const d = localDate(ymd);
  return d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : ymd;
}

function DateChoice({
  selected,
  onSelect,
  title,
  sub,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "ds-ring cr-press squircle flex flex-col items-start gap-0.5 border-2 px-3.5 py-3 text-left font-[inherit] transition-colors [--sq:10px]",
        // A picked date is drawn with a border and a tint, not by adding to `.quartz` — quartz
        // is unlayered and would eat a background or ring put on the same element.
        selected ? "border-primary bg-primary/[0.07]" : "quartz border-transparent hover:border-primary/30",
      )}
    >
      <span className={cn("text-[13.5px] font-extrabold", selected ? "text-primary dark:text-primary-hover" : "text-foreground")}>{title}</span>
      <span className="text-[12px] font-medium text-muted-foreground">{sub}</span>
    </button>
  );
}

/**
 * The target score and the SAT date, set the way the dashboard sets them: two section targets
 * that add up to the total, so the two screens can never disagree about what the goal is. The
 * profile's old form wrote the total alone and left the dashboard's sections behind.
 */
export function GoalSection({
  me,
  examDates,
  onSaved,
}: {
  me: ProfileMe;
  examDates: ExamDateOption[];
  onSaved: (me: ProfileMe) => void;
}) {
  const toast = useToast();
  const initial = initialSectionTargets(me.target_score, me.target_english, me.target_math);
  const [english, setEnglish] = useState(initial.english);
  const [math, setMath] = useState(initial.math);
  const [touched, setTouched] = useState(false);
  const [examDate, setExamDate] = useState(me.sat_exam_date);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  // A fresh save re-bases the form.
  useEffect(() => {
    const next = initialSectionTargets(me.target_score, me.target_english, me.target_math);
    setEnglish(next.english);
    setMath(next.math);
    setTouched(false);
    setExamDate(me.sat_exam_date);
  }, [me.target_score, me.target_english, me.target_math, me.sat_exam_date]);

  const hasGoal = me.target_score != null;
  // No goal is set until the student moves a slider: saving a date alone must not quietly set a
  // 1300 target nobody chose.
  const sendTargets = touched && (english !== initial.english || math !== initial.math || !hasGoal || me.target_english == null);
  const dateChanged = examDate !== me.sat_exam_date;
  const dirty = sendTargets || dateChanged;

  const offered = new Set(examDates.map((o) => o.exam_date));
  const orphan = me.sat_exam_date && !offered.has(me.sat_exam_date) ? me.sat_exam_date : null;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setErrors({});
    const payload: Record<string, unknown> = {};
    if (sendTargets) {
      payload.target_english = english;
      payload.target_math = math;
      payload.target_score = english + math;
    }
    // Only when it changed: a date the center has since withdrawn would fail validation if it
    // were sent back unchanged alongside a new target.
    if (dateChanged) payload.sat_exam_date = examDate || null;
    try {
      onSaved(toProfileMe(await usersApi.patchMe(payload)));
      toast.push({ tone: "success", message: "Your goal is saved." });
    } catch (err) {
      const fields = fieldErrors(err);
      if (fields) setErrors(fields);
      else toast.push({ tone: "error", message: "Your goal didn't save. Try again." });
    } finally {
      setSaving(false);
    }
  };

  const undo = () => {
    setEnglish(initial.english);
    setMath(initial.math);
    setTouched(false);
    setExamDate(me.sat_exam_date);
    setErrors({});
  };

  const targetError = errors.target_score?.[0] ?? errors.target_english?.[0] ?? errors.target_math?.[0];
  const dateError = errors.sat_exam_date?.[0];
  const showTotal = hasGoal || touched;

  return (
    <Panel>
      <PanelHeader
        icon={Target}
        tone="amber"
        title="Study goal"
        description="The score you're aiming for, and the SAT date you're working towards."
      />

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <SectionSlider
          id="goal-english"
          label="Reading & Writing"
          icon={BookOpen}
          tone="emerald"
          value={english}
          onChange={(v) => {
            setEnglish(v);
            setTouched(true);
          }}
        />
        <SectionSlider
          id="goal-math"
          label="Math"
          icon={Calculator}
          tone="sky"
          value={math}
          onChange={(v) => {
            setMath(v);
            setTouched(true);
          }}
        />
      </div>

      <div className={cn("squircle mt-3 flex flex-wrap items-center justify-between gap-2 px-4 py-3 [--sq:10px]", TONE.primary.well)}>
        <Eyebrow className={TONE.primary.text}>Target score</Eyebrow>
        <p className="text-[13px] font-medium text-muted-foreground">
          {showTotal ? (
            <>
              <span className="ds-num mr-1 text-[22px] font-extrabold text-foreground">{english + math}</span>/ 1600
            </>
          ) : (
            "Not set yet — move either slider to set one."
          )}
        </p>
      </div>
      {targetError ? <p className="mt-2 text-[13px] font-semibold text-danger">{targetError}</p> : null}

      <fieldset className="mt-6">
        <legend className="text-[13.5px] font-bold text-foreground">SAT date</legend>
        <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">The dates your learning center has opened.</p>
        <div role="radiogroup" aria-label="SAT date" className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {examDates.map((option) => {
            const days = daysUntil(option.exam_date);
            return (
              <DateChoice
                key={option.id}
                selected={examDate === option.exam_date}
                onSelect={() => setExamDate(option.exam_date)}
                title={longDate(option.exam_date)}
                sub={[option.label, days != null && days >= 0 ? (days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`) : null]
                  .filter(Boolean)
                  .join(" · ")}
              />
            );
          })}
          {orphan ? (
            <DateChoice
              selected={examDate === orphan}
              onSelect={() => setExamDate(orphan)}
              title={longDate(orphan)}
              sub="Your saved date — no longer offered"
            />
          ) : null}
          <DateChoice selected={!examDate} onSelect={() => setExamDate("")} title="Not decided yet" sub="Pick one when you know" />
        </div>
        {dateError ? <p className="mt-2 text-[13px] font-semibold text-danger">{dateError}</p> : null}
      </fieldset>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-primary/10 pt-4">
        <button type="button" onClick={() => void save()} disabled={!dirty || saving} className={pill("solid")}>
          {saving ? "Saving…" : "Save goal"}
        </button>
        {dirty ? (
          <button type="button" onClick={undo} className={pill("quiet")}>
            Undo
          </button>
        ) : (
          <span className="text-[12.5px] font-medium text-muted-foreground">Your dashboard shows the same goal.</span>
        )}
      </div>
    </Panel>
  );
}
