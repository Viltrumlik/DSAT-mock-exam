"""
M5 — Math import unblock: external_id, student_answer, and PDF image extraction.

external_id is the official source id (unique across questions); student_answer is
recorded SEPARATELY from correct_answer; PDF images are extracted (PyMuPDF) and
carried best-effort onto candidates → bank questions.
"""
from __future__ import annotations

import os
import tempfile

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from questionbank.dedup import find_by_external_id
from questionbank.import_pipeline import create_batch_from_pages, promote_batch
from questionbank.models import BankQuestion, ImportCandidate, QuestionStatus, Subject
from questionbank.pdf_parser import parse_pages
from questionbank.services import create_bank_question

User = get_user_model()

try:
    import fitz  # PyMuPDF

    HAVE_FITZ = True
except ImportError:  # pragma: no cover
    HAVE_FITZ = False

def _png_bytes() -> bytes:
    """A valid small PNG (Pillow is a hard dependency)."""
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()

_MATH_PAGE = """Test: Math
Question ID cb-math-001
Question
Which value satisfies 2x = 6?
A. 1
B. 2
C. 3
D. 4
Correct Answer: C
Student Answer: B
Rationale
Dividing both sides by 2 gives x = 3.
"""

# English text-only — the only kind PDF import accepts.
_ENG_PAGE = """Test: Reading and Writing
Question ID cb-eng-001
Question
Which choice best completes the text?
A. one
B. two
C. three
D. four
Correct Answer: C
Student Answer: B
Rationale
The student chose two, but three is correct.
"""


class ParserExternalAndStudentTests(TestCase):
    def test_parses_external_id_and_separate_student_answer(self):
        [q] = parse_pages([_MATH_PAGE])
        self.assertEqual(q.external_id, "cb-math-001")
        self.assertEqual(q.correct_answer, "C")
        self.assertEqual(q.student_answer, "B")  # distinct from correct
        self.assertEqual(q.subject, "MATH")
        self.assertEqual(q.options["C"], "3")


# Real College Board export layout: "Question ID:" starts each record, and the
# header is COLUMNAR — bare labels (Assessment/Test/Domain/Skill/Difficulty) then
# their values as a separate block in the same order.
_COLUMNAR_EXPORT = """Question ID: id-001
Assessment
Test
Domain
Skill
Difficulty
SAT
Reading and Writing
Information and Ideas
Inferences
Hard
Question
First stem text?
Answer
A. one
B. two
C. three
D. four
Correct Answer: B
Rationale
Because two is right.
Question ID: id-002
Assessment
Test
Domain
Skill
Difficulty
SAT
Math
Algebra
Linear functions
Medium
Question
Second stem text?
Answer
A. 1
B. 2
C. 3
D. 4
Correct Answer: C
Rationale
Because three.
"""


class ColumnarExportTests(TestCase):
    def test_columnar_header_and_record_boundaries(self):
        qs = parse_pages([_COLUMNAR_EXPORT])
        self.assertEqual(len(qs), 2)
        q1, q2 = qs
        # external_id aligns to the right record (the boundary fix).
        self.assertEqual(q1.external_id, "id-001")
        self.assertEqual(q2.external_id, "id-002")
        # Columnar labels mapped positionally to values.
        self.assertEqual(q1.subject, "ENGLISH")
        self.assertEqual(q1.raw_domain, "Information and Ideas")
        self.assertEqual(q1.raw_skill, "Inferences")
        self.assertEqual(q1.raw_difficulty, "Hard")
        self.assertEqual(q1.correct_answer, "B")
        self.assertEqual(q2.subject, "MATH")
        self.assertEqual(q2.raw_domain, "Algebra")
        self.assertEqual(q2.correct_answer, "C")
        # The "Answer" choice-list header must not pollute the stem.
        self.assertNotIn("Answer", q1.question_text)


class ExternalIdUniquenessTests(TestCase):
    def test_cross_question_duplicate_external_id_rejected(self):
        create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="first",
            external_id="dup-1",
        )
        with self.assertRaises(ValidationError):
            create_bank_question(
                subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="second",
                external_id="dup-1",
            )

    def test_blank_external_id_is_not_unique(self):
        create_bank_question(subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="a")
        # A second blank-external_id question must be allowed.
        create_bank_question(subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="b")
        self.assertEqual(BankQuestion.objects.filter(external_id="").count(), 2)


