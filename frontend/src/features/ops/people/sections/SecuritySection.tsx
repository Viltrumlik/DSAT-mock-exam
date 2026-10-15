"use client";

import { Fieldset, PartBody } from "../Fieldset";
import { usePersonPart } from "../personApi";

/** Filled in by the next step of the plan (Task 7). */
export function SecuritySection({ id }: { id: number }) {
  const query = usePersonPart<unknown>(id, "security");
  return (
    <Fieldset title="Security">
      <PartBody query={query} isEmpty={() => false} render={() => null} />
    </Fieldset>
  );
}
