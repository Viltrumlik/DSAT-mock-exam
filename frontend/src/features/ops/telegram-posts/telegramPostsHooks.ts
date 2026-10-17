import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { telegramPostsApi, type PostAction } from "./telegramPostsApi";

const keys = {
  all: ["telegram-posts"] as const,
  list: ["telegram-posts", "list"] as const,
  detail: (id: number) => ["telegram-posts", "detail", id] as const,
  groups: ["telegram-posts", "groups"] as const,
};

export function useTelegramPosts() {
  return useQuery({ queryKey: keys.list, queryFn: () => telegramPostsApi.list() });
}

export function useTelegramPost(id: number) {
  return useQuery({
    queryKey: keys.detail(id),
    queryFn: () => telegramPostsApi.detail(id),
    // A disabled v5 query reports "pending" forever; only a real id is fetched.
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useTelegramGroups() {
  return useQuery({ queryKey: keys.groups, queryFn: () => telegramPostsApi.groups(), staleTime: 60_000 });
}

export function useSavePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: FormData | Record<string, unknown> }) =>
      id ? telegramPostsApi.update(id, body) : telegramPostsApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function usePostAction(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: PostAction) => telegramPostsApi.action(id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}
