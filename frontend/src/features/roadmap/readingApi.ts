import api from "@/lib/api";

export type RoadmapSectionKind = "TEXT" | "IMAGE" | "VIDEO";

export interface RoadmapSection {
  id: number;
  kind: RoadmapSectionKind;
  heading: string;
  /** TEXT only. Plain text — blank lines separate paragraphs. Never HTML. */
  body: string;
  /** IMAGE only. */
  caption: string;
  image_url: string | null;
  /** VIDEO only — the author's link, or a signed URL for an uploaded file. */
  video_url: string | null;
}

export interface RoadmapReading {
  delivery_id: number;
  classroom_id: number;
  lesson_number: number;
  title: string;
  summary: string;
  estimated_minutes: number;
  /** Whether the homework waits on "I've finished reading". */
  require_read_confirmation: boolean;
  read: boolean;
  homework_released: boolean;
  /**
   * The homework this reading leads to — null until it is both released AND earned.
   * The server WITHHOLDS it rather than trusting the client to hide the button, so a null
   * here means there is genuinely nothing to open yet.
   */
  homework_assignment_id: number | null;
  sections: RoadmapSection[];
}

export const roadmapReadingApi = {
  get: async (deliveryId: number): Promise<RoadmapReading> => {
    const r = await api.get<RoadmapReading>(`/classes/roadmap/${deliveryId}/reading/`);
    return r.data;
  },
  /** "I've finished reading". Returns the whole payload, so the homework id arrives with it. */
  markRead: async (deliveryId: number): Promise<RoadmapReading> => {
    const r = await api.post<RoadmapReading>(`/classes/roadmap/${deliveryId}/reading/`);
    return r.data;
  },
};
