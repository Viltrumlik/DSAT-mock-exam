// content.html entry: the question-card island.
import "./styles.css";
import "katex/dist/katex.min.css";

import { detectTransport } from "../transport";
import { ContentIsland } from "./island";

const transport = detectTransport(window);
if (transport) {
  const island = new ContentIsland(transport);
  island.start();
  (window as Window & { __msContentIsland?: ContentIsland }).__msContentIsland = island;
} else {
  // Opened outside a host (no WebView2, no WebKit shim, no harness frame): nothing to drive it.
  console.warn("[island] no native host detected; open dev.html for the fixture harness");
}
