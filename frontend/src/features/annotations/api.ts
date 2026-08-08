import api from "@/lib/api";
import type { Annotation } from "@/features/testing-simulation/tools/highlight/annotations";

/** Which text the offsets belong to. Mirrors `annotations.StudyAnnotation.SCOPE_CHOICES`. */
export type AnnotationScope = "exam" | "assessment" | "vocab";

/**
 * The wire shape, structurally identical to `Annotation` in
 * `features/testing-simulation/tools/highlight/annotations.ts`. Declared against those types
 * rather than re-spelling the unions: writing them out by hand here is how `dotted` came to
 * be missing from the first draft of the server's allowlist, which would have 400'd every
 * dotted underline and lost it on the next device the student opened.
 */
export type StoredAnnotation = Annotation;

export interface AnnotationRow {
  target_id: number;
  container: string;
  data: StoredAnnotation[];
}

export const annotationsApi = {
  /** Everything this student marked on one attempt / vocabulary set, in one request. */
  async list(scope: AnnotationScope, ref: string | number): Promise<AnnotationRow[]> {
    const { data } = await api.get<{ items: AnnotationRow[] }>("/annotations/", {
      params: { scope, ref: String(ref) },
    });
    return data.items ?? [];
  },

  /** Upsert one region. An empty `data` deletes it server-side. */
  async write(
    scope: AnnotationScope,
    ref: string | number,
    target_id: number,
    container: string,
    data: StoredAnnotation[],
  ): Promise<void> {
    await api.put("/annotations/write/", { scope, ref: String(ref), target_id, container, data });
  },
};
