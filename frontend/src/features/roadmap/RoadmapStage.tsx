"use client";

/**
 * One level's stage: the illustrated scene, the winding trail, and a circle per lesson.
 *
 * The trail is drawn in SVG from the nodes' MEASURED positions rather than from the same
 * percentages that place them. That looks redundant and is not: the circles are sized in
 * pixels from the rendered stage width, so where their centres actually land depends on a
 * layout that has already happened. Computing the curve from the percentages instead put the
 * path a few pixels off every circle at some widths, which reads as a broken drawing.
 *
 * It follows that the trail must be redrawn whenever the stage resizes, and that it can only
 * be drawn after paint — hence the ResizeObserver and the layout effect.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

import type { RoadmapLesson, RoadmapLevel } from "./types";
import {
  getScene,
  layoutPoints,
  nodeSize,
  sceneUrl,
  stretch,
  type SceneKey,
} from "./scenes";

/** What a circle looks like. Distinct from the lesson's own state — a locked LEVEL greys out
 *  every lesson in it regardless of what the lesson itself says. */
type NodeState = "done" | "current" | "upcoming" | "milestone" | "locked";

function nodeStateFor(lesson: RoadmapLesson, levelLocked: boolean): NodeState {
  if (levelLocked) return "locked";
  if (lesson.state === "completed") return "done";
  if (lesson.state === "available") return "current";
  // A midterm that is neither done nor open is still worth marking: it is the thing a student
  // is working towards, and a gold square in the distance is the whole point of a roadmap.
  if (lesson.is_midterm) return "milestone";
  return "upcoming";
}

const CTA: Record<NodeState, { tag: string; label: string; cls: string; enabled: boolean }> = {
  done: { tag: "Finished", label: "PRACTISE AGAIN", cls: "is-green", enabled: true },
  current: { tag: "Open now", label: "START LESSON", cls: "", enabled: true },
  milestone: { tag: "Big test", label: "START TEST", cls: "is-gold", enabled: true },
  upcoming: { tag: "Coming soon", label: "NOT YET", cls: "is-grey", enabled: false },
  locked: { tag: "Locked", label: "LOCKED", cls: "is-grey", enabled: false },
};

