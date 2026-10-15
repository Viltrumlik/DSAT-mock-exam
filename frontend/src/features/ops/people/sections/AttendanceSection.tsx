"use client";

import { Fieldset, PartBody } from "../Fieldset";
import { usePersonPart } from "../personApi";

/** Filled in by the next step of the plan (Task 7). */
export function AttendanceSection({ id }: { id: number }) {
  const query = usePersonPart<unknown>(id, "attendance");
  return (
    <Fieldset title="Attendance (last 30 days)">
      <PartBody query={query} isEmpty={() => false} render={() => null} />
    </Fieldset>
  );
}
