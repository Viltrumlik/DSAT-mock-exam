// Classroom design system — premium, minimal, token-driven (reads --ds-* / semantic
// Tailwind utilities from globals.css). Single accent, whitespace over borders,
// explicit empty/loading/error states. Reuse these; do not hand-roll inline styles.

export { Button, buttonClassName } from "./Button";
export type { ButtonProps } from "./Button";
export { Card, CardHeader, Divider } from "./Surface";
export type { CardProps } from "./Surface";
export { Field, Input, Textarea, Select, TextField } from "./Field";
export type { FieldProps } from "./Field";
export { Tabs } from "./Tabs";
export type { TabItem } from "./Tabs";
export { Dialog } from "./Dialog";
export type { DialogProps } from "./Dialog";
export { ConfirmDialog } from "./ConfirmDialog";
export type { ConfirmDialogProps } from "./ConfirmDialog";
export { Pill } from "./Pill";
export type { PillTone } from "./Pill";
export { Spinner, Skeleton, LoadingState, ErrorState, EmptyState } from "./states";

// Reused shared primitives — re-exported so classroom pages import from one place.
export { StatCard } from "@/components/ui/StatCard";
export { PageHeader } from "@/components/ui/PageHeader";
export { ProgressRing } from "@/components/ui/ProgressRing";
