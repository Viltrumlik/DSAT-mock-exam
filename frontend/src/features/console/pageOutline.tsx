"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

/**
 * A page's own tabs, handed to the console shell (design handoff v0.4, Shell board: "A page with tabs becomes a
 * tree: tabs = children, kept in sync with `?tab=`"). The page keeps its tab bar; the panel draws the same tabs —
 * with the page's counts — under the page's item, and a click there runs the page's own tab change.
 *
 * Opt-in: only a `Tabs` with `tree` publishes (a page's top row, never a row inside a dialog). Outside a shell
 * (tests, the student app) publishing does nothing.
 */
export type OutlineTab = { id: string; label: string; count?: number | string; tone?: "critical" | "attention" };

export type PublishedTabs = {
  /** The path the tabs belong to, so a tree never shows under another page while the next one mounts. */
  path: string;
  tabs: OutlineTab[];
  /** The open tab. */
  value: string;
  /** Open a tab, exactly as the page's own tab bar does. */
  select: (id: string) => void;
};

/** What a page needs to publish: the setter, and the path the shell is showing (so no router hook is needed here). */
const PublishContext = createContext<{ set: Dispatch<SetStateAction<PublishedTabs | null>>; path: string } | null>(null);
const TabsContext = createContext<PublishedTabs | null>(null);

export function PageOutlineProvider({ pathname, children }: { pathname: string; children: ReactNode }) {
  const [tabs, setTabs] = useState<PublishedTabs | null>(null);
  const publish = useMemo(() => ({ set: setTabs, path: pathname }), [pathname]);
  return (
    <PublishContext.Provider value={publish}>
      <TabsContext.Provider value={tabs}>{children}</TabsContext.Provider>
    </PublishContext.Provider>
  );
}

/** The open page's tabs, when it published them and they belong to `pathname`. */
export function usePublishedTabs(pathname: string): PublishedTabs | null {
  const tabs = useContext(TabsContext);
  return tabs && tabs.path === pathname ? tabs : null;
}

/**
 * Publish a tab row to the shell. Only plain data crosses (ids, names, counts, the open one), compared as text, so
 * a page re-rendering with a new `onChange` every time never loops; the latest `onChange` is kept in a ref.
 */
export function usePublishTabs(enabled: boolean, tabs: readonly OutlineTab[], value: string, onChange: (id: string) => void) {
  const publish = useContext(PublishContext);
  const set = publish?.set ?? null;
  const pathname = publish?.path ?? "";
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  const select = useCallback((id: string) => latest.current(id), []);
  const snapshot = JSON.stringify({ path: pathname, tabs, value });

  useEffect(() => {
    if (!enabled || !set) return;
    const data = JSON.parse(snapshot) as Omit<PublishedTabs, "select">;
    set({ ...data, select });
  }, [enabled, set, snapshot, select]);

  // Leaving the page (or turning it off) takes its tree away — only if it is still this row's.
  useEffect(() => {
    if (!enabled || !set) return;
    return () => set((current) => (current?.select === select ? null : current));
  }, [enabled, set, select]);
}
