"""Render the admin classroom midterm report to A4 portrait PDF bytes with reportlab.

Deliberately NOT the Chromium/HTML path the certificate uses: that renderer needs
``playwright install chromium`` on the host, which is an acceptable dependency for a single
ornate certificate but not for a table an administrator prints every term. Everything here
is drawn programmatically, so the endpoint cannot fail for a missing browser.

Fonts and the letter-spaced text helper are taken from ``classes.certificate_pdf`` so the
two documents read as one family. ``REG``/``BOLD`` there are module globals rebound by
``_ensure_fonts()``, so they must be read AFTER that call — never imported by value.
"""

from __future__ import annotations

import io
import math
import os

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from classes import certificate_pdf as certs

PAGE_W, PAGE_H = A4  # 595 x 842 pt

# Same palette as the certificate, plus the three verdict colours.
BG = HexColor("#ffffff")
BLUE = HexColor("#2a68c0")
BLUE_DK = HexColor("#173e7f")
NAVY = HexColor("#0f1729")
GRAY = HexColor("#8a93a2")
BODY = HexColor("#5b6473")
LINE = HexColor("#e3e8f0")
HEAD_BG = HexColor("#f4f8ff")
ZEBRA = HexColor("#fafbfd")

PASS_BG, PASS_TXT = HexColor("#e6f6ec"), HexColor("#1a7f43")
FAIL_BG, FAIL_TXT = HexColor("#fdeaea"), HexColor("#c02626")
NEUTRAL_BG, NEUTRAL_TXT = HexColor("#eef0f4"), HexColor("#6b7280")

MARGIN = 40
BAND_H = 92
SUMMARY_H = 56
ROW_H = 22
HEAD_H = 24
FOOTER_Y = 40
TABLE_FLOOR = FOOTER_Y + 24  # lowest y a row may start at

# #, Student, Midterm, Result, Retake, Retake result, Final — sums to 515 (595 - 2*40).
COLUMNS = [
    ("#", 26),
    ("Student", 140),
    ("Midterm", 58),
    ("Result", 72),
    ("Retake", 58),
    ("Retake result", 79),
    ("Final", 82),  # widest label is "Passed (retake)"
]

# Wording the table prints for each machine status.
FINAL_LABELS = {
    "PASSED": ("Passed", PASS_BG, PASS_TXT),
    "PASSED_ON_RETAKE": ("Passed (retake)", PASS_BG, PASS_TXT),
    "FAILED": ("Failed", FAIL_BG, FAIL_TXT),
    "ABSENT": ("Absent", NEUTRAL_BG, NEUTRAL_TXT),
    "PENDING": ("Pending", NEUTRAL_BG, NEUTRAL_TXT),
    # A finished pre-midterm: scored but never judged, so it is not "pending" anything.
    "NOT_GRADED": ("Not graded", NEUTRAL_BG, NEUTRAL_TXT),
}


def _fonts():
    certs._ensure_fonts()
    return certs.REG, certs.BOLD


def _text(c, font, size, color, x, y, s, ls=0.0, align="left"):
    certs._spaced(c, font, size, color, x, y, s, ls=ls, align=align)


def _truncate(c, s, font, size, max_w):
    if c.stringWidth(s, font, size) <= max_w:
        return s
    while s and c.stringWidth(s + "…", font, size) > max_w:
        s = s[:-1]
    return s + "…"


def _date(dt) -> str:
    return f"{dt.day} {dt.strftime('%B %Y')}" if dt else "—"


def _datetime(dt) -> str:
    return f"{dt.day} {dt.strftime('%B %Y, %H:%M')}" if dt else "—"


def _pill(c, x, y, w, label, bg, fg):
    """Colour-coded verdict pill, centred in its cell."""
    _reg, bold = _fonts()
    size = 7.5
    tw = c.stringWidth(label, bold, size)
    pw = min(w - 6, tw + 12)
    px = x + (w - pw) / 2
    c.setFillColor(bg)
    c.roundRect(px, y - 4, pw, 15, 7.5, fill=1, stroke=0)
    _text(c, bold, size, fg, px + pw / 2, y, _truncate(c, label, bold, size, pw - 8), align="center")


