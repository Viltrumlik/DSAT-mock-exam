"use client";

/**
 * /builder/topics — the midterm topic lists an admin manages: the learning center's own topics for junior and
 * foundation math, the list a question of that level is tagged from and its student's error report groups by.
 *
 * The owner, 2026-11-17: "midtermda topicni admin o'zi qo'shadigan qilib bering". Add, rename and reorder;
 * a topic in use is retired (out of the picker, kept on its questions and in every report already graded) and
 * can be restored; a topic nothing uses can be deleted. The SAT skill list is not here: it stays as it is.
 */

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/components/ui/Icon";
import { PageNotice } from "@/features/builderLibrary/assessmentParts";
import { LibraryError, LibraryHeader } from "@/features/builderLibrary/sectionParts";
import { EmptyState, buttonClass } from "@/features/console/ui";
import { CONTROL } from "@/features/questionsAdmin/questionLook";
import { invalidateSkillTaxonomy } from "@/features/questionsAdmin/skillTaxonomy";
import { topicsApi, type TopicList, type TopicRow } from "@/features/questionsAdmin/topicsApi";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function usage(t: TopicRow): string {
  if (!t.questions && !t.graded) return "Not used yet";
  const parts = [];
  if (t.questions) parts.push(plural(t.questions, "question"));
  if (t.graded) parts.push(plural(t.graded, "graded answer"));
  return parts.join(" · ");
}

/** Every topic's id in its list's order, with `id` moved one place among the active topics. */
function movedIds(list: TopicList, id: number, step: -1 | 1): number[] | null {
  const all = [...list.topics].sort((a, b) => a.order - b.order || a.id - b.id);
  const activeIdx = all.flatMap((t, i) => (t.retired ? [] : [i]));
  const at = activeIdx.findIndex((i) => all[i].id === id);
  const to = at + step;
  if (at < 0 || to < 0 || to >= activeIdx.length) return null;
  const ids = all.map((t) => t.id);
  const [a, b] = [activeIdx[at], activeIdx[to]];
  [ids[a], ids[b]] = [ids[b], ids[a]];
  return ids;
}

export default function TopicsPage() {
  const qc = useQueryClient();
  const [lists, setLists] = useState<TopicList[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLists(await topicsApi.lists());
      setLoadError(null);
    } catch (err) {
      const e = normalizeApiError(err);
      if (e.status === 403) setDenied(true);
      else setLoadError("Could not load the topic lists.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** One write at a time; then the page and every open Topic picker read the lists again. */
  const run = useCallback(
    async (write: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      setActionError(null);
      try {
        await write();
        return true;
      } catch (err) {
        setActionError(normalizeApiError(err).message);
        return false;
      } finally {
        await load();
        void invalidateSkillTaxonomy(qc);
        setBusy(false);
      }
    },
    [load, qc],
  );

  return (
    <div className="flex flex-col gap-5">
      <LibraryHeader
        eyebrow="Learning"
        title="Midterm topics"
        description="The topics a junior or foundation math midterm question is tagged with, and its student's report groups mistakes by. A new topic is on every question of that level at once."
        actions={null}
      />

      <PageNotice title="Retire, don't delete">
        A topic that questions already use can only be retired: it leaves the picker, but those questions keep it and
        every report already graded keeps its name. Restore brings it back. Renaming changes the name from now on;
        graded reports keep the name they were graded with.
      </PageNotice>

      {denied ? (
        <EmptyState icon="lock" title="Only admins manage topics." detail="Teachers pick a topic on each question; the lists themselves are the admins'." />
      ) : null}
      {loadError ? <LibraryError>{loadError}</LibraryError> : null}
      {actionError ? <LibraryError>{actionError}</LibraryError> : null}

      {loading ? (
        <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-ms-shimmer rounded-ms-ctl bg-ms-surface-2" />
          ))}
        </div>
      ) : !denied && !loadError && lists.length === 0 ? (
        <EmptyState icon="bookmark" title="No topic lists yet." detail="Junior and foundation math have their own lists; every other midterm uses the SAT skills." />
      ) : (
        lists.map((list) => <TopicListCard key={list.id} list={list} busy={busy} run={run} />)
      )}
    </div>
  );
}

