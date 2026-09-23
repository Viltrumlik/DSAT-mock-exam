/**
 * The teacher panel's design kit, in the dashboard look. Teacher pages import from here and
 * nowhere else: not from `features/classroom/ui` (a different, quieter system belonging to the
 * shared classroom workspace) and not from `components/ui` (the global kit). One import path is
 * what keeps the panel from drifting into three looks again.
 */
export { Card, Stat, Pill, Button, Field, Skeleton } from "./primitives";
export { EmptyState, ErrorState } from "./states";
export { DataTable, type Column } from "./DataTable";
export { Dialog, type DialogSize } from "./Dialog";
export { TeacherPage } from "./TeacherPage";
export { TONE_INK, TONE_WASH, CARD_SURFACE, type Tone } from "./tones";
export { Donut, BarRows, TrendLine, type Slice, type BarRow } from "./charts";
