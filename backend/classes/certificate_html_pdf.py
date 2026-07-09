"""Render a midterm certificate to PDF from the ready HTML template via headless
Chromium (playwright).

The two design templates live in ``certificate_templates/`` and are self-contained
(fonts + markup embedded). We load the template, swap the student's data in by DOM
text replacement (the template ships fixed placeholder text), isolate the certificate
card, wait for the embedded fonts to load and the entrance animations to settle, then
print a single A4 landscape page (the card is scaled uniformly to fill the sheet).

    ranked.html  → classroom certificate (Class Rank #N · of M students chip)
    norank.html  → standalone certificate (certificate number, no rank)

If Chromium / playwright isn't available on the host, callers fall back to the legacy
reportlab renderer (see ``certificate_pdf``) so downloads never hard-fail.
"""
from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

from django.conf import settings
from django.utils import timezone

if TYPE_CHECKING:  # pragma: no cover
    from .models_certificates import MidtermCertificate

logger = logging.getLogger(__name__)

TEMPLATE_DIR = os.path.join(settings.BASE_DIR, "classes", "certificate_templates")
CARD_W, CARD_H = 760, 538  # the certificate card's native size (px)

# We print onto a real A4 landscape sheet (297mm × 210mm), full-bleed — the certificate
# fills the whole sheet with NO outer frame/margin. The card's aspect ratio (760/538 ≈
# 1.413) is a hair narrower than A4 landscape (297/210 ≈ 1.414), so we stretch it to fill
# both axes exactly with an independent x/y scale. The vertical stretch is ~0.12% —
# imperceptible, and it guarantees edge-to-edge coverage (no white border anywhere).
A4_LANDSCAPE = ("297mm", "210mm")
_A4_W_PX = 297.0 / 25.4 * 96.0  # A4 landscape width  in CSS px @96dpi (≈1122.52)
_A4_H_PX = 210.0 / 25.4 * 96.0  # A4 landscape height in CSS px @96dpi (≈793.70)
A4_SCALE_X = round(_A4_W_PX / CARD_W, 5)  # ≈ 1.47700
A4_SCALE_Y = round(_A4_H_PX / CARD_H, 5)  # ≈ 1.47528

_SUBJECT_FULL = {
    "MATH": "Mathematics", "MATHEMATICS": "Mathematics",
    "READING": "Reading & Writing", "READING_WRITING": "Reading & Writing",
    "ENGLISH": "English", "READING & WRITING": "Reading & Writing",
}
_SUBJECT_SHORT = {
    "MATH": "Math", "MATHEMATICS": "Math",
    "READING": "Reading", "READING_WRITING": "Reading",
    "ENGLISH": "English",
}


def _subject_key(cert) -> str:
    return (getattr(cert, "subject", "") or "").strip().upper()


def cert_data(cert) -> dict:
    """The values injected over the template's placeholders."""
    subj = _subject_key(cert)
    issued = getattr(cert, "issued_at", None) or timezone.now()
    return {
        "score": int(cert.score or 0),
        "ceiling": int(cert.score_ceiling),
        "subjectFull": _SUBJECT_FULL.get(subj, "Mathematics"),
        "subjectShort": _SUBJECT_SHORT.get(subj, "Math"),
        "name": cert.student_name or "Student",
        "monthYear": issued.strftime("%B %Y"),
        "rank": cert.rank,
        "cohort": cert.cohort_size,
        "instructor": cert.issued_by_name or "Instructor",
        "dateIssued": issued.strftime("%B %-d, %Y"),
        "certNo": cert.code,
    }


# Tag the certificate card (by the template's placeholder name) so we can isolate it.
_TAG_CARD = r"""
() => {
  const card = [...document.querySelectorAll('div')]
    .filter(e => { const r = e.getBoundingClientRect();
      return /Aziz Karimov/.test(e.textContent) && r.width > 500 && r.width < 1100
        && getComputedStyle(e).borderTopLeftRadius !== '0px'; })
    .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
  if (card) card.id = '__certcard';
  return !!card;
}
"""