export function RoadmapStage({
  level,
  sceneKey,
  levelLocked,
  ownClassroomId,
}: {
  level: RoadmapLevel;
  sceneKey: SceneKey | null;
  levelLocked: boolean;
  ownClassroomId: number | null;
}) {
  const router = useRouter();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const lessons = level.lessons ?? [];
  const n = lessons.length;
  const scene = getScene(sceneKey);
  const points = layoutPoints(sceneKey, n);
  const url = sceneUrl(sceneKey);

  /** Measure the circles, then draw the curve through their centres.
   *
   *  Returns whether it actually drew, so the caller can retry — see the layout effect. */
  const drawTrail = useCallback((): boolean => {
    const track = trackRef.current;
    const svg = svgRef.current;
    if (!track || !svg) return false;

    const width = track.getBoundingClientRect().width;
    if (!width) return false;
    track.style.setProperty("--node", `${nodeSize(sceneKey, n, width)}px`);

    const nodes = Array.from(track.querySelectorAll<HTMLElement>(".rm-node"));
    if (nodes.length < 2) {
      svg.replaceChildren();
      return true;
    }

    const tr = track.getBoundingClientRect();
    const pts = nodes.map((el) => {
      const btn = el.querySelector(".rm-nbtn");
      const r = (btn ?? el).getBoundingClientRect();
      return {
        x: r.left - tr.left + r.width / 2,
        y: r.top - tr.top + r.height / 2,
        done: el.dataset.state === "done",
      };
    });

    // A vertical-tangent cubic between each pair: the curve leaves and enters every circle
    // straight up, which is what makes the zig-zag read as one continuous road rather than a
    // series of diagonal sticks.
    const seg = (a: (typeof pts)[number], b: (typeof pts)[number]) => {
      const my = (a.y + b.y) / 2;
      return ` C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;
    };

    let all = `M ${pts[0].x} ${pts[0].y}`;
    let walked = `M ${pts[0].x} ${pts[0].y}`;
    let reached = 0;
    for (let i = 1; i < pts.length; i += 1) {
      all += seg(pts[i - 1], pts[i]);
      // The green overlay stops at the first gap: it traces the path actually walked, so a
      // stray completed lesson further along must not colour the road leading to it.
      if (pts[i].done || (pts[i - 1].done && i === reached + 1)) {
        walked += seg(pts[i - 1], pts[i]);
        reached = i;
      }
    }

    svg.setAttribute("viewBox", `0 0 ${tr.width} ${tr.height}`);
    svg.setAttribute("width", String(tr.width));
    svg.setAttribute("height", String(tr.height));
    svg.replaceChildren();

    const path = (d: string, stroke: string, w: number, opacity = 1) => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      el.setAttribute("d", d);
      el.setAttribute("fill", "none");
      el.setAttribute("stroke", stroke);
      el.setAttribute("stroke-width", String(w));
      el.setAttribute("stroke-linecap", "round");
      el.setAttribute("opacity", String(opacity));
      return el;
    };

    const thickness = Math.max(10, Math.min(22, tr.width * 0.028));
    // Three strokes: a soft casing, the road, then the walked part in green over the top.
    svg.appendChild(path(all, "rgba(255,255,255,.55)", thickness + 8));
    svg.appendChild(path(all, "rgba(120,150,180,.55)", thickness, 0.75));
    if (reached > 0) svg.appendChild(path(walked, "#4CD964", thickness));
    return true;
  }, [sceneKey, n]);

  // Draw after layout — and RETRY on the next frames if the track has no width yet.
  //
  // The retry is not belt-and-braces. A stage can mount at zero width (a route transition, a
  // parent that lays out a frame later, a browser that reports 0 on the first pass), and the
  // early return then leaves a roadmap with circles and no road. A ResizeObserver is supposed
  // to catch that and usually does — but it did NOT during testing when the viewport itself
  // went from 0 to its real size, so relying on it alone is relying on something observed to
  // fail. A handful of frames costs nothing and closes the gap.
  useLayoutEffect(() => {
    if (drawTrail()) return;
    let tries = 0;
    let raf = 0;
    const attempt = () => {
      if (drawTrail() || tries > 30) return;
      tries += 1;
      raf = requestAnimationFrame(attempt);
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [drawTrail]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => drawTrail());
    ro.observe(track);
    return () => ro.disconnect();
  }, [drawTrail]);

  // Escape closes the lesson popup. A card that can only be dismissed by clicking elsewhere
  // is a trap on a page this tall.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const stageStyle: React.CSSProperties = {
    // The aspect ratio carries the stretch, so the picture and the steps agree about how tall
    // this level is without either measuring the other.
    ["--ar" as string]: `${scene.w}/${Math.round(scene.h * stretch(sceneKey, n))}`,
  };

  if (n === 0) {
    return (
      <div className="rm-stage is-empty" style={stageStyle}>
        <div
          className="rm-scene"
          style={{
            backgroundColor: scene.sky,
            backgroundImage: url ? `url('${url}')` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="rm-empty">
          <div className="rm-ghosts">
            <div className="rm-ghost" />
            <div className="rm-ghost" style={{ marginLeft: 150 }} />
            <div className="rm-ghost" style={{ marginLeft: -130 }} />
          </div>
          <h3>{levelLocked ? "Locked" : "Lessons are being prepared"}</h3>
          <p>
            {levelLocked
              ? "Finish the level before it to open this one."
              : "As soon as the first lesson is ready it appears here as a step on your path."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rm-stage" style={stageStyle}>
      <div
        className="rm-scene"
        style={{
          backgroundColor: scene.sky,
          backgroundImage: url ? `url('${url}')` : undefined,
          backgroundSize: "100% 100%",
          backgroundPosition: "top center",
        }}
      />

      <div className="rm-track" ref={trackRef}>
        <svg className="rm-trail" ref={svgRef} aria-hidden />

        {lessons.map((lesson, i) => {
          const state = nodeStateFor(lesson, levelLocked);
          const [x, y] = points[i] ?? [50, 50];
          const isOpen = open === i;
          const cta = CTA[state];
          const openable = Boolean(lesson.assignment_id && ownClassroomId && cta.enabled);

          return (
            <div
              key={`${lesson.lesson_number}-${i}`}
              className={`rm-node${isOpen ? " is-open" : ""}`}
              data-state={state}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div className="rm-node-in">
                {state === "current" && !isOpen ? <span className="rm-bubble">START</span> : null}

                <button
                  type="button"
                  className="rm-nbtn"
                  aria-label={`Lesson ${lesson.lesson_number}: ${lesson.title}`}
                  aria-expanded={isOpen}
                  disabled={state === "locked"}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  {state === "current" ? (
                    <>
                      <span className="rm-pulse" />
                      <span className="rm-ring" />
                    </>
                  ) : null}
                  {state === "locked" ? (
                    <Lock size={34} strokeWidth={2.4} aria-hidden />
                  ) : (
                    <span className="rm-n">{lesson.lesson_number}</span>
                  )}
                </button>

                {isOpen ? (
                  <div className="rm-pop" role="dialog" aria-label={lesson.title}>
                    <h4>
                      {lesson.lesson_number}. {lesson.title}
                    </h4>
                    <div className="rm-tags">
                      {lesson.is_midterm ? <span className="rm-tag">Midterm</span> : null}
                      {lesson.scheduled_for ? (
                        <span className="rm-tag">
                          {new Date(lesson.scheduled_for).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      ) : null}
                      <span className="rm-tag">{cta.tag}</span>
                    </div>
                    <button
                      type="button"
                      className={`rm-cta ${cta.cls}`}
                      disabled={!openable}
                      onClick={() => {
                        if (!openable) return;
                        router.push(
                          `/classes/${ownClassroomId}/assignments/${lesson.assignment_id}`,
                        );
                      }}
                    >
                      {/* The button says LOCKED / NOT YET when the state forbids it, but a
                          lesson that is open and simply has no assignment behind it yet is a
                          third case — say that rather than claiming it is not their turn. */}
                      {cta.enabled && !openable ? "NOT READY YET" : cta.label}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {levelLocked ? (
          <div className="rm-veil">
            <div className="rm-veil-card">
              <span className="rm-ic">
                <Lock size={30} strokeWidth={2.2} aria-hidden />
              </span>
              <b>Locked</b>
              <span>Finish the level before it to open these {n} lessons.</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default RoadmapStage;
