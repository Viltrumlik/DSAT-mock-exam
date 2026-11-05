"use client";

import { cn } from "@/lib/cn";
import { useOverlayFaceClass } from "@/components/ui/OverlayFace";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Ctx = { close: () => void };

const DropdownContext = createContext<Ctx | null>(null);

const GAP = 4;

export function DropdownMenu({
  trigger,
  children,
  align = "end",
  portal = false,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  /** Put the menu on `<body>`, for a trigger inside something that scrolls and would cut it off, like a table. */
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>();
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const face = useOverlayFaceClass();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // On <body> the menu stays where it opened, so it closes rather than drift away from its trigger.
    if (portal) {
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    }
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, portal, close]);

  useLayoutEffect(() => {
    if (!open || !portal || !ref.current || !menuRef.current) return;
    const anchor = ref.current.getBoundingClientRect();
    const height = menuRef.current.offsetHeight;
    const fitsBelow = anchor.bottom + GAP + height <= window.innerHeight;
    setPlace({
      top: fitsBelow ? anchor.bottom + GAP : Math.max(GAP, anchor.top - GAP - height),
      ...(align === "end" ? { right: document.documentElement.clientWidth - anchor.right } : { left: anchor.left }),
    });
  }, [open, portal, align]);

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      style={portal ? place : undefined}
      className={cn(
        "z-[250] min-w-[168px] overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 py-1 shadow-xl shadow-slate-900/10 transition-[opacity,transform] duration-200 animate-[ds-modal-in_0.2s_ease-out]",
        "dark:border-slate-600 dark:bg-slate-900/95 dark:shadow-black/50",
        portal ? cn("fixed", face) : cn("absolute mt-1", align === "end" ? "right-0" : "left-0"),
      )}
    >
      {children}
    </div>
  ) : null;

  return (
    <DropdownContext.Provider value={{ close }}>
      <div className="relative" ref={ref}>
        <div
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          {trigger}
        </div>
        {portal && menu ? createPortal(menu, document.body) : menu}
      </div>
    </DropdownContext.Provider>
  );
}

export function DropdownMenuItem({
  children,
  onClick,
  destructive,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const ctx = useContext(DropdownContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold transition-colors duration-150",
        destructive
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          : "text-foreground hover:bg-primary/10",
        disabled && "pointer-events-none opacity-40",
      )}
      onClick={() => {
        if (disabled) return;
        onClick?.();
        ctx?.close();
      }}
    >
      {children}
    </button>
  );
}
