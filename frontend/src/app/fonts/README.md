# Fonts

Committed so `next build` needs no network. These used to come from `next/font/google`, which
downloads them from Google Fonts during the build: a Google Fonts hiccup failed CI and could fail
a release. The faces are wired up in `src/app/layout.tsx` (Geist, Plus Jakarta Sans, Baloo 2, Geist Mono) and
`src/components/access/fonts.ts` (Playfair Display, and Plus Jakarta Sans again for `/ops/access`).
The layout comment explains why each family is split between a `next/font/local` call (latin) and
`subsets.css` / `playfair-display-subsets.css` (every other subset, plus the fallback face).

## Where the files come from

Byte for byte what `next/font/google` (Next 16.1.6) self-hosted. That is, the woff2 files
listed in Google's CSS for these requests, fetched with the user agent next sends (`Chrome/104`):

| Family | Request | Files |
| --- | --- | --- |
| Geist | `css2?family=Geist:wght@100..900&display=swap` | latin, latin-ext, cyrillic, cyrillic-ext, vietnamese |
| Plus Jakarta Sans | `css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap` | latin, latin-ext, cyrillic-ext, vietnamese |
| Baloo 2 | `css2?family=Baloo+2:wght@600;700;800&display=swap` | latin, latin-ext, devanagari, vietnamese |
| Playfair Display | `css2?family=Playfair+Display:wght@600;700;800&display=swap` | latin, latin-ext, cyrillic, vietnamese |
| Geist Mono | `css2?family=Geist+Mono:wght@100..900&display=swap` | latin, latin-ext, cyrillic, cyrillic-ext, vietnamese, symbols2 |

All five are variable fonts, so Google serves one file per subset and points every weight's
`@font-face` at it. The `unicode-range` values in the CSS files are Google's.

To add a weight, request it from `https://fonts.googleapis.com/<request>` with that user agent.
The file is usually the same one already here. Then add the weight to the `next/font/local` call
and the matching `@font-face` blocks.

## Licence

All five families are under the SIL Open Font License 1.1. The licence and copyright for each
are in the `OFL-*.txt` files next to the fonts, which the licence requires when the fonts are
redistributed. Playfair Display reserves its font name. These files are Google's, unmodified,
so the name stays.

## Geist Mono (added 2026-11-10)

Fetched 2026-11-10 with next's user agent, for the console redesign's monospace face
(`--ms-font-mono`). It was never served by `next/font/google` here, so its `'Geist Mono Fallback'`
face comes from next's own table instead: `getFallbackFontOverrideMetrics("Geist Mono")` in
`next/dist/compiled/@next/font/dist/google` — the same call returns the Geist values above exactly.
The latin file is not preloaded (`preload: false`): only console pages use it.

| File | Bytes | sha256 |
| --- | ---: | --- |
| `geist-mono-cyrillic-ext.woff2` | 6204 | `e27f657e38d52887baa3b6b2f812bef93dfdd356f0810e40edd4ee284cc7e9f6` |
| `geist-mono-cyrillic.woff2` | 12872 | `75b3bedbebc35f347c0ae3b416aa871941555357e7b0f83767eb5987875589ed` |
| `geist-mono-latin-ext.woff2` | 14712 | `745994b5cd950ec201b66526375f057d540847cccfc70f4f24f5f571d26d3923` |
| `geist-mono-latin.woff2` | 23108 | `5f3d6ad60f29d6cb708414ec6887163d63bf197377ef5417d2483ff31ace6c3b` |
| `geist-mono-symbols2.woff2` | 5892 | `d67e4a94ba498635f764ddca7d1ec4271f5642f032eb24b426764480f66f8497` |
| `geist-mono-vietnamese.woff2` | 7728 | `16e1d48b6dd29eb240aec5db36184eb182933c082cd43de7f35af686d58087d2` |
