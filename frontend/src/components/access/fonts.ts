import { Playfair_Display, Plus_Jakarta_Sans } from "next/font/google";

// Display serif for headings + geometric sans for body — the MasterSAT Access
// redesign type pairing, scoped to the /ops/access surface via CSS variables.
export const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-playfair",
  display: "swap",
});

export const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});
