"""The certificate's tier wording, asserted at every renderer boundary.

Before this file the citation sentence existed as seven independent hard-coded copies
(reportlab, the Chromium injection map, two backend templates, two frontend templates and
the React page) and NOTHING tested the rendered text — so a divergence between the PDF a
student downloads and the card they see on screen would have shipped silently.

These tests pin the single source (``MidtermCertificate.tier_info``) and every consumer
that must read it. PDF bytes are opaque, so the assertions are made on the data each
renderer is handed, which is the boundary that actually has to agree.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from classes.certificate_html_pdf import cert_data
from classes.models_certificates import MidtermCertificate
from classes.views_certificates import serialize_certificate_full
from midterms.outcomes import (
    TIER_DEVELOPING,
    TIER_DISTINGUISHED,
    TIER_EMERGING,
    TIER_PROFICIENT,
)

User = get_user_model()


def _cert(*, score, scale="SCALE_100", subject="MATH", rank=None, cohort=None):
    student = User.objects.create_user(
        username=f"u{score}{scale}{rank}", email=f"u{score}{scale}{rank}@example.com",
        password="x", role="student",
    )
    return MidtermCertificate.objects.create(
        student=student,
        student_name="Aziz Karimov",
        midterm_title="Midterm 12",
        subject=subject,
        score=score,
        scoring_scale=scale,
        rank=rank,
        cohort_size=cohort,
        issued_by_name="Abdulahad N.",
    )


class TierInfoTests(TestCase):
    def test_each_band_gets_its_own_tier(self):
        self.assertEqual(_cert(score=15).tier_info["tier"], TIER_EMERGING)
        self.assertEqual(_cert(score=40).tier_info["tier"], TIER_DEVELOPING)
        self.assertEqual(_cert(score=65).tier_info["tier"], TIER_PROFICIENT)
        self.assertEqual(_cert(score=92).tier_info["tier"], TIER_DISTINGUISHED)

    def test_only_the_top_band_is_called_outstanding(self):
        self.assertIn("outstanding", _cert(score=92).tier_info["citation"])
        for weak in (15, 40, 65):
            self.assertNotIn("outstanding", _cert(score=weak).tier_info["citation"])

    def test_weak_results_do_not_claim_achievement(self):
        # A participation result headed "CERTIFICATE OF ACHIEVEMENT" reads as mockery.
        self.assertNotEqual(_cert(score=15).tier_info["headline"], "CERTIFICATE OF ACHIEVEMENT")
        self.assertEqual(_cert(score=92).tier_info["headline"], "CERTIFICATE OF ACHIEVEMENT")

    def test_800_scale_uses_the_same_bands_as_100(self):
        # A 250/800 paper is weak work, not a 31% "developing" result.
        self.assertEqual(_cert(score=250, scale="SCALE_800").tier_info["tier"], TIER_EMERGING)
        self.assertEqual(_cert(score=740, scale="SCALE_800").tier_info["tier"], TIER_DISTINGUISHED)

    def test_citation_names_the_period_and_subject(self):
        cert = _cert(score=92)
        text = cert.tier_info["citation"]
        self.assertIn(timezone.now().strftime("%B %Y"), text)
        self.assertIn("Mathematics", text)


class RendererAgreementTests(TestCase):
    """Every renderer must be handed the SAME sentence."""

    def test_html_pdf_and_api_payload_agree(self):
        cert = _cert(score=40, rank=3, cohort=24)
        self.assertEqual(cert_data(cert)["citation"], cert.tier_info["citation"])
        self.assertEqual(serialize_certificate_full(cert)["citation"], cert.tier_info["citation"])

    def test_headline_agrees_across_renderers(self):
        cert = _cert(score=15)
        self.assertEqual(cert_data(cert)["headline"], cert.tier_info["headline"])
        self.assertEqual(serialize_certificate_full(cert)["headline"], cert.tier_info["headline"])

    def test_api_payload_carries_the_whole_tier_block(self):
        payload = serialize_certificate_full(_cert(score=65))
        for key in ("tier", "tier_label", "headline", "citation", "note"):
            self.assertIn(key, payload)
            self.assertTrue(payload[key], f"{key} must not be blank")

    def test_reportlab_renders_without_raising_for_every_tier(self):
        # The reportlab path wraps the citation and hard-codes the rank chip against the
        # last body line; a longer tier sentence must not blow it up.
        from classes.certificate_pdf import _render_reportlab_certificate_pdf

        for score, rank, cohort in ((15, None, None), (40, 3, 24), (65, 1, 18), (92, 2, 30)):
            pdf = _render_reportlab_certificate_pdf(_cert(score=score, rank=rank, cohort=cohort))
            self.assertTrue(pdf[:4] == b"%PDF", f"tier at score={score} did not render a PDF")
