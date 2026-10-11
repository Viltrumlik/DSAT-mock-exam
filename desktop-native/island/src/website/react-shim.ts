// Build-only stand-in for `react` / `react/jsx-runtime` (aliased in vite.config.ts).
//
// The island imports `prepareRichText` from the website's components/MathText.tsx, which also
// defines a React component the island never renders. Nothing here is ever called at runtime;
// it exists so the bundle needs no React. Tests use the real React (the visual reference
// renders the website's components with it).
const unused = (): never => {
  throw new Error("React is not available inside the island");
};
export const useEffect = unused;
export const useLayoutEffect = unused;
export const useRef = unused;
export const useMemo = unused;
export const useState = unused;
export const useCallback = unused;
export const memo = unused;
export const forwardRef = unused;
export const createElement = unused;
export const jsx = unused;
export const jsxs = unused;
export const jsxDEV = unused;
export const Fragment = "fragment";
export default { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback, memo, forwardRef, createElement };
