"""The ticket a student shows at the door.

Rendered the way the pastpaper certificate is: a real Django template with real variables,
handed to headless Chromium through `set_content` and captured as a PNG. Not the midterm
certificates' technique — those inject data by walking text nodes for a placeholder name,
which exists only because those two template files cannot be edited.

Two deliberate choices:

* **Its own fonts, embedded — not a system stack.** The card is mostly a code somebody has
  to read, so it uses the product's own two faces, 'Plus Jakarta Sans' for text and
  'Space Mono' for the code, each followed by a system stack as a fallback. Rather than ship
  a second copy of those font binaries, `_embedded_font_faces` lifts the `@font-face` rules
  straight out of the midterm certificate template (`classes/certificate_templates/
  norank.html`), which already embeds them, and re-serves them here as `font_faces`. See
  that function's docstring for why that template needs more than a plain regex.
* **A Pillow fallback.** A ticket that will not open at the door is worse than a plain one.
  The certificates set this precedent with reportlab. Its text is wrapped and capped to the
  card's own width (`_wrap_lines`) rather than left to run off the edge, and it prefers a
  real TrueType font with broad Unicode coverage over Pillow's bundled default, which has no
  glyph for an en/em dash or a curly quote (`_fallback_font`, `_normalize_for_drawing`).
"""

from __future__ import annotations

import base64
import functools
import io
import json
import logging
import os
import re

import segno
from django.conf import settings
from django.template.loader import render_to_string
from django.utils import timezone

logger = logging.getLogger(__name__)

#: The flags the certificate renderer uses. `--no-sandbox` because the app runs as a
#: non-root user on the production box.
CHROMIUM_ARGS = ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"]

#: The card's native size, in CSS px. 2× device scale makes the capture sharp on a phone.
CARD_W, CARD_H = 720, 1020

#: The card's own left+right margins (see ticket.html's `.body` padding) — the width text
#: actually has to fit inside, on both the designed card and the Pillow fallback.
CARD_INNER_W = CARD_W - 80

ASSET_DIR = os.path.join(settings.BASE_DIR, "static", "certificates")

#: Tried in order; the first that exists is used for the whole Pillow fallback card.
#: Pillow's bundled default (`ImageFont.load_default`) has no glyph for an en/em dash or a
#: curly quote — every fallback ticket showed a tofu box in its time range, and in any place
#: or name that had one. These three cover Latin, Cyrillic and general punctuation broadly.
_FALLBACK_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
)

#: Characters Pillow's bundled default font has no glyph for, mapped to an ASCII look-alike.
#: Applied only when `_fallback_font_path` found nothing to load — a real TrueType font
#: already covers all of these. The ellipsis is `_wrap_lines`'s own truncation mark, drawn
#: on the same font, so it needs the same treatment.
_DEFAULT_FONT_ASCII_MAP = str.maketrans({
    "–": "-",    # – en dash
    "—": "-",    # — em dash
    "‘": "'",    # ‘
    "’": "'",    # ’
    "“": '"',    # “
    "”": '"',    # ”
    "…": "...",  # … (see `_wrap_lines`)
})

#: The two faces the card uses. Both are embedded — see `_embedded_font_faces`.
_FONT_FAMILIES = ("Plus Jakarta Sans", "Space Mono")

_CERT_TEMPLATE_PATH = os.path.join(
    settings.BASE_DIR, "classes", "certificate_templates", "norank.html"
)

_FONT_FACE_RE = re.compile(r"@font-face\s*\{[^}]*\}")
_SRC_UUID_RE = re.compile(r'url\("([0-9a-fA-F-]{8,})"\)')


@functools.lru_cache(maxsize=4)
def _data_uri(filename: str) -> str:
    """A PNG as a base64 data URI, or "" when the asset is missing.

    Inlined because the page is handed to Chromium via `set_content` and has no base URL to
    resolve a relative path against. A missing logo still prints a usable ticket.
    """
    path = os.path.join(ASSET_DIR, filename)
    try:
        with open(path, "rb") as handle:
            return "data:image/png;base64," + base64.b64encode(handle.read()).decode("ascii")
    except OSError:
        logger.warning("ticket_asset_missing %s", path)
        return ""


