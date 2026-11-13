"use client";

import { useMe } from "@/hooks/useMe";
import { holds } from "./permissions";

/**
 * `const can = useCan(); can(P.takePayment)`: whether the signed-in person holds any of the codenames
 * (features/ops/permissions). False until `me` has loaded, so a button never flashes in and out.
 */
export function useCan(): (...codes: string[]) => boolean {
  const { me } = useMe();
  return (...codes: string[]) => Boolean(me) && holds(me, ...codes);
}
