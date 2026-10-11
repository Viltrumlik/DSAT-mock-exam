# Fonts

Committed so `next build` needs no network. These used to come from `next/font/google`, which
downloads them from Google Fonts during the build: a Google Fonts hiccup failed CI and could fail
a release. The faces are wired up in `src/app/layout.tsx` (Geist, Plus Jakarta Sans, Baloo 2) and
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

All four are variable fonts, so Google serves one file per subset and points every weight's
`@font-face` at it. The `unicode-range` values in the CSS files are Google's.

To add a weight, request it from `https://fonts.googleapis.com/<request>` with that user agent.
The file is usually the same one already here. Then add the weight to the `next/font/local` call
and the matching `@font-face` blocks.

## Licence

All four families are under the SIL Open Font License 1.1. The licence and copyright for each
are in the `OFL-*.txt` files next to the fonts, which the licence requires when the fonts are
redistributed. Playfair Display reserves its font name. These files are Google's, unmodified,
so the name stays.