class ImportExternalIdDedupTests(TestCase):
    def test_candidate_matching_existing_external_id_flagged_duplicate(self):
        existing = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="seen",
            external_id="cb-math-001",
        )
        batch = create_batch_from_pages([_MATH_PAGE], filename="m.pdf")
        cand = batch.candidates.get()
        self.assertEqual(cand.external_id, "cb-math-001")
        self.assertEqual(cand.student_answer, "B")
        self.assertEqual(cand.validation_status, ImportCandidate.Validation.DUPLICATE)
        self.assertEqual(cand.duplicate_of_id, existing.id)
        self.assertIsNotNone(find_by_external_id("cb-math-001"))

    def test_promote_carries_external_id_and_student_answer(self):
        # English text-only is importable; verify external_id + student_answer carry.
        batch = create_batch_from_pages([_ENG_PAGE], filename="rw.pdf")
        promote_batch(batch)
        q = BankQuestion.objects.get(external_id="cb-eng-001")
        self.assertEqual(q.status, QuestionStatus.TRIAGE)
        self.assertEqual(q.student_answer, "B")
        self.assertEqual(q.correct_answer, "C")  # never overwritten by student answer

    def test_math_candidate_is_excluded(self):
        batch = create_batch_from_pages([_MATH_PAGE], filename="m.pdf")
        cand = batch.candidates.get()
        self.assertEqual(cand.validation_status, ImportCandidate.Validation.ERROR)
        self.assertEqual(promote_batch(batch), 0)


def _make_pdf_with_image(path: str, text: str) -> None:
    doc = fitz.open()
    page = doc.new_page()
    y = 72
    for line in text.split("\n"):
        page.insert_text((72, y), line)
        y += 14
    page.insert_image(fitz.Rect(72, 400, 172, 500), stream=_png_bytes())
    doc.save(path)
    doc.close()


def _make_pdf_with_vector_chart(path: str, text: str) -> None:
    """Page with a VECTOR-drawn figure (no embedded raster) in the body region."""
    doc = fitz.open()
    page = doc.new_page()
    y = 72
    for line in text.split("\n"):
        page.insert_text((72, y), line)
        y += 14
    shape = page.new_shape()
    shape.draw_rect(fitz.Rect(90, 240, 400, 480))     # 310×240 chart frame (below header band)
    for gx in (150, 220, 290, 360):                   # "bars"
        shape.draw_line(fitz.Point(gx, 480), fitz.Point(gx, 320))
    shape.finish(color=(0, 0, 0), width=1.0)
    shape.commit()
    doc.save(path)
    doc.close()


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class PdfImageExtractionTests(TestCase):
    def setUp(self):
        if not HAVE_FITZ:
            self.skipTest("PyMuPDF not installed")

    def test_extract_page_images_finds_embedded_image(self):
        from questionbank.pdf_text import extract_page_images

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            path = tmp.name
        try:
            _make_pdf_with_image(path, _MATH_PAGE)
            images = extract_page_images(path)
            self.assertIn(1, images)
            self.assertTrue(images[1])  # at least one (ext, bytes)
        finally:
            os.unlink(path)

    def test_vector_chart_is_rendered_as_figure(self):
        """A vector-drawn chart (no embedded raster) is rendered to a PNG figure."""
        from questionbank.pdf_text import extract_page_images

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            path = tmp.name
        try:
            _make_pdf_with_vector_chart(path, _MATH_PAGE)
            images = extract_page_images(path)
            self.assertIn(1, images)
            ext, data = images[1][0]
            self.assertEqual(ext, "png")
            self.assertGreater(len(data), 500)  # a real raster render of the region
        finally:
            os.unlink(path)

    def test_figure_question_is_excluded_from_import(self):
        """Policy: a question on a page with a figure is excluded (author manually)."""
        from questionbank.import_pipeline import create_batch_from_pdf

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            path = tmp.name
        try:
            _make_pdf_with_image(path, _ENG_PAGE)  # English text + an embedded figure
            batch = create_batch_from_pdf(path, filename="rw.pdf")
        finally:
            os.unlink(path)

        cand = batch.candidates.get()
        self.assertEqual(cand.validation_status, ImportCandidate.Validation.ERROR)
        self.assertTrue(any("figure" in m.lower() for m in cand.validation_messages))
        self.assertEqual(promote_batch(batch), 0)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class UploadEndpointTests(TestCase):
    def setUp(self):
        if not HAVE_FITZ:
            self.skipTest("PyMuPDF not installed")
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="upload-admin@example.com", password="pw",
            role="super_admin", is_staff=True, is_superuser=True,
        )
        self.client.force_authenticate(self.admin)

    def test_upload_pdf_creates_batch_with_candidates(self):
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            path = tmp.name
        try:
            _make_pdf_with_image(path, _MATH_PAGE)
            with open(path, "rb") as fh:
                pdf_bytes = fh.read()
        finally:
            os.unlink(path)

        upload = SimpleUploadedFile("math.pdf", pdf_bytes, content_type="application/pdf")
        res = self.client.post(reverse("questionbank:batch-upload"), {"file": upload}, format="multipart")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["total_candidates"], 1)

    def test_non_pdf_rejected(self):
        bad = SimpleUploadedFile("notes.txt", b"hello", content_type="text/plain")
        res = self.client.post(reverse("questionbank:batch-upload"), {"file": bad}, format="multipart")
        self.assertEqual(res.status_code, 400)
