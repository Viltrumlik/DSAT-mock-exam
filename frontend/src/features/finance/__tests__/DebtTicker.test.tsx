/**
 * The band says what is owed and where to go. Its motion and colours are CSS, which jsdom does not
 * run; these hold what the loop and a screen reader depend on in the markup.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DebtTicker } from "../DebtTicker";

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<DebtTicker debt={1250000} />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const copies = () => Array.from(host.querySelectorAll("span"));

describe("DebtTicker", () => {
  it("says the amount and where to go", () => {
    expect(copies()[0].textContent).toBe("You owe 1,250,000 UZS. Please visit the administration.");
  });

  it("gives a screen reader the sentence once", () => {
    const heard = copies().filter((c) => c.getAttribute("aria-hidden") !== "true");
    expect(heard).toEqual([copies()[0]]);
  });

  it("is two identical halves, so sliding by half of itself starts over without a jump", () => {
    const texts = copies().map((c) => c.textContent);
    expect(texts.length % 2).toBe(0);
    expect(new Set(texts).size).toBe(1);
  });
});
