"use client";

/**
 * /ops/telegram-posts — what the class bot posts into the class Telegram groups (plan
 * 2026-10-17): the announcement and reminder an event's Publish creates, and the posts written
 * here. A message in 26 groups cannot be unread, so every send asks first (PostForm) and the
 * detail page can take a post back down for 48 hours.
 *
 * In the console's look (design handoff v0.3): a card of posts, each a row with its state as a
 * verdict badge. The words and the calls are the page's own.
 */

import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Badge, Button, EmptyState } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { SCHOOL_TIME_ZONE } from "@/lib/schoolTime";
import { PostForm } from "./PostForm";
import { STATE_BADGE, firstLine, kindLabel, scheduleLabel, sentLabel } from "./audience";
import { BOX, CAPTION, CAPTION_ROW, LoadFailed, Notice, RowsLoading, dotted, toneOf } from "./telegramLook";
import { useTelegramPosts } from "./telegramPostsHooks";

export function TelegramPostsPage() {
  const posts = useTelegramPosts();
  const [creating, setCreating] = useState(false);
  const rows = posts.data?.posts ?? [];

  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Telegram posts"
        title="Telegram posts"
        description="What the bot posts into the class Telegram groups — event posts and the posts written here."
        actions={
          <Button variant="primary" icon="send" onClick={() => setCreating(true)}>
            New post
          </Button>
        }
      />

      {posts.data && !posts.data.enabled ? (
        <Notice tone="warning">
          Posting is switched off on this server — Now posts are refused; scheduled posts go out at
          their time once it is on.
        </Notice>
      ) : null}

      <section className={`animate-ms-card-in ${BOX}`}>
        <div className={CAPTION_ROW}>
          <p className={CAPTION}>All posts</p>
        </div>

        {posts.isPending ? (
          <RowsLoading />
        ) : posts.isError ? (
          <LoadFailed onRetry={() => void posts.refetch()}>The posts didn&apos;t load.</LoadFailed>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="ms-classpost"
            title="No posts yet"
            detail="Publishing an event posts it here too. Write a post for anything else."
          />
        ) : (
          <ul className="divide-y divide-ms-line">
            {rows.map((post) => {
              const state = STATE_BADGE[post.state];
              const tone = toneOf(state.variant);
              const sent = sentLabel(post);
              const schedule = scheduleLabel(post);
              return (
                <li key={post.id} className="ms-transition flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-ms-surface">
                  <div className="min-w-0 flex-1 basis-[18rem]">
                    <Link
                      href={`/ops/telegram-posts/${post.id}`}
                      className="block truncate text-[15px] font-semibold text-ms-fg hover:text-ms-primary-text"
                    >
                      {firstLine(post.preview || post.text) || "(no text)"}
                    </Link>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ms-fg-2">
                      <Badge tone={tone} dot={dotted(tone)}>
                        {state.label}
                      </Badge>
                      <span>{kindLabel(post)}</span>
                      {schedule ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Icon name="clock" size="sm" className="size-3.5 text-ms-fg-3" />
                          {schedule}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="users" size="sm" className="size-3.5 text-ms-fg-3" />
                        {post.audience_label}
                      </span>
                      {post.next_send_at ? <span>Next: {new Date(post.next_send_at).toLocaleString(undefined, { timeZone: SCHOOL_TIME_ZONE })}</span> : null}
                      {sent ? <span className="tabular-nums">{sent}</span> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {creating ? <PostForm post={null} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