def _cell_state_label(state, passed, score) -> tuple:
    """(label, bg, fg) for one sitting's Result cell."""
    if state is None:
        return ("—", NEUTRAL_BG, NEUTRAL_TXT)
    if state == "ABSENT":
        return ("Absent", NEUTRAL_BG, NEUTRAL_TXT)
    if passed is True:
        return ("Pass", PASS_BG, PASS_TXT)
    if passed is False:
        return ("Fail", FAIL_BG, FAIL_TXT)
    if score is None:
        return ("In progress", NEUTRAL_BG, NEUTRAL_TXT)
    return ("Scored", NEUTRAL_BG, NEUTRAL_TXT)


def _header_band(c, classroom, midterm, scheduled_at, generated_at):
    reg, bold = _fonts()
    y0 = PAGE_H - BAND_H
    c.setFillColor(BLUE)
    c.rect(0, y0, PAGE_W, BAND_H, fill=1, stroke=0)

    # Logo mark (same asset as the certificate); falls back to a wordmark when absent.
    logo_path = os.path.join(certs.ASSETS, "cert_logo.png")
    lx = MARGIN
    if os.path.exists(logo_path):
        lh = 30
        lw = lh * 590 / 656
        c.drawImage(ImageReader(logo_path), lx, y0 + BAND_H - 22 - lh, width=lw, height=lh, mask="auto")
        lx += lw + 10
    _text(c, bold, 14, HexColor("#ffffff"), lx, y0 + BAND_H - 34, "Midterm Results Report", ls=0.6)

    left = f"{classroom['name']}"
    if classroom.get("teacher_name"):
        left += f"  ·  {classroom['teacher_name']}"
    _text(c, reg, 9.5, HexColor("#cdddf5"), MARGIN, y0 + 26, _truncate(c, left, reg, 9.5, 300))
    if classroom.get("level"):
        _text(c, reg, 8, HexColor("#9dbdea"), MARGIN, y0 + 13, classroom["level"].upper(), ls=1.2)

    rx = PAGE_W - MARGIN
    _text(c, bold, 10.5, HexColor("#ffffff"), rx, y0 + 40, _truncate(c, midterm["title"], bold, 10.5, 240), align="right")
    _text(c, reg, 9, HexColor("#cdddf5"), rx, y0 + 26, _date(scheduled_at), align="right")
    _text(c, reg, 7.5, HexColor("#9dbdea"), rx, y0 + 13, f"GENERATED {_datetime(generated_at)}", ls=0.8, align="right")


def _summary_strip(c, summary, y0):
    """4-up Students / Passed / Failed / Pass mark strip."""
    reg, bold = _fonts()
    cells = [
        ("Students", str(summary["students"]), NAVY),
        ("Passed", str(summary["passed"]), PASS_TXT),
        ("Failed", str(summary["failed"]), FAIL_TXT),
        ("Pass mark", "—" if summary.get("pass_mark") is None else str(summary["pass_mark"]), BLUE),
    ]
    gap = 10
    w = (PAGE_W - 2 * MARGIN - gap * 3) / 4
    for i, (label, value, color) in enumerate(cells):
        x = MARGIN + i * (w + gap)
        c.setFillColor(HEAD_BG)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.8)
        c.roundRect(x, y0, w, SUMMARY_H, 8, fill=1, stroke=1)
        _text(c, reg, 7.5, GRAY, x + w / 2, y0 + SUMMARY_H - 18, label.upper(), ls=1.2, align="center")
        _text(c, bold, 20, color, x + w / 2, y0 + 12, value, align="center")


def _table_header(c, y):
    reg, bold = _fonts()
    c.setFillColor(HEAD_BG)
    c.rect(MARGIN, y, PAGE_W - 2 * MARGIN, HEAD_H, fill=1, stroke=0)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.8)
    c.line(MARGIN, y, PAGE_W - MARGIN, y)
    c.line(MARGIN, y + HEAD_H, PAGE_W - MARGIN, y + HEAD_H)
    x = MARGIN
    for title, w in COLUMNS:
        align = "left" if title in ("#", "Student") else "center"
        tx = x + 6 if align == "left" else x + w / 2
        _text(c, bold, 7.5, BODY, tx, y + 9, title.upper(), ls=0.9, align=align)
        x += w
    return y - ROW_H


