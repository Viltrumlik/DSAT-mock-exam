"use client";

import { useState } from "react";

/**
 * True once `value` has changed since this component first drew it — so a status animates when it
 * changes in front of you (a freeze, a delivery), never on every page load. Derived during render,
 * as React recommends for state that follows a prop.
 */
export function useChanged<T>(value: T): boolean {
  const [seen, setSeen] = useState<{ value: T; changed: boolean }>({ value, changed: false });
  if (!Object.is(seen.value, value)) setSeen({ value, changed: true });
  return seen.changed || !Object.is(seen.value, value);
}
