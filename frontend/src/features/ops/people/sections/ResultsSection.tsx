"use client";

import type { PeopleSection } from "@/features/ops/changelist/peopleApi";
import { Fieldset, PartBody } from "../Fieldset";
import { usePersonPart } from "../personApi";

/** Filled in by the next step of the plan (Task 7). */
export function ResultsSection({ id }: { id: number; section: PeopleSection }) {
  const query = usePersonPart<unknown>(id, "results");
  return (
    <Fieldset title="Results">
      <PartBody query={query} isEmpty={() => false} render={() => null} />
    </Fieldset>
  );
}
