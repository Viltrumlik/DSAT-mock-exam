import api from "@/lib/api";

/**
 * A story as both surfaces read it.
 *
 * One shape, not two, because the server sends one — see `StorySerializer`. The rail draws a
 * subset of these fields and the console draws all of them, which is a rendering decision
 * rather than a contract one.
 */
export interface Story {
  id: number;
  title: string;
  caption: string;
  /** Signed and expiring (~1h). Null when the story was saved without a picture, which
   *  /django-admin/ allows — the rail must render that rather than assume a URL. */
  image_url: string | null;
  link_url: string;
  is_active: boolean;
  sort_order: number;
  /** Null means "live since forever". */
  starts_at: string | null;
  /** Null means "never expires". */
  ends_at: string | null;
  /** Server-computed: is this one actually on the rail right now? The console must never
   *  re-derive this from the window, or it becomes a second copy of a rule that exists
   *  server-side precisely to have one copy. */
  is_live: boolean;
  created_at: string;
}

export const storiesApi = {
  /** The student rail. Live stories only, already ordered — the client does not re-sort. */
  async rail(): Promise<Story[]> {
    const { data } = await api.get<{ stories: Story[] }>("/stories/");
    return data.stories;
  },

  // ── Admin ───────────────────────────────────────────────────────────────
  /** Everything, live or not, each carrying `is_live` so the console can say which are up. */
  async adminStories(): Promise<Story[]> {
    const { data } = await api.get<{ stories: Story[] }>("/stories/admin/stories/");
    return data.stories;
  },
  /** `body` is FormData when a picture is attached — axios must set the multipart boundary
   *  itself, so no Content-Type is passed here. Creating REQUIRES an image. */
  async createStory(body: FormData | Record<string, unknown>): Promise<Story> {
    const { data } = await api.post<Story>("/stories/admin/stories/", body);
    return data;
  },
  /** Editing does NOT require an image — omitting it keeps the current picture. */
  async updateStory(id: number, body: FormData | Record<string, unknown>): Promise<Story> {
    const { data } = await api.patch<Story>(`/stories/admin/stories/${id}/`, body);
    return data;
  },
  async deleteStory(id: number): Promise<{ detail: string; deleted: boolean }> {
    const { data } = await api.delete(`/stories/admin/stories/${id}/`);
    return data;
  },
};
