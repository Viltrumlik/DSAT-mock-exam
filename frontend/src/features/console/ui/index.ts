/** The console's own controls (design handoff v0.3). `components/ui` stays the student app's. */
export { Avatar, AvatarStack, AVATAR_TONE, initialsOf, toneOf, type AvatarSize, type AvatarTone } from "./Avatar";
export { Badge, type BadgeTone } from "./Badge";
export { BulkBar, bulkButtonClass } from "./BulkBar";
export { Button, buttonClass, type ButtonProps, type ButtonSize, type ButtonState, type ButtonVariant } from "./Button";
export { Checkbox } from "./Checkbox";
export { ChipCount, FilterChip, chipClass } from "./Chip";
export { RadioGroup, Segmented, Switch, type RadioOption, type SegmentOption } from "./Choice";
export { Combobox, filterOptions, highlight } from "./Combobox";
export {
  DateField,
  PeriodPicker,
  TimeField,
  addDaysIso,
  addMonthsIso,
  calendarDays,
  clampIso,
  formatDay,
  normalizeTime,
  periodRange,
  tashkentToday,
  type Period,
  type PeriodKind,
} from "./DateField";
export { ConfirmDialog, Dialog } from "./Dialog";
export { Field, MoneyInput, TextArea, TextInput, caretAfterDigits, groupDigits, inputShell, useFieldControl, type TextInputProps } from "./Field";
export { follow } from "./follow";
export { Kbd, Shortcut, isMacLike, useModKey } from "./Kbd";
export { Menu, type MenuItem } from "./Menu";
export { Pagination, pageWindow } from "./Pagination";
export { EXIT_MS, prefersReducedMotion, usePresence } from "./presence";
export { SearchField } from "./SearchField";
export { OptionRow, Select, nextEnabled, typeAhead, type ListOption } from "./Select";
export { Sheet } from "./Sheet";
export { EmptyState, ErrorState } from "./States";
export { TabPanel, Tabs, useTabParam, type TabItem } from "./Tabs";
export { Tooltip } from "./Tooltip";
