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
  The certificates set this precedent with reportlab.
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

ASSET_DIR = os.path.join(settings.BASE_DIR, "static", "certificates")

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
    """The QR as an inline SVG data URI. Error correction M: a ticket gets creased."""
    return segno.make(url, error="m").svg_data_uri(scale=6, border=0, dark="#0f1729")


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
        "logo": _data_uri("shield_navy.png"),
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


def render_png_fallback(registration) -> bytes:
    """A plain card with the same facts, drawn with Pillow.

    No TTF ships in this repo, so the text uses Pillow's own bundled default at a readable
    size. It is not the designed ticket; it is a ticket that opens.
    """
    from PIL import Image, ImageDraw, ImageFont

    context = build_context(registration)
    image = Image.new("RGB", (CARD_W, CARD_H), "#ffffff")
    draw = ImageDraw.Draw(image)

    def font(size: int):
        return ImageFont.load_default(size=size)

    draw.rectangle([0, 0, CARD_W, 140], fill="#2a68c0")
    draw.text((40, 52), "MasterSAT · EVENT TICKET", font=font(28), fill="#ffffff")

    y = 190
    for text, size, colour in (
        (context["event_title"], 40, "#0f1729"),
        (f"{context['weekday_label']} {context['date_label']}", 26, "#334155"),
        (f"{context['start_time']}–{context['end_time']}", 26, "#334155"),
        (context["location"], 24, "#334155"),
        (context["student_name"], 34, "#0f1729"),
    ):
        if text:
            draw.text((40, y), text, font=font(size), fill=colour)
        y += size + 22

    qr_png = io.BytesIO()
    segno.make(context["check_url"], error="m").save(qr_png, kind="png", scale=8, border=1)
    qr_png.seek(0)
    qr = Image.open(qr_png).convert("RGB").resize((320, 320))
    image.paste(qr, ((CARD_W - 320) // 2, y + 40))

    draw.text((40, y + 400), context["ticket_code"], font=font(56), fill="#0f1729")
    draw.text((40, y + 480), "Show this at the door.", font=font(24), fill="#64748b")

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