def _resolve_font_urls(block: str, manifest: dict) -> str:
    """Swap a `@font-face` block's `src: url("<uuid>")` for a real inline `data:` URI."""

    def _swap(match: re.Match) -> str:
        entry = manifest.get(match.group(1))
        if entry is None:
            return match.group(0)
        data = entry.get("data", "")
        if entry.get("compressed"):
            import gzip

            data = base64.b64encode(gzip.decompress(base64.b64decode(data))).decode("ascii")
        return f'url(data:{entry.get("mime", "font/woff2")};base64,{data})'

    return _SRC_UUID_RE.sub(_swap, block)


@functools.lru_cache(maxsize=1)
def _embedded_font_faces() -> str:
    """The `@font-face` rules for our two faces, lifted from the certificate template.

    `norank.html` is not plain HTML: it is a self-unpacking "bundler" export. Its actual
    markup lives as a JSON-encoded string inside a `<script type="__bundler/template">` tag,
    and a sibling `<script type="__bundler/manifest">` carries every embedded asset —
    including these font files — as base64, keyed by the same UUID each `@font-face` block's
    `src: url("...")` names; the bundler's own inline loader script resolves that UUID to a
    blob: URL at runtime. A plain regex over the raw file would lift that JSON-escaped text
    verbatim — wrong quoting, no real newlines, and a `url()` naming an asset nothing outside
    that loader can resolve. So this decodes the template and the manifest the way the loader
    does, then rewrites each matching rule's `src` into a real `data:` URI, so the rule is
    independently usable on a page that never runs the bundler at all.

    Cached for the process's life: the certificate template does not change between requests.
    Returns "" (logging a warning) when the template is missing or yields no matching rule —
    the ticket still renders, just with its fallback stack.
    """
    try:
        with open(_CERT_TEMPLATE_PATH, "r", encoding="utf-8") as handle:
            raw = handle.read()

        manifest_match = re.search(
            r'<script type="__bundler/manifest">(.*?)</script>', raw, re.DOTALL
        )
        template_match = re.search(
            r'<script type="__bundler/template">(.*?)</script>', raw, re.DOTALL
        )
        if not manifest_match or not template_match:
            raise ValueError("certificate template is not a recognised bundle")

        manifest = json.loads(manifest_match.group(1))
        template_html = json.loads(template_match.group(1))

        blocks = [
            _resolve_font_urls(block, manifest)
            for block in _FONT_FACE_RE.findall(template_html)
            if any(family in block for family in _FONT_FAMILIES)
        ]
        if not blocks:
            raise ValueError("no matching @font-face rules found")
        return "\n".join(blocks)
    except Exception:
        logger.warning(
            "ticket_fonts_missing could not extract @font-face rules from %s",
            _CERT_TEMPLATE_PATH,
        )
        return ""


def check_url(code: str) -> str:
    """Where the QR sends whoever scans it: the ops console's own host."""
    site = str(getattr(settings, "OPS_SITE_URL", "https://admin.mastersat.uz")).rstrip("/")
    return f"{site}/ops/events/check/{(code or '').strip().upper()}"


def qr_data_uri(url: str) -> str:
    """The QR as an inline SVG data URI. Error correction M: a ticket gets creased. A
    border of 2 modules gives it a real quiet zone, rather than sitting flush against the
    code with no built-in margin of its own."""
    return segno.make(url, error="m").svg_data_uri(scale=6, border=2, dark="#0f1729")


