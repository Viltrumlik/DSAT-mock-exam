"use client";

import { useSyncExternalStore } from "react";

type ClockWindow = Window & { __STG_OFFSET_DAYS__?: number };

const subscribe = () => () => {};

/** The words after the banner, from the clock script's offset; "" when the copy lives on the real date. */
function testDate(): string {
  const days = Number((window as ClockWindow).__STG_OFFSET_DAYS__ || 0);
  if (!(days > 0)) return "";
  // `Date` is already moved by the clock script (/api/staging/clock.js), so today is the test date — in Tashkent, as
  // every other date of the toolbox, whatever zone the browser is in.
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Tashkent",
  });
  return ` · Test date: ${today} (+${days} day${days === 1 ? "" : "s"})`;
}

/**
 * After the test copy's banner: the date the copy lives on, once the time machine has moved it ("Test date: 27 Nov
 * 2026 (+2 days)"). Read in the browser only — the server renders nothing here, so the first paint matches.
 */
export function StagingTestDate() {
  const text = useSyncExternalStore(subscribe, testDate, () => "");
  return text ? <>{text}</> : null;
}
