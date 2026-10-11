// desmos.html entry: the calculator island.
import "./styles.css";

import { detectTransport } from "../transport";
import { DesmosIsland } from "./island";

const transport = detectTransport(window);
if (transport) {
  const island = new DesmosIsland(transport);
  island.start();
  (window as Window & { __msDesmosIsland?: DesmosIsland }).__msDesmosIsland = island;
} else {
  console.warn("[island] no native host detected; open dev.html for the fixture harness");
}