def build_context(registration) -> dict:
    from .services import format_ticket_code

    event = registration.event
    student = registration.student
    starts = timezone.localtime(event.starts_at)
    ends = timezone.localtime(event.ends_at)
    url = check_url(registration.ticket_code or "")
    full_name = (
        (student.get_full_name() or "").strip()
        or (getattr(student, "username", "") or "").strip()
        or "Student"
    )

    return {
        "student_name": full_name,
        "event_title": event.title,
        "location": (event.location or "").strip(),
        "weekday_label": starts.strftime("%A"),
        "date_label": starts.strftime("%d %B %Y").lstrip("0"),
        "start_time": starts.strftime("%H:%M"),
        "end_time": ends.strftime("%H:%M"),
        "ticket_code": format_ticket_code(registration.ticket_code or ""),
        "check_url": url,
        "qr": qr_data_uri(url),
        # Navy-on-blue was nearly invisible on the band; the white shield reads clearly.
        "logo": _data_uri("shield_white.png"),
        "font_faces": _embedded_font_faces(),
        "card_w": CARD_W,
        "card_h": CARD_H,
    }


def render_html(registration) -> str:
    # Lives under `events/templates/` so APP_DIRS finds it by name.
    return render_to_string("events/ticket.html", build_context(registration))


def _render_png_chromium(registration) -> bytes:
    from playwright.sync_api import sync_playwright

    html = render_html(registration)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=CHROMIUM_ARGS)
        try:
            page = browser.new_page(
                viewport={"width": CARD_W, "height": CARD_H}, device_scale_factor=2
            )
            page.set_content(html, wait_until="load")
            # Wait for the embedded fonts to finish loading before capturing — the same fix
            # `certificate_html_pdf._FONTS_READY` uses, for the same reason: a cold headless
            # Chromium can reach the capture step before the fonts are ready, laying the
            # text out with fallback metrics instead.
            page.evaluate(
                "async () => { if (document.fonts && document.fonts.ready) "
                "{ await document.fonts.ready; } return true; }"
            )
            card = page.query_selector("#ticket")
            if card is None:  # pragma: no cover - the template always carries it
                raise RuntimeError("ticket card not found in the rendered page")
            return card.screenshot(type="png")
        finally:
            browser.close()


@functools.lru_cache(maxsize=1)
def _fallback_font_path() -> str | None:
    """The first broad-coverage TrueType font installed on this host, or None.

    None means `_fallback_font` falls back to Pillow's bundled default anyway — a ticket
    that opens beats one that doesn't — and `_normalize_for_drawing` routes the characters
    that bundled font is missing around it instead.
    """
    for path in _FALLBACK_FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


@functools.lru_cache(maxsize=16)
def _fallback_font(size: int):
    """A font for the Pillow fallback, at `size`, cached per size."""
    from PIL import ImageFont

    path = _fallback_font_path()
    if path:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            logger.warning("ticket_fallback_font_unreadable %s", path)
    return ImageFont.load_default(size=size)


def _normalize_for_drawing(text: str) -> str:
    """Map characters Pillow's bundled default font has no glyph for to ASCII look-alikes.

    A no-op once `_fallback_font_path` found a real TrueType font — DejaVu, Liberation and
    Arial all cover these already.
    """
    if _fallback_font_path() is not None:
        return text or ""
    return (text or "").translate(_DEFAULT_FONT_ASCII_MAP)


def _fallback_time_range(context: dict) -> str:
    """The time range as drawn on the Pillow fallback: ASCII " - ", never an en dash — the
    one piece of text guaranteed to contain one on every single ticket."""
    return f"{context['start_time']} - {context['end_time']}"


def _wrap_lines(text: str, font, max_width: float, max_lines: int) -> list[str]:
    """Word-wrap `text` to `max_width` px, measured with `font`'s own metrics (`getlength`).

    Every returned line fits `max_width` — a single word wider than the card is itself split,
    character by character, rather than left to run off the edge. Capped at `max_lines`
    lines; when there is more text than that, the last line is trimmed to end with "…" and
    still fit. A blank `text` returns []; a text that already fits comes back as one line.
    """
    words = (text or "").split()
    if not words:
        return []

    def split_long_word(word: str) -> list[str]:
        chunks: list[str] = []
        chunk = ""
        for ch in word:
            candidate = chunk + ch
            if chunk and font.getlength(candidate) > max_width:
                chunks.append(chunk)
                chunk = ch
            else:
                chunk = candidate
        if chunk:
            chunks.append(chunk)
        return chunks

    lines: list[str] = []
    current = ""
    for word in words:
        if font.getlength(word) > max_width:
            if current:
                lines.append(current)
                current = ""
            *whole, current = split_long_word(word)
            lines.extend(whole)
            continue
        candidate = f"{current} {word}".strip()
        if current and font.getlength(candidate) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)

    if len(lines) <= max_lines:
        return lines

    kept = lines[:max_lines]
    last = kept[-1]
    while last and font.getlength(last + "…") > max_width:
        last = last[:-1].rstrip()
    kept[-1] = (last + "…") if last else "…"
    return kept


