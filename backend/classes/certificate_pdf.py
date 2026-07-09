"""Render a midterm certificate to PDF bytes with reportlab — matches the MasterSAT
certificate mockup (blue side band + shield, score badge, subject pill, watermark).

Everything is drawn programmatically (no HTML/headless-browser dependency), so it is
subject-aware and needs no system libraries. The MasterSAT shield assets live in
``backend/static/certificates/`` (shield_white.png, shield_wm.png). Text uses Helvetica;
if a ``certificate.ttf`` (Plus Jakarta Sans) is dropped in that folder it is used instead.

Nothing is written to disk — callers stream the returned bytes.
"""

from __future__ import annotations

import io
import math
import os
from typing import TYPE_CHECKING

from django.conf import settings
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

if TYPE_CHECKING:  # pragma: no cover
    from .models_certificates import MidtermCertificate

PAGE_W, PAGE_H = landscape(A4)  # 842 x 595 pt
ASSETS = os.path.join(settings.BASE_DIR, "static", "certificates")

# Palette (from the mockup).
BG = HexColor("#f0eee6")
CARD = HexColor("#ffffff")
BLUE = HexColor("#2a68c0")
BLUE_DK = HexColor("#173e7f")
NAVY = HexColor("#0f1729")
BLUE_TXT = HexColor("#2a68c0")
GRAY = HexColor("#8a93a2")
BODY = HexColor("#5b6473")
SHADOW = HexColor("#d9d5ca")
CHIP_BG = HexColor("#f4f8ff")
CHIP_BD = HexColor("#d6e3f6")
GOLD = HexColor("#e3a008")

REG, BOLD = "Helvetica", "Helvetica-Bold"
_fonts_ready = False


def _ensure_fonts():
    global _fonts_ready, REG, BOLD
    if _fonts_ready:
        return
    _fonts_ready = True
    try:
        reg = os.path.join(ASSETS, "certificate.ttf")
        bold = os.path.join(ASSETS, "certificate-bold.ttf")
        if os.path.exists(reg):
            pdfmetrics.registerFont(TTFont("CertFont", reg)); REG = "CertFont"; BOLD = "CertFont"
        if os.path.exists(bold):
            pdfmetrics.registerFont(TTFont("CertFont-Bold", bold)); BOLD = "CertFont-Bold"
    except Exception:  # pragma: no cover
        REG, BOLD = "Helvetica", "Helvetica-Bold"


def _spaced(c, font, size, color, x, y, text, ls=0.0, align="left"):
    """Draw text with optional letter-spacing and alignment (via a text object)."""
    text = str(text)
    w = c.stringWidth(text, font, size) + ls * max(len(text) - 1, 0)
    if align == "center":
        x -= w / 2
    elif align == "right":
        x -= w
    t = c.beginText(x, y)
    t.setFont(font, size)
    t.setFillColor(color)
    if ls:
        t.setCharSpace(ls)
    t.textOut(text)
    c.drawText(t)


def _fit_font(c, text, font, max_size, max_w, min_size=14):
    size = max_size
    while size > min_size and c.stringWidth(text, font, size) > max_w:
        size -= 1
    return size


