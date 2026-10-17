"use client";

/**
 * /ops/telegram-posts — what the class bot posts into the class Telegram groups (plan
 * 2026-10-17): the announcement and reminder an event's Publish creates, and the posts written
 * here. A message in 26 groups cannot be unread, so every send asks first (PostForm) and the
 * detail page can take a post back down for 48 hours.
 */

import Link from "next/link";
import { useState } from "react";
import { Send } from "lucide-react";

import { Alert, Badge, Button } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { PostForm } from "./PostForm";
import { STATE_BADGE, firstLine, kindLabel, scheduleLabel, sentLabel } from "./audience";
import { useTelegramPosts } from "./telegramPostsHooks";

export function TelegramPostsPage() {
  const posts = useTelegramPosts();
  const [creating, setCreating] = useState(false);
  const rows = posts.data?.posts ?? [];

  return (
    <div className="space-y-5">
      <OpsPageHeader
        section="Telegram posts"
        title="Telegram posts"
        description="What the bot posts into the class Telegram groups — event posts and the posts written here."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Send className="mr-1.5 h-4 w-4" aria-hidden />
            New post
          </Button>
        }
      />

      {posts.data && !posts.data.enabled ? (
        <Alert tone="warning">
          Posting is switched off on this server — Now posts are refused; scheduled posts go out at
          their time once it is on.
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-5 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">All posts</p>
        </div>

        {posts.isPending ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3.5">
                <div className="h-4 w-48 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : posts.isError ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-foreground">The posts didn&apos;t load.</p>
            <button
              type="button"
              onClick={() => void posts.refetch()}
              className="mt-1 text-sm font-bold text-primary underline"
            >
              Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Send className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="font-semibold text-foreground">No posts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Publishing an event posts it here too. Write a post for anything else.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((post) => {
              const state = STATE_BADGE[post.state];
              const sent = sentLabel(post);
              const schedule = scheduleLabel(post);
              return (
                <li key={post.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/ops/telegram-posts/${post.id}`}
                      className="block truncate text-sm font-bold hover:underline"
                    >
                      {firstLine(post.preview || post.text) || "(no text)"}
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-muted-foreground">
                      <Badge variant={state.variant}>{state.label}</Badge>
                      <span>{kindLabel(post)}</span>
                      {schedule ? <span>{schedule}</span> : null}
                      <span>{post.audience_label}</span>
                      {post.next_send_at ? <span>Next: {new Date(post.next_send_at).toLocaleString()}</span> : null}
                      {sent ? <span>{sent}</span> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {creating ? <PostForm post={null} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
