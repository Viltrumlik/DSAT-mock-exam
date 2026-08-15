"""Render a pastpaper certificate to PDF, and hand its error report to the midterm's renderer.

**Two documents, exactly as a midterm has**: a landscape certificate and a separate portrait
error report. Keeping that split is what lets the report be drawn by
``midterms.report_pdf.render_student_error_report_pdf`` unchanged — same header band, same
palette, same summary strip, same chart — so a student who sits both a midterm and a pastpaper
is handed two sheets from one family rather than two unrelated designs.

The certificate half is simpler than its midterm neighbour, and the difference is entirely the
template. That one loads a ~600 KB design export over `file://`, waits for a bundled app to
draw a card, finds it by matching placeholder text, swaps text nodes and stretches the result
onto A4. This renders a Django template to a string and calls `set_content`, because the
template takes variables.

Everything else is deliberately identical: the same Chromium flags (including the Linux font
hinting fix), the same A4 landscape sheet, and the same rule that a rendering failure must
never hard-fail a download.
"""

from __future__ import annotations

import base64
import functools
import logging
import os

from django.conf import settings
from django.template.loader import render_to_string

from .certificate_html_pdf import CHROMIUM_ARGS

logger = logging.getLogger(__name__)

A4_LANDSCAPE = ("297mm", "210mm")

#: The shield artwork the midterm certificate uses, shared so the two cards carry one mark.
ASSET_DIR = os.path.join(settings.BASE_DIR, "static", "certificates")


@functools.lru_cache(maxsize=8)
def _data_uri(filename: str) -> str:
    """A PNG as a base64 data URI, or "" when the asset is missing.

    Inlined rather than referenced, because the page is handed to Chromium via `set_content`
    and therefore has no base URL to resolve a relative path against. Cached because the batch
    path would otherwise re-read and re-encode the same two files per certificate.

    A missing asset returns "" and the template omits the image — a certificate without its
    watermark is worth printing; a 500 on a download is not.
    """
    path = os.path.join(ASSET_DIR, filename)
    try:
        with open(path, "rb") as handle:
            return "data:image/png;base64," + base64.b64encode(handle.read()).decode("ascii")
    except OSError:
        logger.warning("certificate_asset_missing %s", path)
        return ""


def build_context(cert) -> dict:
    """Everything the certificate template needs.

    No report here: the error report is its own document (see ``render_report_pdf``), which is
    what keeps it drawable by the midterm's renderer.
    """
    return {
        "cert": cert,
        "tier": cert.tier_info,
        "shield_white": _data_uri("shield_white.png"),
        "watermark": _data_uri("shield_navy.png"),
    }


def render_html(cert) -> str:
    # Lives under `classes/templates/` so APP_DIRS finds it — NOT in
    # `certificate_templates/`, which holds raw HTML the midterm renderer loads over
    # file:// and which the template loader never looks at.
    return render_to_string("certificates/pastpaper.html", build_context(cert))


def render_report_pdf(attempt) -> bytes:
    """The error report sheet, drawn by the midterm's renderer.

    reportlab, not Chromium — so it needs no browser on the box and cannot fail the way the
    certificate can. That asymmetry is inherited rather than chosen: the midterm's two
    documents are built the same two ways, and matching them is the point.
    """
    from midterms.report_pdf import render_student_error_report_pdf

    from .pastpaper_report import build_error_report

    return render_student_error_report_pdf(
        build_error_report(attempt), heading="Past Paper Error Report"
    )


def render_pdf(cert) -> bytes:
    """PDF bytes for one pastpaper certificate. Raises if Chromium is unavailable."""
    from playwright.sync_api import sync_playwright

    html = render_html(cert)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=CHROMIUM_ARGS)
        try:
            page = browser.new_page(
                viewport={"width": 1200, "height": 850}, device_scale_factor=2
            )
            try:
                # `set_content`, not a file:// load: there is no external asset to wait for,
                # so there is nothing to go and fetch. `load` rather than `networkidle` for
                # the same reason — networkidle on a page that makes no requests just waits
                # out its own timer.
                page.set_content(html, wait_until="load")
                page.evaluate("() => document.fonts && document.fonts.ready")
                return page.pdf(
                    width=A4_LANDSCAPE[0],
                    height=A4_LANDSCAPE[1],
                    scale=1,
                    margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
                    print_background=True,
                )
            finally:
                page.close()
        finally:
            browser.close()


def render_pdf_safe(cert) -> bytes | None:
    """PDF bytes, or ``None`` when the host cannot render.

    Callers turn ``None`` into "the PDF isn't available right now" rather than a 500. There is
    no reportlab fallback here, unlike the midterm path: that fallback exists because midterm
    certificates predate the HTML renderer and a hand-drawn version already existed. Writing a
    second renderer for this one would be two designs to keep in step for a case that only
    arises when Chromium is missing from the box.
    """
    try:
        return render_pdf(cert)
    except Exception:
        logger.exception("pastpaper_certificate_pdf_failed cert=%s", getattr(cert, "pk", None))
        return None