def render_png_fallback(registration) -> bytes:
    """A plain card with the same facts, drawn with Pillow.

    Text is wrapped and capped to the card's own width (`_wrap_lines`) rather than left to
    run off the right edge, on a real TrueType font with broad Unicode coverage when one is
    installed rather than Pillow's bundled default, which has no glyph for an en/em dash or
    a curly quote (`_fallback_font`, `_normalize_for_drawing`). The canvas itself grows past
    its usual height rather than clip a long combination of title, place and name — it is
    drawn on a generously tall scratch image and cropped to the real content height at the
    end. It is not the designed ticket; it is a ticket that opens.
    """
    from PIL import Image, ImageDraw

    context = build_context(registration)
    # CARD_H + 400 comfortably covers the worst case (title at 3 lines, place and name each
    # at 2, all at their line caps) — see LongContentFallbackTests.
    image = Image.new("RGB", (CARD_W, CARD_H + 400), "#ffffff")
    draw = ImageDraw.Draw(image)

    def draw_wrapped(text: str, y: int, size: int, colour: str, max_lines: int) -> int:
        font = _fallback_font(size)
        lines = _wrap_lines(_normalize_for_drawing(text), font, CARD_INNER_W, max_lines)
        for i, line in enumerate(lines):
            draw.text((40, y), line, font=font, fill=colour)
            y += size + (8 if i < len(lines) - 1 else 22)
        return y

    draw.rectangle([0, 0, CARD_W, 140], fill="#2a68c0")
    draw.text(
        (40, 52), _normalize_for_drawing("MasterSAT · EVENT TICKET"),
        font=_fallback_font(28), fill="#ffffff",
    )

    y = 190
    y = draw_wrapped(context["event_title"], y, 40, "#0f1729", max_lines=3)
    when = _normalize_for_drawing(f"{context['weekday_label']} {context['date_label']}")
    draw.text((40, y), when, font=_fallback_font(26), fill="#334155")
    y += 26 + 22
    draw.text((40, y), _fallback_time_range(context), font=_fallback_font(26), fill="#334155")
    y += 26 + 22
    y = draw_wrapped(context["location"], y, 24, "#334155", max_lines=2)
    y = draw_wrapped(context["student_name"], y, 34, "#0f1729", max_lines=2)
    y += 8

    qr_png = io.BytesIO()
    segno.make(context["check_url"], error="m").save(qr_png, kind="png", scale=8, border=1)
    qr_png.seek(0)
    qr = Image.open(qr_png).convert("RGB").resize((320, 320))
    image.paste(qr, ((CARD_W - 320) // 2, y + 40))

    draw.text(
        (40, y + 400), context["ticket_code"], font=_fallback_font(56), fill="#0f1729",
    )
    draw.text(
        (40, y + 480), "Show this at the door.", font=_fallback_font(24), fill="#64748b",
    )

    final_h = max(CARD_H, y + 480 + 40)
    if final_h < image.height:
        image = image.crop((0, 0, CARD_W, final_h))

    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def render_png(registration) -> bytes:
    """PNG bytes for one ticket. Chromium, falling back to Pillow on any browser problem."""
    try:
        return _render_png_chromium(registration)
    except Exception:  # noqa: BLE001 — any playwright/chromium issue → the plain card
        logger.exception(
            "ticket_render_failed registration=%s; falling back to Pillow", registration.pk
        )
        return render_png_fallback(registration)