# Replace the template's fixed placeholder text nodes with the student's data.
_INJECT = r"""
(d) => {
  const repl = {
    "740": String(d.score),
    "out of 800": "out of " + d.ceiling,
    "Mathematics": d.subjectFull,
    "Aziz Karimov": d.name,
    "for outstanding performance on the MasterSAT June 2026 ":
      "for outstanding performance on the MasterSAT " + d.monthYear + " ",
    "Math": d.subjectShort,
    "Class Rank #3": "Class Rank #" + d.rank,
    "of 24 students": "of " + d.cohort + " students",
    "Dr. Sarah Chen": d.instructor,
    "June 21, 2026": d.dateIssued,
    "No. MS-2026-0417": "No. " + d.certNo,  // node is "No." (CSS uppercases it on screen)
  };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  nodes.forEach(n => { if (Object.prototype.hasOwnProperty.call(repl, n.nodeValue)) n.nodeValue = repl[n.nodeValue]; });
  // Remove the subject-icon box (Σ / A) from the rail — kept invisible so the rail's
  // vertical text stays centered.
  const icon = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === '∑');
  if (icon) icon.style.visibility = 'hidden';
}
"""

# Isolate the card so only it prints, anchored at the page origin and stretched to
# exactly fill the A4 sheet (full-bleed, no frame). page.pdf() then prints it at scale 1.
_ISOLATE = (
    "() => { const s = document.createElement('style'); s.textContent = "
    "'html,body{margin:0!important;padding:0!important;background:#fff!important} "
    "body *{visibility:hidden} #__certcard,#__certcard *{visibility:visible} "
    "#__certcard{position:fixed!important;left:0!important;top:0!important;"
    "width:%dpx!important;height:%dpx!important;margin:0!important;"
    "border-radius:0!important;box-shadow:none!important;"
    "transform:scale(%s,%s)!important;transform-origin:top left!important}'; "
    "document.head.appendChild(s); }" % (CARD_W, CARD_H, A4_SCALE_X, A4_SCALE_Y)
)

# Wait for the embedded @font-face fonts to finish loading BEFORE we capture. This is
# the fix for the cramped-text bug: a cold headless Chromium can reach the capture step
# before the fonts are ready, so the text gets laid out with fallback metrics (collapsed
# word spacing). Resolves once every face is loaded (or immediately if the API is absent).
_FONTS_READY = "async () => { if (document.fonts && document.fonts.ready) { await document.fonts.ready; } return true; }"

# Snap every running CSS/Web-Animations entrance animation to its final frame so the
# capture is deterministic regardless of how fast the host renders (no mid-animation frame).
_FINISH_ANIMATIONS = (
    "() => { try { document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} }); } "
    "catch (e) {} }"
)


def _render_on_browser(browser, cert: "MidtermCertificate") -> bytes:
    """Render one certificate to PDF bytes on an already-launched browser."""
    variant = "ranked" if (cert.rank is not None and cert.cohort_size is not None) else "norank"
    path = os.path.join(TEMPLATE_DIR, f"{variant}.html")
    data = cert_data(cert)
    page = browser.new_page(
        viewport={"width": CARD_W + 400, "height": CARD_H + 400},
        device_scale_factor=2,
    )
    try:
        page.goto("file://" + path, wait_until="networkidle")
        # Wait for the bundled app to render the certificate.
        page.wait_for_function(
            "document.body && document.body.innerText.includes('Aziz Karimov')",
            timeout=10_000,
        )
        page.evaluate(_TAG_CARD)
        page.evaluate(_INJECT, data)
        page.evaluate(_ISOLATE)
        # Deterministic capture: fonts loaded (correct spacing), then let the entrance
        # animations run and snap any still-in-flight ones to their final frame.
        page.evaluate(_FONTS_READY)
        page.wait_for_timeout(400)
        page.evaluate(_FINISH_ANIMATIONS)
        page.wait_for_timeout(200)
        # Print onto a real A4 landscape sheet, full-bleed (the card is already stretched
        # to fill it in _ISOLATE, so we print at scale 1 with zero page margins).
        return page.pdf(
            width=A4_LANDSCAPE[0], height=A4_LANDSCAPE[1], scale=1,
            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
            print_background=True, page_ranges="1",
        )
    finally:
        page.close()


def render_certificate_pdf_html(cert: "MidtermCertificate") -> bytes:
    """PDF bytes for one certificate, rendered from the HTML design template."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--disable-gpu"])
        try:
            return _render_on_browser(browser, cert)
        finally:
            browser.close()


def render_certificates_pdf_batch(certs) -> dict:
    """Render many certificates reusing ONE Chromium — ``{code: pdf_bytes}``.

    For the classroom "download all" zip: one browser launch for the whole batch
    instead of one per certificate. Raises if playwright/Chromium is unavailable
    (the caller then falls back to per-cert rendering / reportlab).
    """
    from playwright.sync_api import sync_playwright

    out: dict = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--disable-gpu"])
        try:
            for cert in certs:
                out[cert.code] = _render_on_browser(browser, cert)
        finally:
            browser.close()
    return out
