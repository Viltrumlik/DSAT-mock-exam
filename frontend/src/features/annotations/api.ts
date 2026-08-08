import api from "@/lib/api";

/** Which text the offsets belong to. Mirrors `annotations.StudyAnnotation.SCOPE_CHOICES`. */
export type AnnotationScope = "exam" | "assessment" | "vocab";

export interface StoredAnnotation {
  start: number;
  end: number;
  kind: "highlight" | "underline";
  color?: "yellow" | "blue" | "pink";
  underline?: "solid" | "dashed";
}

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
