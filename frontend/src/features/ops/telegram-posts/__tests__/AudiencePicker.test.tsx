import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The audience picker in the console's look: ticks that read "empty means all", the specific-groups list, and
 * the count of chats under it. The post form's payload comes from what it leaves in the draft.
 */

import { AudiencePicker } from "@/features/ops/telegram-posts/AudiencePicker";
import type { AudienceDraft } from "@/features/ops/telegram-posts/audience";

const GROUPS = [
  { id: 1, name: "Senior G1 Math", subject: "MATH", level: "senior", chat_id: "-1001" },
  { id: 2, name: "Junior G2 Math", subject: "MATH", level: "junior", chat_id: "-1002" },
  { id: 3, name: "Senior G3 English", subject: "ENGLISH", level: "senior", chat_id: "-1003" },
];

let container: HTMLDivElement;
let root: Root;
let last: AudienceDraft | null = null;
const text = () => container.textContent ?? "";
const box = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const radio = (label: string) =>
  Array.from(container.querySelectorAll("label")).find((l) => l.textContent?.trim() === label)!.querySelector("input")!;

function Harness({ allowSpecific = true }: { allowSpecific?: boolean }) {
  const [value, setValue] = useState<AudienceDraft>({ mode: "filter", subjects: [], levels: [], classroom_ids: [] });
  return (
    <AudiencePicker
      groups={GROUPS}
      value={value}
      allowSpecific={allowSpecific}
      onChange={(next) => {
        last = next;
        setValue(next);
      }}
    />
  );
}

async function render(allowSpecific = true) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness allowSpecific={allowSpecific} />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  last = null;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("AudiencePicker", () => {
  it("starts with everything ticked and counts every chat", async () => {
    await render();
    expect(box("Math").checked).toBe(true);
    expect(box("Senior").checked).toBe(true);
    expect(text()).toContain("Goes to 3 Telegram groups.");
  });

  it("narrows by subject, and will not untick the last one", async () => {
    await render();
    await act(async () => box("English").click());
    expect(last).toMatchObject({ subjects: ["MATH"] });
    expect(text()).toContain("Goes to 2 Telegram groups.");
    await act(async () => box("Math").click());
    // Unticking the last subject is refused: an empty list would read back as "all".
    expect(last).toMatchObject({ subjects: ["MATH"] });
    expect(box("Math").checked).toBe(true);
  });

  it("picks specific groups, and counts one chat", async () => {
    await render();
    await act(async () => radio("Specific groups").click());
    expect(text()).toContain("Goes to 0 Telegram groups.");
    await act(async () => box("Junior G2 Math").click());
    expect(last).toMatchObject({ mode: "groups", classroom_ids: [2] });
    expect(text()).toContain("Goes to 1 Telegram group.");
  });

  it("hides the specific-groups half for events", async () => {
    await render(false);
    expect(text()).not.toContain("Specific groups");
    expect(text()).not.toContain("By subject and level");
    expect(box("Math")).not.toBeNull();
  });
});
