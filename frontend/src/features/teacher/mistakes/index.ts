/**
 * What the class got wrong, where the teacher already is. One import path, the way the teacher
 * kit and the checking pane have one: callers reach for `MostMissed` and nothing else.
 */
export { MostMissed } from "./MostMissed";
export { useMostMissed, type MostMissed as MostMissedState } from "./useMostMissed";
export { missedRows, type MissedRow, type MissedSource } from "./rows";