function TopicListCard({
  list,
  busy,
  run,
}: {
  list: TopicList;
  busy: boolean;
  run: (write: () => Promise<unknown>) => Promise<boolean>;
}) {
  const sorted = [...list.topics].sort((a, b) => a.order - b.order || a.id - b.id);
  const active = sorted.filter((t) => !t.retired);
  const retired = sorted.filter((t) => t.retired);
  const [newName, setNewName] = useState("");

  const add = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    if (await run(() => topicsApi.create(list.id, name))) setNewName("");
  };

  return (
    <section
      aria-label={list.name}
      data-topic-list={list.id}
      className="animate-ms-card-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ms-line px-5 py-3.5">
        <h2 className="text-[16px] font-semibold text-ms-fg">{list.name}</h2>
        <p className="text-[13px] text-ms-fg-2">
          {list.level_label} · {plural(active.length, "topic")}
          {retired.length ? ` · ${retired.length} retired` : ""}
        </p>
      </div>

      {active.length === 0 ? (
        <p className="px-5 py-4 text-[14px] text-ms-fg-3">No topics yet. Add the first one below.</p>
      ) : (
        <ol className="divide-y divide-ms-line">
          {active.map((t, i) => (
            <TopicItem
              key={t.id}
              topic={t}
              index={i}
              first={i === 0}
              last={i === active.length - 1}
              busy={busy}
              onMove={(step) => {
                const ids = movedIds(list, t.id, step);
                if (ids) void run(() => topicsApi.reorder(list.id, ids));
              }}
              onRename={(name) => run(() => topicsApi.update(t.id, { name }))}
              onRetire={() => void run(() => topicsApi.update(t.id, { retired: true }))}
              onDelete={() => {
                if (window.confirm(`Delete "${t.name}"? Nothing uses it, and this cannot be undone.`)) {
                  void run(() => topicsApi.remove(t.id));
                }
              }}
            />
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-ms-line bg-ms-surface px-5 py-3">
        <label htmlFor={`new-topic-${list.id}`} className="sr-only">
          New topic in {list.name}
        </label>
        <input
          id={`new-topic-${list.id}`}
          className={cn(CONTROL, "min-w-0 flex-1 basis-[16rem]")}
          value={newName}
          maxLength={255}
          placeholder={`New topic in ${list.name}`}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={!newName.trim() || busy}
          className={buttonClass({ variant: "primary", size: "sm" })}
        >
          <Icon name="plus" size="sm" />
          Add topic
        </button>
      </div>

      {retired.length ? (
        <details className="border-t border-ms-line" data-retired>
          <summary className="cursor-pointer px-5 py-3 text-[14px] font-medium text-ms-fg-2 hover:text-ms-fg">
            Retired ({retired.length})
          </summary>
          <ul className="divide-y divide-ms-line">
            {retired.map((t) => (
              <li key={t.id} data-topic={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="break-words text-[15px] text-ms-fg-2 line-through decoration-ms-fg-3">{t.name}</p>
                  <p className="mt-0.5 text-[13px] text-ms-fg-3">{usage(t)}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => topicsApi.update(t.id, { retired: false }))}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  <Icon name="undo" size="sm" />
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function TopicItem({
  topic,
  index,
  first,
  last,
  busy,
  onMove,
  onRename,
  onRetire,
  onDelete,
}: {
  topic: TopicRow;
  index: number;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (step: -1 | 1) => void;
  onRename: (name: string) => Promise<boolean>;
  onRetire: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(topic.name);
  const unused = !topic.questions && !topic.graded;

  const cancel = () => {
    setEditing(false);
    setName(topic.name);
  };
  const save = async () => {
    const next = name.trim();
    if (!next || next === topic.name) return cancel();
    if (await onRename(next)) setEditing(false);
  };

  return (
    <li data-topic={topic.id} className="ms-transition flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 hover:bg-ms-surface">
      <div className="flex min-w-0 flex-1 basis-[16rem] items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-ms-surface-2 text-[13px] font-semibold tabular-nums text-ms-fg-3">
          {index + 1}
        </span>
        {editing ? (
          <input
            aria-label={`Rename ${topic.name}`}
            autoFocus
            className={cn(CONTROL, "min-w-0 flex-1")}
            value={name}
            maxLength={255}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
          />
        ) : (
          <div className="min-w-0">
            <p className="break-words text-[15px] font-semibold leading-[21px] text-ms-fg">{topic.name}</p>
            <p className="mt-0.5 text-[13px] text-ms-fg-2">{usage(topic)}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {editing ? (
          <>
            <button type="button" disabled={busy} onClick={() => void save()} className={buttonClass({ variant: "primary", size: "sm" })}>
              Save
            </button>
            <button type="button" onClick={cancel} className={buttonClass({ variant: "ghost", size: "sm" })}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-label={`Move ${topic.name} up`}
              disabled={busy || first}
              onClick={() => onMove(-1)}
              className={buttonClass({ variant: "ghost", size: "sm", square: true })}
            >
              <Icon name="up" size="sm" />
            </button>
            <button
              type="button"
              aria-label={`Move ${topic.name} down`}
              disabled={busy || last}
              onClick={() => onMove(1)}
              className={buttonClass({ variant: "ghost", size: "sm", square: true })}
            >
              <Icon name="down" size="sm" />
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(true)} className={buttonClass({ variant: "secondary", size: "sm" })}>
              <Icon name="pencil" size="sm" />
              Rename
            </button>
            <button type="button" disabled={busy} onClick={onRetire} className={buttonClass({ variant: "secondary", size: "sm" })}>
              <Icon name="archive" size="sm" />
              Retire
            </button>
            {unused ? (
              <button
                type="button"
                aria-label={`Delete ${topic.name}`}
                disabled={busy}
                onClick={onDelete}
                className={buttonClass({ variant: "ghost", size: "sm", square: true })}
              >
                <Icon name="trash" size="sm" />
              </button>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
