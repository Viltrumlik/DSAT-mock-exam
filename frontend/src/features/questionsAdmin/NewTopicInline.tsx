"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/components/ui/Icon";
import { buttonClass } from "@/features/console/ui";
import { CONTROL } from "@/features/questionsAdmin/questionLook";
import { invalidateSkillTaxonomy } from "@/features/questionsAdmin/skillTaxonomy";
import { topicListsKey, topicsApi, type TopicRow } from "@/features/questionsAdmin/topicsApi";
import { normalizeApiError } from "@/lib/apiError";

/**
 * "+ New topic · Manage topics →" under a midterm question's Topic picker — only on a level's own list
 * (junior / foundation math) and only for an admin (the taxonomy answer's `can_manage_topics`).
 *
 * The owner, 2026-11-17: "midtermda topicni admin o'zi qo'shadigan qilib bering". Typing a name adds it to
 * the end of that list for every question, and picks it on this one. The question itself still saves with
 * its own Save, like any other field.
 */
export function NewTopicInline({
  listId,
  listName,
  inputId,
  onCreated,
}: {
  listId: number;
  listName: string;
  inputId: string;
  onCreated: (topic: TopicRow) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const create = useMutation({
    mutationFn: (value: string) => topicsApi.create(listId, value),
    onSuccess: async (topic) => {
      await invalidateSkillTaxonomy(qc);
      void qc.invalidateQueries({ queryKey: topicListsKey });
      onCreated(topic);
      setName("");
      setOpen(false);
    },
  });

  const close = () => {
    setOpen(false);
    setName("");
    create.reset();
  };
  const submit = () => {
    if (name.trim() && !create.isPending) create.mutate(name.trim());
  };
  const error = create.isError ? normalizeApiError(create.error).message : null;

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 font-semibold text-ms-primary-text hover:underline"
        >
          <Icon name="plus" size="sm" />
          New topic
        </button>
        <span aria-hidden className="text-ms-fg-3">·</span>
        <Link href="/builder/topics" className="inline-flex items-center gap-1 text-ms-fg-2 hover:text-ms-fg hover:underline">
          Manage topics
          <Icon name="right" size="sm" />
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5" data-new-topic>
      <label htmlFor={inputId} className="text-[13px] font-medium text-ms-fg">
        New topic in {listName}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          autoFocus
          className={CONTROL}
          value={name}
          maxLength={255}
          placeholder="e.g. Quadratic Inequalities"
          onChange={(e) => {
            setName(e.target.value);
            if (create.isError) create.reset();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim() || create.isPending}
          className={buttonClass({ variant: "primary", size: "sm" })}
        >
          {create.isPending ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={close} className={buttonClass({ variant: "ghost", size: "sm" })}>
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] leading-[18px] text-ms-critical-fg">
          {error}
        </p>
      ) : (
        <p className="text-[13px] leading-[18px] text-ms-fg-3">Every {listName} question can use it from now on.</p>
      )}
    </div>
  );
}