def _wrap(c, text, font, size, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if c.stringWidth(t, font, size) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _grad_rect(c, x, y, w, h, top, bottom):
    c.saveState()
    p = c.beginPath(); p.rect(x, y, w, h); c.clipPath(p, stroke=0, fill=0)
    c.linearGradient(x, y + h, x, y, [top, bottom])
    c.restoreState()


def _grad_circle(c, cx, cy, r, a, b):
    c.saveState()
    p = c.beginPath(); p.circle(cx, cy, r); c.clipPath(p, stroke=0, fill=0)
    c.linearGradient(cx - r, cy + r, cx + r, cy - r, [a, b])
    c.restoreState()


def _img(path):
    return ImageReader(path) if os.path.exists(path) else None


def _star(c, cx, cy, r, color):
    """Filled 5-point star (the class-rank chip icon)."""
    c.saveState()
    c.setFillColor(color)
    p = c.beginPath()
    for i in range(10):
        ang = math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.42
        x, y = cx + rr * math.cos(ang), cy + rr * math.sin(ang)
        (p.moveTo if i == 0 else p.lineTo)(x, y)
    p.close()
    c.drawPath(p, fill=1, stroke=0)
    c.restoreState()


def render_midterm_certificate_pdf(cert: "MidtermCertificate") -> bytes:
    _ensure_fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))

    # Background.
    c.setFillColor(BG); c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    # Card geometry.
    M = 22
    cx, cy, cw, ch = M, M, PAGE_W - 2 * M, PAGE_H - 2 * M
    R = 16
    c.setFillColor(SHADOW); c.roundRect(cx, cy - 4, cw, ch, R, fill=1, stroke=0)  # soft shadow
    c.setFillColor(CARD); c.roundRect(cx, cy, cw, ch, R, fill=1, stroke=0)

    band_w = 132
    # Blue band, clipped to the card's rounded left corners.
    c.saveState()
    cardp = c.beginPath(); cardp.roundRect(cx, cy, cw, ch, R); c.clipPath(cardp, stroke=0, fill=0)
    _grad_rect(c, cx, cy, band_w, ch, BLUE, BLUE_DK)
    c.restoreState()

    band_cx = cx + band_w / 2

    # MasterSAT logo (white) near band top — the same mark used on the on-screen certificate.
    logo = _img(os.path.join(ASSETS, "cert_logo.png")) or _img(os.path.join(ASSETS, "shield_white.png"))
    if logo:
        lh = 66; lw = lh * 590 / 656
        c.drawImage(logo, band_cx - lw / 2, cy + ch - 30 - lh, width=lw, height=lh, mask="auto")

    # Vertical band label.
    c.saveState()
    c.translate(band_cx, cy + ch / 2)
    c.rotate(90)
    _spaced(c, BOLD, 11, HexColor("#dbe6f7"), 0, -4, "MASTERSAT MIDTERM", ls=3.2, align="center")
    c.restoreState()

    # Subject tile near band bottom (frosted lighter-blue on the band).
    tile = 40
    tx0, ty0 = band_cx - tile / 2, cy + 30
    c.setFillColor(HexColor("#5b8ed4"))
    c.roundRect(tx0, ty0, tile, tile, 12, fill=1, stroke=0)
    if cert.subject == "MATH":
        # Vector Σ (Helvetica has no Greek; strokes render reliably everywhere).
        ins = tile * 0.30
        left, right, top, bot = tx0 + ins, tx0 + tile - ins, ty0 + tile - ins, ty0 + ins
        mid = (tx0 + tile / 2, ty0 + tile / 2)
        c.setStrokeColor(HexColor("#ffffff")); c.setLineWidth(2.4); c.setLineJoin(1); c.setLineCap(1)
        p = c.beginPath(); p.moveTo(right, top); p.lineTo(left, top); p.lineTo(*mid)
        p.lineTo(left, bot); p.lineTo(right, bot); c.drawPath(p, stroke=1, fill=0)
    else:
        _spaced(c, BOLD, 20, HexColor("#ffffff"), band_cx, ty0 + tile / 2 - 7, "A", align="center")

    # Main area.
    pad = 34
    mx0 = cx + band_w + pad
    mx1 = cx + cw - pad

    # Classroom flavor (rank present) prints a class-rank chip + a larger heading and no
    # certificate number; standalone prints the certificate number instead (matches the mockups).
    has_rank = cert.rank is not None and cert.cohort_size is not None

    # Header row.
    _spaced(c, BOLD, 14 if has_rank else 10, BLUE_TXT, mx0, cy + ch - 46, "CERTIFICATE OF ACHIEVEMENT", ls=2.2)
    if not has_rank:
        _spaced(c, REG, 10, GRAY, mx1, cy + ch - 46, f"NO. {cert.number}", ls=1.0, align="right")

    # Watermark (faint shield), centred in the main area.
    wm = _img(os.path.join(ASSETS, "shield_wm.png"))
    if wm:
        wmw = 300; wmh = wmw * 656 / 590
        c.drawImage(wm, mx0 + (mx1 - mx0) / 2 - wmw / 2 + 40, cy + ch / 2 - wmh / 2, width=wmw, height=wmh, mask="auto")

    # Score badge (left cluster).
    bx = mx0 + 74
    by = cy + ch * 0.54
    br = 66
    _grad_circle(c, bx, by, br, BLUE, BLUE_DK)
    _spaced(c, BOLD, 44, HexColor("#ffffff"), bx, by - 6, str(cert.score), align="center")
    _spaced(c, BOLD, 8, HexColor("#cdddf5"), bx, by - 30, f"OUT OF {cert.score_ceiling}", ls=1.6, align="center")
    # Subject pill under the badge.
    pill_txt = cert.subject_label
    c.setFont(BOLD, 8.5)
    pw = c.stringWidth(pill_txt, BOLD, 8.5) + 1.4 * (len(pill_txt) - 1) + 26
    c.setFillColor(NAVY)
    c.roundRect(bx - pw / 2, by - br - 30, pw, 21, 10.5, fill=1, stroke=0)
    _spaced(c, BOLD, 8.5, HexColor("#ffffff"), bx, by - br - 24, pill_txt, ls=1.4, align="center")

    # Right cluster: awarded-to + name + body.
    rx = bx + br + 44
    _spaced(c, REG, 13, GRAY, rx, by + 42, "Awarded to")
    name_size = _fit_font(c, cert.student_name, BOLD, 32, mx1 - rx)
    _spaced(c, BOLD, name_size, NAVY, rx, by + 10, cert.student_name)
    body = f"for outstanding performance on the {cert.midterm_title}."
    lines = _wrap(c, body, REG, 11, mx1 - rx)
    yy = by - 16
    for ln in lines[:3]:
        _spaced(c, REG, 11, BODY, rx, yy, ln)
        yy -= 16

    # Class-rank chip (classroom flavor only) — gold star + "CLASS RANK #N / OF M STUDENTS".
    if has_rank:
        l1, l2 = f"CLASS RANK #{cert.rank}", f"OF {cert.cohort_size} STUDENTS"
        w1 = c.stringWidth(l1, BOLD, 10.5)
        w2 = c.stringWidth(l2, REG, 7) + 1.2 * max(len(l2) - 1, 0)
        star_r, gap, padx, ch_h = 7, 9, 13, 30
        ch_w = padx * 2 + star_r * 2 + gap + max(w1, w2)
        box_b = yy - ch_h + 4
        c.setFillColor(CHIP_BG); c.setStrokeColor(CHIP_BD); c.setLineWidth(1)
        c.roundRect(rx, box_b, ch_w, ch_h, 12, fill=1, stroke=1)
        _star(c, rx + padx + star_r, box_b + ch_h / 2, star_r, GOLD)
        tx = rx + padx + star_r * 2 + gap
        _spaced(c, BOLD, 10.5, NAVY, tx, box_b + ch_h / 2 + 1, l1)
        _spaced(c, REG, 7, GRAY, tx, box_b + ch_h / 2 - 9, l2, ls=1.2)

    # Footer: instructor (left) + date (right).
    fy = cy + 46
    fsz = 13 if has_rank else 12
    _spaced(c, BOLD, fsz, NAVY, mx0, fy, cert.issued_by_name or "MasterSAT Instructor")
    _spaced(c, REG, 8.5, GRAY, mx0, fy - 15, "INSTRUCTOR", ls=1.6)
    _spaced(c, BOLD, fsz, NAVY, mx1, fy, cert.date_display, align="right")
    _spaced(c, REG, 8.5, GRAY, mx1, fy - 15, "DATE ISSUED", ls=1.6, align="right")

    c.showPage()
    c.save()
    return buf.getvalue()
