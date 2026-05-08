/**
 * Governance components — platform state visibility and immutability UX.
 *
 * All state badge logic lives here. Do not create ad-hoc badge components
 * elsewhere for states defined in PlatformState.
 */
export {
  StateTag,
  ImmutableIndicator,
  VersionChip,
  SnapshotPin,
  isImmutableState,
  stateLabel,
  stateDescription,
  STATE_VOCABULARY,
} from "./StateTag";
export type { PlatformState } from "./StateTag";
