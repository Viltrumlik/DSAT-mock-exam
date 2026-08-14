"""Render a pastpaper certificate (and its error report) to PDF.

Far simpler than its midterm neighbour, and the difference is entirely the template. That one
loads a 600 KB design export over `file://`, waits for a bundled app to draw a card, finds
that card by matching placeholder text, swaps text nodes, and stretches the result onto A4.
This one renders a Django template to a string and calls `set_content` — because the template
was written to take variables.

Everything else is deliberately identical: the same Chromium flags (including the Linux font
hinting fix), the same A4 landscape sheet, and the same rule that a rendering failure must
never hard-fail a download.
"""

from __future__ import annotations

import logging

from django.template.loader import render_to_string

from .certificate_html_pdf import CHROMIUM_ARGS

logger = logging.getLogger(__name__)

A4_LANDSCAPE = ("297mm", "210mm")


def build_context(cert) -> dict:
    """Everything the template needs.

    The report is re-derived here rather than read off the certificate, so a corrected answer
    key reaches a student who downloads their certificate afterwards. The certificate's own
    frozen `questions_correct` is what prints on page 1; if the two ever disagree, that
    disagreement is a real event worth being visible rather than smoothed over.
    """
    from .pastpaper_report import build_error_report

    return {
        "cert": cert,
        "tier": cert.tier_info,
        "report": build_error_report(cert.attempt),
    }


def render_html(cert) -> str:
    # Lives under `classes/templates/` so APP_DIRS finds it — NOT in
    # `certificate_templates/`, which holds raw HTML the midterm renderer loads over
    # file:// and which the template loader never looks at.
    return render_to_string("certificates/pastpaper.html", build_context(cert))


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
