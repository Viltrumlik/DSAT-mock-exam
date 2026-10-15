"use client";

import { Fieldset, PartBody } from "../Fieldset";
import { usePersonPart } from "../personApi";

/** Filled in by the next step of the plan (Task 7). */
export function HistorySection({ id }: { id: number }) {
  const query = usePersonPart<unknown>(id, "history");
  return (
    <Fieldset title="History">
      <PartBody query={query} isEmpty={() => false} render={() => null} />
    </Fieldset>
  );
}
