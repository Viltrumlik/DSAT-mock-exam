#!/usr/bin/env python3
"""Builds MasterSAT.ico from desktop/app-icon.png — the same 1024 px source the 0.1.x Tauri app's
`tauri icon` turns into desktop/src-tauri/icons/icon.ico — so both apps carry one logo.

The .ico holds PNG frames at 16, 20, 24, 32, 40, 48, 64, 128 and 256 px (Windows picks per DPI).
Resizing uses macOS `sips` (or Pillow when it is installed); the container is written with the
standard library only.

    python3 desktop-native/packaging/icon/make_icon.py            # writes both copies
    python3 desktop-native/packaging/icon/make_icon.py --check    # exit 1 if they are stale

Writes desktop-native/packaging/icon/MasterSAT.ico (Velopack --icon) and
desktop-native/app/windows/runner/resources/app_icon.ico (the exe's own icon).
"""
from __future__ import annotations

import argparse
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SOURCE = REPO / "desktop" / "app-icon.png"
TARGETS = [
    HERE / "MasterSAT.ico",
    REPO / "desktop-native" / "app" / "windows" / "runner" / "resources" / "app_icon.ico",
]
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def png_frame(size: int, workdir: Path) -> bytes:
    out = workdir / f"{size}.png"
    try:
        from PIL import Image  # type: ignore

        with Image.open(SOURCE) as im:
            im.convert("RGBA").resize((size, size), Image.LANCZOS).save(out, "PNG", optimize=True)
    except ImportError:
        if not shutil.which("sips"):
            sys.exit("make_icon: needs Pillow or macOS sips to resize")
        subprocess.run(
            ["sips", "-s", "format", "png", "-z", str(size), str(size), str(SOURCE), "--out", str(out)],
            check=True,
            capture_output=True,
        )
    return out.read_bytes()


def build_ico() -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        frames = [png_frame(s, Path(tmp)) for s in SIZES]
    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries = b""
    for size, data in zip(SIZES, frames):
        dim = 0 if size >= 256 else size  # 0 means 256 in an ICONDIRENTRY
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return header + entries + b"".join(frames)


def frame_sizes(ico: bytes) -> list[int]:
    _, kind, count = struct.unpack("<HHH", ico[:6])
    if kind != 1:
        return []
    sizes = []
    for i in range(count):
        w = ico[6 + 16 * i]
        sizes.append(256 if w == 0 else w)
    return sizes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="only verify the committed icons have every frame")
    args = ap.parse_args()
    if args.check:
        bad = [str(t) for t in TARGETS if not t.exists() or frame_sizes(t.read_bytes()) != SIZES]
        if bad:
            print("make_icon: stale or missing: " + ", ".join(bad))
            return 1
        print("make_icon: icons have frames " + ", ".join(map(str, SIZES)))
        return 0
    ico = build_ico()
    for target in TARGETS:
        target.write_bytes(ico)
        print(f"make_icon: wrote {target.relative_to(REPO)} ({len(ico)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
