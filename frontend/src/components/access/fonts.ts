import localFont from "next/font/local";
import "../../app/fonts/playfair-display-subsets.css";

// Display serif for headings + geometric sans for body — the MasterSAT Access
// redesign type pairing, scoped to the /ops/access surface via CSS variables.
//
// Committed files rather than next/font/google, split the same way and for the reasons in
// src/app/layout.tsx. Playfair's "… Subsets" and "… Fallback" families are in the stylesheet
// imported above; Plus Jakarta's are on every page already, through the root layout's
// src/app/fonts/subsets.css.
export const playfair = localFont({
  src: [
    { path: "../../app/fonts/playfair-display-latin.woff2", weight: "600" },
    { path: "../../app/fonts/playfair-display-latin.woff2", weight: "700" },
    { path: "../../app/fonts/playfair-display-latin.woff2", weight: "800" },
  ],
  variable: "--font-playfair",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["'Playfair Display Subsets'", "'Playfair Display Fallback'"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

export const jakarta = localFont({
  src: [
    { path: "../../app/fonts/plus-jakarta-sans-latin.woff2", weight: "400" },
    { path: "../../app/fonts/plus-jakarta-sans-latin.woff2", weight: "500" },
    { path: "../../app/fonts/plus-jakarta-sans-latin.woff2", weight: "600" },
    { path: "../../app/fonts/plus-jakarta-sans-latin.woff2", weight: "700" },
    { path: "../../app/fonts/plus-jakarta-sans-latin.woff2", weight: "800" },
  ],
  variable: "--font-jakarta",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["'Plus Jakarta Sans Subsets'", "'Plus Jakarta Sans Fallback'"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});