def _row(c, y, index, row):
    reg, bold = _fonts()
    if index % 2 == 0:
        c.setFillColor(ZEBRA)
        c.rect(MARGIN, y, PAGE_W - 2 * MARGIN, ROW_H, fill=1, stroke=0)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(MARGIN, y, PAGE_W - MARGIN, y)

    ty = y + 7
    x = MARGIN
    widths = [w for _, w in COLUMNS]

    _text(c, reg, 8, GRAY, x + 6, ty, str(index + 1))
    x += widths[0]
    _text(c, bold, 8.5, NAVY, x + 6, ty, _truncate(c, row["student_name"], bold, 8.5, widths[1] - 12))
    x += widths[1]

    score = row["midterm_score"]
    _text(c, bold, 9, NAVY if score is not None else GRAY, x + widths[2] / 2, ty, "—" if score is None else str(score), align="center")
    x += widths[2]
    label, bg, fg = _cell_state_label(row["midterm_state"], row["midterm_passed"], score)
    _pill(c, x, ty, widths[3], label, bg, fg)
    x += widths[3]

    r_score = row["retake_score"]
    if not row["retake_eligible"]:
        # A student who passed was never offered a retake — an em dash, not a zero.
        _text(c, reg, 9, GRAY, x + widths[4] / 2, ty, "—", align="center")
        x += widths[4]
        _text(c, reg, 8, GRAY, x + widths[5] / 2, ty, "—", align="center")
        x += widths[5]
    else:
        _text(c, bold, 9, NAVY if r_score is not None else GRAY, x + widths[4] / 2, ty, "—" if r_score is None else str(r_score), align="center")
        x += widths[4]
        label, bg, fg = _cell_state_label(row["retake_state"], row["retake_passed"], r_score)
        _pill(c, x, ty, widths[5], label, bg, fg)
        x += widths[5]

    label, bg, fg = FINAL_LABELS.get(row["final_status"], (row["final_status"], NEUTRAL_BG, NEUTRAL_TXT))
    _pill(c, x, ty, widths[6], label, bg, fg)


def _footer(c, page, total):
    reg, _bold = _fonts()
    c.setStrokeColor(LINE)
    c.setLineWidth(0.8)
    c.line(MARGIN, FOOTER_Y + 14, PAGE_W - MARGIN, FOOTER_Y + 14)
    _text(c, reg, 8, GRAY, MARGIN, FOOTER_Y, "MasterSAT  ·  mastersat.uz")
    _text(c, reg, 8, GRAY, PAGE_W - MARGIN, FOOTER_Y, f"Page {page} of {total}", align="right")


