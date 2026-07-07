"""Render a midterm certificate to PDF bytes with reportlab.

Design goal: the *layout* (where each field prints) and the *background* (the branded
template) are both swappable without touching call sites.

- Background: drop a file at ``backend/static/certificates/midterm_template.{png,jpg,jpeg,pdf}``.
  PNG/JPG are drawn directly; a PDF template's first page is rasterised via PyMuPDF (already
  a dependency). With no file present we draw a clean coded placeholder so everything works
  end-to-end before the final design arrives.
- Layout: ``CERT_LAYOUT`` positions are fractions of the page (0..1 from the bottom-left),
  so they are resolution-independent and easy to retune against the real template.
- Font: drop a ``.ttf`` in the same folder to brand the text; otherwise Helvetica is used.

Nothing is written to disk — callers stream the returned bytes.
"""

from __future__ import annotations

import io
import os
from typing import TYPE_CHECKING

from django.conf import settings
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

if TYPE_CHECKING:  # pragma: no cover
    from .models_certificates import MidtermCertificate

PAGE_W, PAGE_H = landscape(A4)  # 842 x 595 pt

_TEMPLATE_DIR = os.path.join(settings.BASE_DIR, "static", "certificates")
_TEMPLATE_STEMS = ("midterm_template",)
_IMAGE_EXTS = (".png", ".jpg", ".jpeg")

# Registered font family names (Helvetica fallback is always available in reportlab).
_FONT_REGULAR = "Helvetica"
_FONT_BOLD = "Helvetica-Bold"
_fonts_ready = False

# Each entry: (x_frac, y_frac, font, size, align). x_frac/y_frac measured from bottom-left.
CERT_LAYOUT = {
    "title":     (0.5, 0.78, "bold",    30, "center"),
    "subtitle":  (0.5, 0.70, "regular", 14, "center"),
    "name":      (0.5, 0.56, "bold",    34, "center"),
    "for_line":  (0.5, 0.45, "regular", 15, "center"),
    "midterm":   (0.5, 0.39, "bold",    20, "center"),
    "score":     (0.32, 0.24, "bold",   22, "center"),
    "rank":      (0.68, 0.24, "bold",   22, "center"),
    "score_lbl": (0.32, 0.19, "regular", 11, "center"),
    "rank_lbl":  (0.68, 0.19, "regular", 11, "center"),
    "footer":    (0.5, 0.09, "regular", 10, "center"),
    "code":      (0.5, 0.05, "regular",  8, "center"),
}


def _ensure_fonts() -> None:
    """Register a bundled TTF once, if the site provides one. Best-effort."""
    global _fonts_ready, _FONT_REGULAR, _FONT_BOLD
    if _fonts_ready:
        return
    _fonts_ready = True
    try:
        reg = os.path.join(_TEMPLATE_DIR, "certificate.ttf")
        bold = os.path.join(_TEMPLATE_DIR, "certificate-bold.ttf")
        if os.path.exists(reg):
            pdfmetrics.registerFont(TTFont("CertFont", reg))
            _FONT_REGULAR = "CertFont"
            _FONT_BOLD = "CertFont"
        if os.path.exists(bold):
            pdfmetrics.registerFont(TTFont("CertFont-Bold", bold))
            _FONT_BOLD = "CertFont-Bold"
    except Exception:  # pragma: no cover - fall back to Helvetica
        _FONT_REGULAR, _FONT_BOLD = "Helvetica", "Helvetica-Bold"


def _find_template() -> str | None:
    for stem in _TEMPLATE_STEMS:
        for ext in (*_IMAGE_EXTS, ".pdf"):
            path = os.path.join(_TEMPLATE_DIR, stem + ext)
            if os.path.exists(path):
                return path
    return None


def _background_image_reader(path: str):
    """Return a reportlab ImageReader for the template, rasterising PDF via PyMuPDF."""
    from reportlab.lib.utils import ImageReader

    if path.lower().endswith(".pdf"):
        import fitz  # PyMuPDF, already a project dependency

        doc = fitz.open(path)
        try:
            page = doc.load_page(0)
            # ~150 DPI is plenty for a full-page A4 background.
            pix = page.get_pixmap(matrix=fitz.Matrix(150 / 72, 150 / 72))
            return ImageReader(io.BytesIO(pix.tobytes("png")))
        finally:
            doc.close()
    return ImageReader(path)


def _draw_placeholder(c: canvas.Canvas) -> None:
    """A simple bordered frame + heading when no branded template is installed yet."""
    c.saveState()
    c.setStrokeColorRGB(0.16, 0.41, 0.75)  # brand blue (#2a68c0)
    c.setLineWidth(4)
    c.rect(0.4 * inch, 0.4 * inch, PAGE_W - 0.8 * inch, PAGE_H - 0.8 * inch)
    c.setLineWidth(1)
    c.rect(0.55 * inch, 0.55 * inch, PAGE_W - 1.1 * inch, PAGE_H - 1.1 * inch)
    c.restoreState()


def _text(c: canvas.Canvas, key: str, value: str) -> None:
    if value is None:
        return
    x_frac, y_frac, font_kind, size, align = CERT_LAYOUT[key]
    font = _FONT_BOLD if font_kind == "bold" else _FONT_REGULAR
    c.setFont(font, size)
    x, y = x_frac * PAGE_W, y_frac * PAGE_H
    text = str(value)
    if align == "center":
        c.drawCentredString(x, y, text)
    elif align == "right":
        c.drawRightString(x, y, text)
    else:
        c.drawString(x, y, text)


def render_midterm_certificate_pdf(cert: "MidtermCertificate") -> bytes:
    """Render ``cert`` to PDF bytes. Uses the installed template if present."""
    _ensure_fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))

    template = _find_template()
    if template:
        try:
            c.drawImage(
                _background_image_reader(template),
                0, 0, width=PAGE_W, height=PAGE_H,
                preserveAspectRatio=False, mask="auto",
            )
        except Exception:
            _draw_placeholder(c)
    else:
        _draw_placeholder(c)

    c.setFillColorRGB(0.10, 0.12, 0.16)
    classroom_name = getattr(getattr(cert, "classroom", None), "name", "") or ""
    issued = cert.issued_at.strftime("%B %d, %Y") if getattr(cert, "issued_at", None) else ""

    _text(c, "title", "Certificate of Achievement")
    _text(c, "subtitle", "This certifies that")
    _text(c, "name", cert.student_name)
    _text(c, "for_line", "has successfully completed the midterm")
    _text(c, "midterm", cert.midterm_title)
    _text(c, "score", cert.score_display())
    _text(c, "score_lbl", "SCORE")
    _text(c, "rank", f"{cert.rank} of {cert.cohort_size}")
    _text(c, "rank_lbl", "CLASS RANKING")
    footer = " · ".join(x for x in (classroom_name, issued) if x)
    _text(c, "footer", footer)
    _text(c, "code", f"Certificate ID: {cert.code}")

    c.showPage()
    c.save()
    return buf.getvalue()
