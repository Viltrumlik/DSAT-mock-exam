"use client";

import { plural } from "../format";

/** The SMS as a phone shows it, with what it is billed as. */
export function PhonePreview({ text, parts, ascii }: { text: string; parts: number; ascii: boolean }) {
  return (
    <figure className="mx-auto w-full max-w-[280px] rounded-[24px] border border-ms-border bg-ms-surface-2 p-3">
      {text ? (
        <p className="whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-ms-card px-3 py-2 text-[13px] leading-snug text-ms-fg shadow-card">
          {text}
        </p>
      ) : (
        <p className="px-2 py-6 text-center text-[13px] text-ms-fg-3">Pick a message to see it here.</p>
      )}
      {text ? (
        <figcaption className="mt-2 px-1 text-[12px] text-ms-fg-3">
          {plural(parts, "SMS part")} each
          {ascii ? "" : ". Non-Latin letters: 70 characters a part."}
        </figcaption>
      ) : null}
    </figure>
  );
}