def _rows_per_page(first: bool) -> int:
    top = PAGE_H - BAND_H - 18 - SUMMARY_H - 22 if first else PAGE_H - 54
    return max(1, int((top - HEAD_H - TABLE_FLOOR) // ROW_H))


def paginate(rows) -> list[list[dict]]:
    """Split rows into pages. A 30-student class must not be cut off at page 1."""
    pages, remaining, first = [], list(rows), True
    while True:
        take = _rows_per_page(first)
        pages.append(remaining[:take])
        remaining = remaining[take:]
        first = False
        if not remaining:
            return pages


def render_classroom_midterm_report_pdf(
    *, classroom, midterm, retake, summary, rows, scheduled_at=None, generated_at=None
) -> bytes:
    """PDF bytes for one classroom's results on one midterm."""
    _fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
    pages = paginate(rows)
    total = len(pages)

    index = 0
    for page_no, page_rows in enumerate(pages, start=1):
        c.setFillColor(BG)
        c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        if page_no == 1:
            _header_band(c, classroom, midterm, scheduled_at, generated_at)
            strip_y = PAGE_H - BAND_H - 18 - SUMMARY_H
            _summary_strip(c, summary, strip_y)
            y = strip_y - 22 - HEAD_H
        else:
            reg, bold = _fonts()
            _text(c, bold, 9, BODY, MARGIN, PAGE_H - 40, _truncate(c, f"{classroom['name']} · {midterm['title']}", bold, 9, 380))
            _text(c, reg, 8, GRAY, PAGE_W - MARGIN, PAGE_H - 40, "continued", align="right")
            y = PAGE_H - 54 - HEAD_H
        y = _table_header(c, y)
        for row in page_rows:
            _row(c, y, index, row)
            index += 1
            y -= ROW_H
        c.setStrokeColor(LINE)
        c.setLineWidth(0.8)
        c.line(MARGIN, y + ROW_H, PAGE_W - MARGIN, y + ROW_H)
        _footer(c, page_no, total)
        c.showPage()

    c.save()
    return buf.getvalue()


# ── student error report ─────────────────────────────────────────────────────
# A second, differently-shaped document from the same module so both PDFs share the
# palette, fonts and header band — a student and an admin should recognise them as
# one family. It is built from the SAME payload the API and the on-screen chart use
# (midterms.views_report.build_error_report), so the sheet a student downloads can
# never disagree with the sheet they were looking at.

CHART_H = 150          # plot area height
# Angled skill labels. A label of length L rotated by LABEL_ANGLE reaches L*cos(angle) to the
# LEFT and L*sin(angle) DOWN from its bar, and both directions can run off the sheet: too much
# horizontal reach and the leftmost bar's label slides past the page margin, too much vertical
# and it collides with the table below. 45° splits the budget evenly, and every label is
# additionally clamped to the room its own bar actually has (see _error_chart).
LABEL_ANGLE = 45
LABEL_MAX_W = 150
CHART_LABEL_H = 112    # >= LABEL_MAX_W * sin(45°)
CHART_LEFT_GUTTER = 78  # partial room for the leftmost label; the clamp covers the rest
BAR_W = 16
BAR_MAX_GAP = 46


def _error_header(c, report, generated_at):
    reg, bold = _fonts()
    y0 = PAGE_H - BAND_H
    c.setFillColor(BLUE)
    c.rect(0, y0, PAGE_W, BAND_H, fill=1, stroke=0)

    logo_path = os.path.join(certs.ASSETS, "cert_logo.png")
    x = MARGIN
    if os.path.exists(logo_path):
        try:
            c.drawImage(ImageReader(logo_path), x, y0 + 26, width=30, height=34,
                        mask="auto", preserveAspectRatio=True)
            x += 44
        except Exception:  # pragma: no cover - a missing asset must not break the report
            pass

    m = report["midterm"]
    _text(c, bold, 16, HexColor("#ffffff"), x, y0 + 50, "Midterm Error Report")
    _text(c, reg, 9, HexColor("#cfe0f7"), x, y0 + 34,
          _truncate(c, f"{report['student_name']} · {m['title']} · {m['subject_label']}", reg, 9, 300))
    _text(c, reg, 8, HexColor("#cfe0f7"), PAGE_W - MARGIN, y0 + 50, report["date"], align="right")
    _text(c, reg, 8, HexColor("#9fc2ee"), PAGE_W - MARGIN, y0 + 36,
          f"Generated {_datetime(generated_at)}", align="right")


def _error_summary(c, report, y0):
    """Score / Correct / Mistakes / Weak skills, as a 4-up strip."""
    reg, bold = _fonts()
    wrong = report["total_count"] - report["correct_count"]
    cells = [
        ("Score", f"{report['score']}", f"/ {report['midterm']['score_ceiling']}"),
        ("Correct", f"{report['correct_count']}", f"/ {report['total_count']}"),
        ("Mistakes", str(wrong), ""),
        ("Weak skills", str(len(report["skills"])), ""),
    ]
    inner = PAGE_W - 2 * MARGIN
    cw = (inner - 3 * 10) / 4
    for i, (label, value, suffix) in enumerate(cells):
        x = MARGIN + i * (cw + 10)
        c.setFillColor(HEAD_BG)
        c.roundRect(x, y0, cw, SUMMARY_H, 8, fill=1, stroke=0)
        _text(c, bold, 7, GRAY, x + 12, y0 + SUMMARY_H - 20, label.upper(), ls=0.9)
        _text(c, bold, 19, NAVY, x + 12, y0 + 14, value)
        if suffix:
            _text(c, reg, 9, GRAY, x + 14 + c.stringWidth(value, bold, 19), y0 + 14, suffix)


def _error_chart(c, skills, y_base):
    """Vertical bars of mistakes per skill, decreasing, with angled labels beneath.

    Mirrors the on-screen chart deliberately: one colour (height already encodes the
    magnitude), a 4pt rounded cap, hairline gridlines, and the value on the cap.
    """
    reg, bold = _fonts()
    if not skills:
        return y_base
    x0 = MARGIN + CHART_LEFT_GUTTER
    inner = PAGE_W - MARGIN - x0
    band = min(BAR_MAX_GAP, inner / len(skills))
    peak = max(s["wrong"] for s in skills)
    steps = max(1, peak)

    # Gridlines + y ticks, one step off the surface so they stay recessive.
    for t in range(steps + 1):
        gy = y_base + (t / steps) * CHART_H
        c.setStrokeColor(LINE)
        c.setLineWidth(0.6)
        c.line(x0, gy, x0 + band * len(skills), gy)
        _text(c, reg, 6.5, GRAY, x0 - 6, gy - 2, str(t), align="right")

    for i, s in enumerate(skills):
        cx = x0 + band * i + band / 2
        h = (s["wrong"] / steps) * CHART_H
        c.setFillColor(BLUE)
        c.roundRect(cx - BAR_W / 2, y_base, BAR_W, max(h, 1.5), 3, fill=1, stroke=0)
        # Square off the base: roundRect rounds all four corners, but a column grows
        # FROM the axis and a rounded foot reads as a floating pill.
        c.rect(cx - BAR_W / 2, y_base, BAR_W, min(4, max(h, 1.5)), fill=1, stroke=0)
        _text(c, bold, 7, NAVY, cx, y_base + h + 5, str(s["wrong"]), align="center")

    # Labels in a SECOND pass. In one loop the next bar paints over the previous bar's
    # label, because a label reaches back to the left across its neighbours.
    for i, s in enumerate(skills):
        cx = x0 + band * i + band / 2

        # Angled label. reportlab rotates about the current origin, so translate first.
        # Clamp to the room THIS bar has: the label runs down-left, so the leftmost bars have
        # less of it, and an unclamped label simply walks off the left edge of the sheet.
        room = (cx - 3 - MARGIN) / math.cos(math.radians(LABEL_ANGLE))
        c.saveState()
        c.translate(cx - 3, y_base - 7)
        c.rotate(LABEL_ANGLE)
        c.setFillColor(BODY)
        c.setFont(reg, 6.8)
        c.drawRightString(0, 0, _truncate(c, s["skill"], reg, 6.8, min(LABEL_MAX_W, room)))
        c.restoreState()

    return y_base - CHART_LABEL_H


def render_student_error_report_pdf(report, *, generated_at=None) -> bytes:
    """PDF bytes for one student's error report (the payload from build_error_report)."""
    reg, bold = _fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
    c.setFillColor(BG)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    _error_header(c, report, generated_at)
    y = PAGE_H - BAND_H - 18 - SUMMARY_H
    _error_summary(c, report, y)

    skills = report["skills"]
    y -= 30
    _text(c, bold, 11, NAVY, MARGIN, y, "Mistakes by skill")
    y -= 12
    if skills:
        _text(c, reg, 8, BODY, MARGIN, y,
              f"{len(skills)} skill(s) cost marks. Skills answered fully correctly are not shown.")
        y -= CHART_H + 18
        y = _error_chart(c, skills, y)
    else:
        _text(c, reg, 8, BODY, MARGIN, y, "No skill lost marks on this paper.")
        y -= 24

    # The same numbers as a table — the chart is a summary, this is the record, and it is
    # what makes the sheet readable when printed in greyscale.
    y -= 18
    if skills:
        _text(c, bold, 9, NAVY, MARGIN, y, "Detail")
        y -= 16
        cols = [("Skill", 220), ("Domain", 190), ("Questions", 50), ("Wrong", 45)]
        c.setFillColor(HEAD_BG)
        c.rect(MARGIN, y - 6, PAGE_W - 2 * MARGIN, 18, fill=1, stroke=0)
        cx = MARGIN + 8
        for title, w in cols:
            align = "right" if title in ("Questions", "Wrong") else "left"
            _text(c, bold, 7, GRAY, cx + (w - 8 if align == "right" else 0), y, title.upper(), ls=0.8, align=align)
            cx += w
        y -= 20
        for s in skills:
            cx = MARGIN + 8
            _text(c, reg, 8, NAVY, cx, y, _truncate(c, s["skill"], reg, 8, 212)); cx += 220
            _text(c, reg, 8, BODY, cx, y, _truncate(c, s["domain"], reg, 8, 182)); cx += 190
            _text(c, reg, 8, NAVY, cx + 42, y, str(s["total"]), align="right"); cx += 50
            _text(c, bold, 8, FAIL_TXT, cx + 37, y, str(s["wrong"]), align="right")
            y -= 16
            if y < TABLE_FLOOR:
                break

    if report.get("unclassified_wrong"):
        y -= 8
        _text(c, reg, 7.5, GRAY, MARGIN, y,
              f"{report['unclassified_wrong']} mistake(s) are on questions not yet tagged with a skill "
              "and are not shown above.")

    _footer(c, 1, 1)
    c.showPage()
    c.save()
    return buf.getvalue()
