"""Render a midterm certificate to PDF from the ready HTML template via headless
Chromium (playwright).

The two design templates live in ``certificate_templates/`` and are self-contained
(fonts + markup embedded). We load the template, swap the student's data in by DOM
text replacement (the template ships fixed placeholder text), isolate the certificate
card, let the entrance animations settle, then print a single landscape page.

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
    "NO. MS-2026-0417": "NO. " + d.certNo,
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

# Isolate the card so only it prints, edge-to-edge on a card-sized page.
_ISOLATE = (
    "() => { const s = document.createElement('style'); s.textContent = "
    "'html,body{margin:0!important;padding:0!important;background:#fff!important} "
    "body *{visibility:hidden} #__certcard,#__certcard *{visibility:visible} "
    "#__certcard{position:fixed!important;left:0!important;top:0!important;"
    "width:%dpx!important;height:%dpx!important;margin:0!important;"
    "border-radius:0!important;box-shadow:none!important}'; "
    "document.head.appendChild(s); }" % (CARD_W, CARD_H)
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
        page.wait_for_timeout(1500)  # let the entrance animations finish
        return page.pdf(
            width=f"{CARD_W}px", height=f"{CARD_H}px",
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
