"use client";

/**
 * Small game sounds, made on the spot with the Web Audio API — no audio files to license,
 * host or download on a school wifi.
 *
 * Muting is remembered per browser. Storage can throw (private mode, blocked site data), so
 * every read and write is guarded and a failure simply means "not muted, not remembered".
 */

import { useCallback, useEffect, useState } from "react";

const MUTE_KEY = "livequiz:muted";

type Cue = "correct" | "wrong" | "tick" | "start" | "powerup" | "finish";

// Notes as [frequency Hz, start offset s, duration s].
const CUES: Record<Cue, Array<[number, number, number]>> = {
  correct: [
    [660, 0, 0.12],
    [880, 0.1, 0.18],
  ],
  wrong: [
    [220, 0, 0.18],
    [175, 0.14, 0.24],
  ],
  tick: [[1200, 0, 0.04]],
  start: [
    [523, 0, 0.1],
    [659, 0.1, 0.1],
    [784, 0.2, 0.18],
  ],
  powerup: [
    [784, 0, 0.08],
    [988, 0.07, 0.08],
    [1319, 0.14, 0.16],
  ],
  finish: [
    [523, 0, 0.14],
    [659, 0.14, 0.14],
    [784, 0.28, 0.14],
    [1047, 0.42, 0.3],
  ],
};

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = context ?? new Ctor();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

export function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(value: boolean) {
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Not remembered — the toggle still works for this page.
  }
}

export function playCue(cue: Cue, muted: boolean) {
  if (muted) return;
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const [freq, offset, duration] of CUES[cue]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = cue === "wrong" ? "sawtooth" : "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + duration + 0.02);
  }
}

/** Mute state plus a `play` that respects it. */
export function useGameSounds() {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setMuted(readMuted());
  }, []);

  const toggle = useCallback(() => {
    setMuted((prev) => {
      writeMuted(!prev);
      return !prev;
    });
  }, []);

  const play = useCallback((cue: Cue) => playCue(cue, muted), [muted]);

  return { muted, toggle, play };
}
