"use client";
import { useEffect, useRef, useState } from "react";

interface SprInputProps {
  value: string;
  onChange: (value: string) => void;
}

/** Renders an "a/b" answer as a stacked fraction; otherwise plain text. */
function RecordedAnswer({ text }: { text: string }) {
  if (!text) return <span>—</span>;
  if (text.includes("/")) {
    const [num, den] = text.split("/");
    return (
      <span className="inline-flex flex-col items-center justify-center font-black leading-none">
        <span className="border-b-[2.5px] border-slate-900 px-[2px] pb-[1px]">{num}</span>
        <span className="px-[2px] pt-[1px]">{den}</span>
      </span>
    );
  }
  return <span>{text}</span>;
}

/** Student-produced response input (math grid-ins). Accepts digits, -, ., /. */
export function SprInput({ value, onChange }: SprInputProps) {
  // The <input> is UNCONTROLLED (defaultValue + ref) — deliberately. A CONTROLLED
  // input (`value={value}`) dropped every character after the first on real devices:
  // each keystroke re-renders the whole ExamRunnerPage, and on a slow phone React
  // re-applies the controlled value mid-typing and clobbers the characters typed
  // after the render was scheduled (prod: "25"→"2", always the first char kept,
  // intermittently). An uncontrolled input is never re-applied on re-render, so
  // typed characters can't be clobbered. `shown` mirrors the value for the preview.
  const inputRef = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState<string>(value ?? "");
  // Last value we accepted — the source of truth for both the invalid-char revert
  // and for telling an external change (draft restore / navigation) from our echo.
  const lastGood = useRef<string>(value ?? "");

  // Adopt genuine external changes (draft restore / question navigation) into both
  // the preview and the uncontrolled DOM input; never runs for our own echo.
  useEffect(() => {
    const next = value ?? "";
    if (next !== lastGood.current) {
      lastGood.current = next;
      setShown(next);
      const el = inputRef.current;
      if (el && el.value !== next) el.value = next;
    }
  }, [value]);

  return (
    <div className="mt-6">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Your Answer</p>
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        placeholder="Enter your answer"
        maxLength={5}
        defaultValue={value ?? ""}
        onChange={(e) => {
          const next = e.target.value.slice(0, 5);
          if (/^[-0-9./]*$/.test(next)) {
            lastGood.current = next;
            setShown(next);
            onChange(next);
          } else {
            // Reject non-grid-in characters: restore the last valid value. (A
            // controlled input reverted automatically; an uncontrolled one must.)
            const el = inputRef.current;
            if (el) el.value = lastGood.current;
          }
        }}
        className="w-full max-w-xs rounded-lg border-2 border-slate-300 p-3 px-4 text-center text-xl font-bold tracking-widest text-slate-900 shadow-sm outline-2 outline-offset-1 outline-blue-600 transition-all hover:border-slate-400 focus:border-blue-600 focus:outline"
      />
      <div className="mt-3 flex max-w-xs items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Recorded:</span>
        <span className="flex min-h-[30px] min-w-[30px] items-center justify-center rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-sm font-black text-slate-900">
          <RecordedAnswer text={shown} />
        </span>
      </div>
    </div>
  );
}
