"""The certificate's citation sentence must not repeat its own subject.

The template composes that sentence from three text nodes:

    "for outstanding performance on the MasterSAT June 2026 " + "Math" + " Midterm."

which read correctly while the first was fixed template copy. Once `citation` became the
WHOLE sentence — it ends "... Mathematics midterm" — the last two nodes repeated it, and every
certificate printed:

    "for solid, consistent work on the MasterSAT August 2026 Mathematics midterm Math Midterm."

Two tests, deliberately at different costs. The first is a source guard that runs everywhere
and fails the moment somebody restores the old mapping. The second actually renders the card
and reads the sentence back, and is skipped where Chromium is not installed — which includes
CI, where the PDF path falls back to reportlab anyway.
"""

from __future__ import annotations

import os
import unittest

from django.test import SimpleTestCase

from classes import certificate_html_pdf as html_pdf


def _chromium_available() -> bool:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=html_pdf.CHROMIUM_ARGS)
            browser.close()
        return True
    except Exception:
        return False


class InjectionMapTests(SimpleTestCase):
    """Cheap guard: the mapping itself, without a browser."""

    def test_the_trailing_subject_node_is_emptied(self):
        """`citation` already names the subject, so the standalone "Math" node must go."""
        self.assertIn('"Math": "",', html_pdf._INJECT)

    def test_the_trailing_midterm_node_becomes_a_full_stop(self):
        self.assertIn('" Midterm.": ".",', html_pdf._INJECT)

    def test_the_citation_node_carries_no_trailing_space(self):
        """That space separated the citation from the "Math" node after it. With that node
        emptied, keeping the space prints "... midterm ." with a gap before the full stop."""
        self.assertIn(
            '"for outstanding performance on the MasterSAT June 2026 ": d.citation,',
            html_pdf._INJECT,
        )
        self.assertNotIn("d.citation + \" \"", html_pdf._INJECT)


@unittest.skipUnless(_chromium_available(), "Chromium/playwright not installed")
class RenderedCitationTests(SimpleTestCase):
    """The real thing: render the card and read the sentence back off the DOM."""

    def _render_text(self, variant: str, score: int = 640) -> str:
        from playwright.sync_api import sync_playwright

        from midterms.outcomes import citation_for

        info = citation_for(score, "SCALE_800", period="August 2026", subject="Mathematics")
        data = {
            "score": score, "ceiling": 800,
            "subjectFull": "Mathematics", "subjectShort": "Math",
            "name": "Aziza Karimova", "monthYear": "August 2026",
            "rank": 3, "cohort": 24, "instructor": "Dr. Sarah Chen",
            "dateIssued": "August 15, 2026", "certNo": "MS-2026-0417",
            "citation": info["citation"], "headline": info["headline"],
        }
        path = os.path.join(html_pdf.TEMPLATE_DIR, f"{variant}.html")
        with sync_playwright() as p:
            browser = p.chromium.launch(args=html_pdf.CHROMIUM_ARGS)
            try:
                page = browser.new_page(
                    viewport={"width": html_pdf.CARD_W + 400, "height": html_pdf.CARD_H + 400}
                )
                page.goto("file://" + path, wait_until="networkidle")
                page.wait_for_function(
                    "document.body && document.body.innerText.includes('Aziz Karimov')",
                    timeout=10_000,
                )
                page.evaluate(html_pdf._TAG_CARD)
                page.evaluate(html_pdf._INJECT, data)
                return page.evaluate("() => document.getElementById('__certcard').innerText")
            finally:
                browser.close()

    def _sentence(self, text: str) -> str:
        return next(line for line in text.splitlines() if "MasterSAT" in line and "midterm" in line)

    def test_the_subject_is_named_once_on_the_ranked_card(self):
        sentence = self._sentence(self._render_text("ranked"))

        self.assertIn("Mathematics midterm.", sentence)
        self.assertNotIn("Math Midterm.", sentence)
        self.assertNotIn("midterm .", sentence)      # the stray-space regression

    def test_the_subject_is_named_once_on_the_standalone_card(self):
        sentence = self._sentence(self._render_text("norank"))

        self.assertIn("Mathematics midterm.", sentence)
        self.assertNotIn("Math Midterm.", sentence)

    def test_a_low_score_is_not_praised_for_outstanding_performance(self):
        """The reason the citation replaces the node wholesale in the first place — pinned
        here because this test renders the sentence that rule produces."""
        sentence = self._sentence(self._render_text("ranked", score=250))

        self.assertNotIn("outstanding", sentence)
        self.assertIn("for taking on", sentence)
