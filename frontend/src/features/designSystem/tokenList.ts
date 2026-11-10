/**
 * The console tokens' colour names (`--ms-<name>`), grouped as the design's Tokens board shows
 * them, and the text/background pairs that board checked against WCAG 2.2 AA. Shared by the
 * token test and the /ops/design preview so the two cannot drift apart.
 */

const VERDICTS = ["positive", "attention", "critical", "info", "frozen", "neutral"] as const;

export const COLOUR_GROUPS: { title: string; names: string[] }[] = [
  {
    title: "Surfaces and text",
    names: [
      "bg", "surface", "surface-2", "surface-3", "card", "fg", "fg-2", "fg-3", "fg-disabled",
      "border", "border-strong", "line", "border-input", "scrim",
      "inverse-bg", "inverse-fg", "inverse-link", "chip-on-bg", "chip-on-fg",
    ],
  },
  {
    title: "Brand",
    names: [
      "primary", "primary-hover", "primary-press", "primary-text", "primary-soft", "primary-soft-2",
      "ring", "danger-btn", "danger-btn-hover",
    ],
  },
  {
    title: "Verdicts",
    names: VERDICTS.flatMap((v) => [v, `${v}-soft`, `${v}-fg`, `${v}-line`]),
  },
  { title: "Subjects", names: ["rw", "rw-soft", "rw-fg", "math", "math-soft", "math-fg"] },
  { title: "Score bands", names: [1, 2, 3, 4].flatMap((n) => [`band${n}-bg`, `band${n}-fg`]) },
  { title: "Avatars", names: [1, 2, 3, 4, 5, 6].flatMap((n) => [`av${n}-bg`, `av${n}-fg`]) },
];

/** [text, background, minimum ratio]. A `#hex` is a literal colour, anything else a token name. */
export const CONTRAST_PAIRS: [fg: string, bg: string, min: number][] = [
  ["fg", "card", 4.5],
  ["fg-2", "card", 4.5],
  ["fg-3", "card", 4.5],
  ["fg-3", "bg", 4.5],
  ["border-input", "card", 3],
  ["primary-text", "card", 4.5],
  ["ring", "card", 3],
  ["#ffffff", "primary", 4.5],
  ["#ffffff", "danger-btn", 4.5],
  ["inverse-fg", "inverse-bg", 4.5],
  ["inverse-link", "inverse-bg", 4.5],
  ["chip-on-fg", "chip-on-bg", 4.5],
  ...VERDICTS.map((v): [string, string, number] => [`${v}-fg`, `${v}-soft`, 4.5]),
  ["rw-fg", "rw-soft", 4.5],
  ["math-fg", "math-soft", 4.5],
  ...[1, 2, 3, 4].map((n): [string, string, number] => [`band${n}-fg`, `band${n}-bg`, 4.5]),
  ...[1, 2, 3, 4, 5, 6].map((n): [string, string, number] => [`av${n}-fg`, `av${n}-bg`, 4.5]),
];
