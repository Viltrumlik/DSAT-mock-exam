#!/usr/bin/env python3
"""Rebuilds the app's bundled fonts (desktop-native/app/assets/fonts) from the website's.

The website ships Geist and Plus Jakarta Sans as variable .woff2 files split by unicode subset
(frontend/src/app/fonts, Google's files, byte for byte). Flutter needs plain TTF, and picks a
face by its OS/2 weight class, so for each family and each weight the app uses this:

  1. decompresses the latin and latin-ext woff2 files and pins their `wght` axis to the weight
     (fontTools.varLib.instancer) - a static face per weight;
  2. merges latin + latin-ext into one face (fontTools.merge);
  3. maps U+02BB (modifier letter turned comma, the Uzbek o' / g') and U+02BC to the glyphs of
     U+2018 / U+2019 when the font has no glyph of its own for them - neither family draws
     U+02BB, and Uzbek names are written with it;
  4. subsets the result to Basic Latin, Latin-1, Latin Extended-A, the Romanian comma letters,
     the spacing accents, the common combining marks, General Punctuation and currency - every
     OpenType feature kept, no glyph names, no hinting (the source has none);
  5. names the face (family, weight) and writes <Family>-<Weight>.ttf next to the OFL licence.

The output is reproducible: timestamps come from the source files.

    python3 -m pip install --user fonttools brotli     # wheels only
    python3 desktop-native/tool/fonts/build_fonts.py   # from the repo root (or anywhere)

Licence: both families are under the SIL Open Font License 1.1 with no Reserved Font Name, so
a modified (instanced, subset) version may keep its name. The OFL text is copied alongside.
"""
from __future__ import annotations

import io
import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / "frontend" / "src" / "app" / "fonts"
TARGET = REPO / "desktop-native" / "app" / "assets" / "fonts"

# file stem on the website -> (family name in the app, file prefix, licence file)
FAMILIES = {
    "geist": ("Geist", "Geist", "OFL-geist.txt"),
    "plus-jakarta-sans": ("Plus Jakarta Sans", "PlusJakartaSans", "OFL-plus-jakarta-sans.txt"),
}

WEIGHTS = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold"}


def _ranges(*parts: int | tuple[int, int]) -> set[int]:
    out: set[int] = set()
    for p in parts:
        if isinstance(p, int):
            out.add(p)
        else:
            out.update(range(p[0], p[1] + 1))
    return out


KEEP = _ranges(
    (0x0020, 0x007E),  # Basic Latin
    (0x00A0, 0x00FF),  # Latin-1 Supplement
    (0x0100, 0x017F),  # Latin Extended-A
    (0x0218, 0x021B),  # Romanian S/T with comma below
    0x0259,  # schwa
    0x02BB, 0x02BC,  # Uzbek o' g' (turned comma, apostrophe)
    0x02C6, 0x02C7, (0x02D8, 0x02DD),  # spacing accents
    (0x0300, 0x0308), (0x030A, 0x030C), (0x0326, 0x0328),  # combining marks
    (0x2000, 0x206F),  # General Punctuation (dashes, quotes, ellipsis, bullet)
    (0x20A0, 0x20C0),  # currency
    0x2113, 0x2122, 0x2191, 0x2193, 0x2212, 0x2215, 0xFEFF, 0xFFFD,
)

# A code point the fonts lack -> the code point whose glyph stands in for it.
ALIASES = {0x02BB: 0x2018, 0x02BC: 0x2019}


def _instance(path: Path, weight: int) -> io.BytesIO:
    font = TTFont(path)
    static = instancer.instantiateVariableFont(font, {"wght": weight})
    buf = io.BytesIO()
    static.save(buf)
    buf.seek(0)
    return buf


def _alias(font: TTFont) -> None:
    for table in font["cmap"].tables:
        if not table.isUnicode():
            continue
        for missing, donor in ALIASES.items():
            if missing not in table.cmap and donor in table.cmap:
                table.cmap[missing] = table.cmap[donor]


def _name(font: TTFont, family: str, weight: int) -> None:
    style = WEIGHTS[weight]
    ribbi = weight in (400, 700)
    legacy_family = family if ribbi else f"{family} {style}"
    legacy_style = style if ribbi else "Regular"
    full = f"{family} {style}"
    ps = f"{family.replace(' ', '')}-{style}"
    name = font["name"]
    keep = {0, 7, 8, 9, 11, 12, 13, 14}  # copyright, trademark, vendor, designer, URLs, licence
    name.names = [n for n in name.names if n.nameID in keep]
    for name_id, value in ((1, legacy_family), (2, legacy_style), (3, f"{ps};mastersat-app"), (4, full),
                           (5, "Version 1.0; instanced and subset for the MasterSAT app"), (6, ps),
                           (16, family), (17, style)):
        name.setName(value, name_id, 3, 1, 0x409)
    os2 = font["OS/2"]
    os2.usWeightClass = weight
    # fsSelection: bit 0 italic, bit 5 bold, bit 6 regular.
    os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b100000 if weight == 700 else 0) | (0b1000000 if weight == 400 else 0)
    font["head"].macStyle = 1 if weight == 700 else 0


def build_face(stem: str, weight: int) -> TTFont:
    family, _, _ = FAMILIES[stem]
    parts = [_instance(SOURCE / f"{stem}-{sub}.woff2", weight) for sub in ("latin", "latin-ext")]
    merged = Merger().merge(parts)
    merged = TTFont(_saved(merged))
    _alias(merged)

    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.glyph_names = False
    opts.hinting = False
    opts.notdef_outline = True
    opts.drop_tables += ["STAT", "DSIG"]
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=KEEP)
    sub.subset(merged)

    _name(merged, family, weight)
    source_head = TTFont(SOURCE / f"{stem}-latin.woff2")["head"]
    merged["head"].created = source_head.created
    merged["head"].modified = source_head.modified
    merged.recalcTimestamp = False
    return merged


def _saved(font: TTFont) -> io.BytesIO:
    buf = io.BytesIO()
    font.save(buf)
    buf.seek(0)
    return buf


def main() -> int:
    if not SOURCE.is_dir():
        print(f"missing {SOURCE}", file=sys.stderr)
        return 1
    TARGET.mkdir(parents=True, exist_ok=True)
    total = 0
    for stem, (family, prefix, licence) in FAMILIES.items():
        for weight, style in WEIGHTS.items():
            face = build_face(stem, weight)
            out = TARGET / f"{prefix}-{style}.ttf"
            face.save(out)
            cmap = face.getBestCmap()
            for cp in (0x02BB, 0x02BC, 0x2018, 0x2019, 0x201C, 0x201D, ord("o"), ord("g")):
                assert cp in cmap, f"{out.name} lacks U+{cp:04X}"
            size = out.stat().st_size
            total += size
            print(f"{out.relative_to(REPO)}  {size:>7,} bytes  {len(face.getGlyphOrder())} glyphs")
        shutil.copyfile(SOURCE / licence, TARGET / licence)
    print(f"total {total:,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
