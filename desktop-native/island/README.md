# The islands

The two WebView2 pages of the native MasterSAT app (architecture.md §2.4–§2.7). Everything
else in the app is Flutter.

| Page | What it shows | Entry |
|---|---|---|
| `content.html` | The question card between the header's and the footer's colour rules: the R&W passage and divider, the header band (number, Mark for Review, ABC), the stem, the choices with cross-out and Undo, or the grid-in input with the directions column; review marking | `src/content/` |
| `desmos.html` | Desmos API v1.11, Graphing and Scientific, inside the frame Flutter draws | `src/desmos/` |

`npm run build` writes `build/island/{content.html, desmos.html, *.js, *.css, KaTeX fonts}`.
WebView2 serves that folder from `https://island.mastersat.example/`. Every URL in it is
relative, each page carries its CSP, and nothing is inlined as `data:`. `scripts/check-build.mjs`
checks all of this after every build.

## Protocol

The source of truth is `protocol/schema.json`. `src/protocol.ts` is generated from it by
foundation, and the island uses both as they are. `src/channel.ts` validates every message
against the schema in both directions:

- **Incoming:** a malformed message is dropped and reported as `error{where:"protocol.in"}`.
- **Outgoing:** a message that would break the schema is refused and reported as `error{where:"protocol.out"}`.

`src/transport.ts` picks the host:

| Host | Island → native | Native → island |
|---|---|---|
| Windows (WebView2) | `chrome.webview.postMessage(obj)` | `PostWebMessageAsJson`, read on `chrome.webview` `message` |
| macOS dev runner (WebKit) | `webkit.messageHandlers.ms.postMessage(json)` | `runJavaScript("window.msIsland.receive(<json>)")` |
| `dev.html` (iframe) | `parent.postMessage({type:"ms-island:to-native", msg})` | `{type:"ms-island:to-web", msg}` |
| tests | `memoryTransport()` | |

## Website code

`parity-manifest.json` lists every website file the island imports, ports, copies CSS from or
runs tests from, together with its git blob hash. `npm run parity` fails when one of those files
changes, or when a port's header no longer names its source. After re-reviewing the port, record
the new hashes with `npm run parity:update`.

- **Imported unchanged** through the `@website/*` alias (`src/website/index.ts`): `annotations.ts`, `richContent.ts` (the KaTeX pipeline), `options.ts`, `questionKind.ts` and `image.ts`.
- **Ported** to framework-free DOM in `src/ported/*`. Each file opens by naming its website source. The ports are `PassagePane`, `AnswerPane`, `ChoiceList`, `SprInput`, `StudentProducedResponseGuide`, `SatColorRule`, `SafeHtml`, `AnnotationToolbar`, and `useAnnotator` → `annotator.ts`.
- **CSS:** `src/content/runner.generated.css` is the runner's rules, copied verbatim from `globals.css` by `scripts/runner-css.mjs`. On top of that, Tailwind 4.2.1 (the website's version) scans the ports' class strings.

## Commands

```sh
npm ci
npm run check          # typecheck, parity, protocol examples, 204 vitest tests, build
npm run visual         # Tier C: island vs website in Chromium; PNGs in test-artifacts/visual/
npm run dev            # http://127.0.0.1:5317/dev.html: fixtures + a fake native
npm run dev:smoke      # the harness driven in Chromium; test-artifacts/dev-harness*.png
```

`npm run visual` and `npm run dev:smoke` need Playwright's Chromium for `playwright-core`
1.61 (revision 1228). Install it with `npx playwright-core install chromium`.

## The tests

**Unit tests (`npm test`, jsdom):**
- `test/content/fixtures.test.tsx`: every question in `contracts/v1` builds, and renders exactly the DOM of the website's own React components, attribute for attribute.
- `protocol.test.ts`: the protocol in both directions.
- `annotations.test.ts`: highlighter offsets, apply and remove, and the round trip.
- `hardening.test.ts`, `transport.test.ts`, `desmos.test.ts`.
- `dev/harness.test.ts`: the island and the fake native end to end.
- `website/website-tests.test.ts`: the website's own tests (`annotations.test.ts`, `reviewOffsetParity.test.ts`, `richContent.test.ts`, `utils.test.ts`), run against the modules the island imports.

**Visual run (`npm run visual`):** the BUILT island under its CSP, served from the virtual host,
compared with the website's markup styled by the website's own `globals.css`. This is compiled by
Tailwind over the whole frontend source, which is how the website builds it.

It also checks in real Chromium:
- the hardening;
- CSP violations;
- question-switch timing;
- the built `desmos.html`: ready, blocked and offline.

## Desmos key

The key is injected at build time from `DESMOS_API_KEY`, or `NEXT_PUBLIC_DESMOS_API_KEY` (the
website's variable). Without either, the build falls back to the website's own public default
key from `loadDesmos.ts`. `desmos.init` carries no key.
