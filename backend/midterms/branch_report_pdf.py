"""One branch's whole midterm month as a single A4 PDF: departments, teachers, classes,
students.

The classroom sheet in ``report_pdf`` answers "how did this class do on this paper". This
answers "how did this branch do this month" without making the reader assemble it from a
dozen downloads — so it is organised the way the school is, and every level carries the same
pooled pass rate the console shows.

Drawn with the same reportlab primitives, palette and fonts as the classroom sheet, so the
two documents read as one family and the endpoint still cannot fail for a missing browser.

Layout is a single downward cursor with explicit page breaks: every block asks ``_room`` for
the height it needs before it draws, so a department header can never be orphaned at the
foot of a page from the table it introduces.
"""

from __future__ import annotations

import io
import os

from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from classes import certificate_pdf as certs

from .report_pdf import (
    BODY,
    BLUE,
    BLUE_DK,
    COLUMNS,
    FAIL_TXT,
    GRAY,
    HEAD_BG,
    HEAD_H,
    LINE,
    MARGIN,
    NAVY,
    NEUTRAL_BG,
    NEUTRAL_TXT,
    PAGE_H,
    PAGE_W,
    PASS_TXT,
    ROW_H,
    _cell_state_label,
    _date,
    _datetime,
    _fonts,
    _pill,
    _text,
    _truncate,
    FINAL_LABELS,
)

WHITE = HexColor("#ffffff")
BAND_TEXT = HexColor("#cdddf5")
BAND_FAINT = HexColor("#9dbdea")
#: The three bar colours. Green/red/grey rather than shades of one hue: the reader is meant
#: to see at a glance which classes are mostly green, and a monochrome chart cannot say that.
BAR_PASS = HexColor("#22a05b")
BAR_FAIL = HexColor("#d94a4a")
BAR_ABSENT = HexColor("#c3cad6")
DEPT_BG = HexColor("#eef4ff")

COVER_BAND_H = 112
FOOT_Y = 40
#: The lowest y a block may start at. Above the footer rule with a line's clearance.
FLOOR = FOOT_Y + 26


def _rate(value) -> str:
    """A percentage, or an em dash. Never "0%" for a class with nobody on it — an empty
    denominator has no rate, and printing zero would read as a verdict on the class."""
    return "—" if value is None else f"{value:.1f}%".replace(".0%", "%")


def _plural(n, one, many=None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


class _Doc:
    """A downward cursor over pages. Every draw goes through ``room`` first."""

    def __init__(self, buf):
        self.c = canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
        self.y = PAGE_H - 54
        self.page = 1
        self._running = ""

    # ── page plumbing ────────────────────────────────────────────────────────
    def room(self, height: float) -> None:
        """Start a new page unless ``height`` still fits above the footer."""
        if self.y - height < FLOOR:
            self.break_page()

    def break_page(self) -> None:
        self._footer()
        self.c.showPage()
        self.page += 1
        self.y = PAGE_H - 54
        if self._running:
            self._continued(self._running)

    def set_running(self, text: str) -> None:
        """What a page that continues a section says at its top."""
        self._running = text

    def _continued(self, text: str) -> None:
        reg, _bold = _fonts()
        _text(self.c, reg, 7.5, GRAY, MARGIN, PAGE_H - 40, _truncate(self.c, f"{text} (continued)", reg, 7.5, PAGE_W - 2 * MARGIN), ls=0.8)
        self.y = PAGE_H - 62

    def _footer(self) -> None:
        reg, _bold = _fonts()
        self.c.setStrokeColor(LINE)
        self.c.setLineWidth(0.8)
        self.c.line(MARGIN, FOOT_Y + 14, PAGE_W - MARGIN, FOOT_Y + 14)
        _text(self.c, reg, 8, GRAY, MARGIN, FOOT_Y, "MasterSAT  ·  mastersat.uz")
        _text(self.c, reg, 8, GRAY, PAGE_W - MARGIN, FOOT_Y, str(self.page), align="right")

    def finish(self) -> None:
        self._footer()
        self.c.save()


# ── pieces ───────────────────────────────────────────────────────────────────
def _cover_band(doc, report, generated_at):
    """The masthead: who this is about, and for which month."""
    c = doc.c
    reg, bold = _fonts()
    y0 = PAGE_H - COVER_BAND_H
    c.setFillColor(BLUE)
    c.rect(0, y0, PAGE_W, COVER_BAND_H, fill=1, stroke=0)

    logo_path = os.path.join(certs.ASSETS, "cert_logo.png")
    lx = MARGIN
    if os.path.exists(logo_path):
        lh = 30
        lw = lh * 590 / 656
        c.drawImage(ImageReader(logo_path), lx, y0 + COVER_BAND_H - 24 - lh, width=lw, height=lh, mask="auto")
        lx += lw + 10
    _text(c, bold, 15, WHITE, lx, y0 + COVER_BAND_H - 37, "Midterm Results Report", ls=0.6)

    branch = report.get("branch")
    name = branch["name"] if branch else "All branches"
    region = (branch or {}).get("region")
    _text(c, bold, 19, WHITE, MARGIN, y0 + 34, _truncate(c, name, bold, 19, PAGE_W - 2 * MARGIN - 180))
    if region:
        _text(c, reg, 9.5, BAND_TEXT, MARGIN, y0 + 20, f"{region} region", ls=0.4)

    rx = PAGE_W - MARGIN
    _text(c, bold, 12, WHITE, rx, y0 + 36, _month_label(report.get("month")), align="right")
    _text(c, reg, 7.5, BAND_FAINT, rx, y0 + 20, f"GENERATED {_datetime(generated_at)}", ls=0.8, align="right")
    doc.y = y0 - 22


def _month_label(month) -> str:
    """"2026-09" → "September 2026". Falls back to whatever came in."""
    if not month or len(str(month)) != 7:
        return str(month or "—")
    import datetime

    try:
        year, mon = str(month).split("-")
        return datetime.date(int(year), int(mon), 1).strftime("%B %Y")
    except (ValueError, TypeError):
        return str(month)


def _summary_cards(doc, totals):
    """Students / Passed / Failed / Pass rate, four across."""
    c = doc.c
    reg, bold = _fonts()
    h = 58
    doc.room(h + 14)
    cells = [
        ("Students", str(totals.get("distinct_students", 0)), NAVY),
        ("Passed", str(totals.get("passed", 0)), PASS_TXT),
        ("Failed or absent", str(totals.get("failed", 0) + totals.get("absent", 0)), FAIL_TXT),
        ("Pass rate", _rate(totals.get("pass_rate")), BLUE),
    ]
    gap = 10
    w = (PAGE_W - 2 * MARGIN - gap * 3) / 4
    y = doc.y - h
    for i, (label, value, color) in enumerate(cells):
        x = MARGIN + i * (w + gap)
        c.setFillColor(HEAD_BG)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.8)
        c.roundRect(x, y, w, h, 8, fill=1, stroke=1)
        _text(c, reg, 7.5, GRAY, x + w / 2, y + h - 18, label.upper(), ls=1.2, align="center")
        _text(c, bold, 20, color, x + w / 2, y + 13, value, align="center")
    doc.y = y - 16


def _split_bar(doc, x, y, w, h, node, *, draw_legend=False):
    """One row's outcome as a proportional bar: passed | failed | absent | waiting.

    A single "pass rate" bar would only restate the percentage printed beside it. This one
    carries what the percentage cannot — how the rest of the class divides between failing
    and never turning up, which is a different problem with a different remedy.
    """
    c = doc.c
    total = node.get("roster") or 0
    c.setFillColor(HexColor("#eef0f4"))
    c.roundRect(x, y, w, h, h / 2, fill=1, stroke=0)
    if not total:
        return
    segments = [
        (node.get("passed", 0), BAR_PASS),
        (node.get("failed", 0), BAR_FAIL),
        (node.get("absent", 0) + node.get("pending", 0), BAR_ABSENT),
    ]
    cx = x
    for count, color in segments:
        if not count:
            continue
        seg = w * count / total
        c.setFillColor(color)
        c.rect(cx, y, seg, h, fill=1, stroke=0)
        cx += seg
    # Round the two ends back over the square segment corners.
    c.setFillColor(WHITE)
    c.setStrokeColor(WHITE)


def _legend(doc):
    c = doc.c
    reg, _bold = _fonts()
    doc.room(18)
    y = doc.y - 10
    x = MARGIN
    for label, color in (("Passed", BAR_PASS), ("Failed", BAR_FAIL), ("Absent or waiting", BAR_ABSENT)):
        c.setFillColor(color)
        c.roundRect(x, y, 8, 8, 2, fill=1, stroke=0)
        _text(c, reg, 7.5, BODY, x + 12, y + 1, label)
        x += 14 + c.stringWidth(label, reg, 7.5) + 16
    doc.y = y - 10


def _contents(doc, report):
    """A one-line-per-class table of contents with each level's rate.

    The point of the cover page: an administrator should be able to see which class needs
    attention before turning to the page that proves it.
    """
    c = doc.c
    reg, bold = _fonts()
    departments = report.get("departments") or []
    if not departments:
        return

    doc.room(26)
    _text(c, bold, 10.5, NAVY, MARGIN, doc.y - 12, "What is in this report")
    doc.y -= 26
    _legend(doc)

    bar_w = 120
    rate_x = PAGE_W - MARGIN
    bar_x = rate_x - 46 - bar_w
    for dept in departments:
        doc.room(20)
        y = doc.y - 14
        c.setFillColor(DEPT_BG)
        c.roundRect(MARGIN, y - 3, PAGE_W - 2 * MARGIN, 18, 4, fill=1, stroke=0)
        _text(c, bold, 9, BLUE_DK, MARGIN + 8, y + 1, _truncate(c, dept.get("name") or "—", bold, 9, bar_x - MARGIN - 20))
        _split_bar(doc, bar_x, y, bar_w, 7, dept)
        _text(c, bold, 9, NAVY, rate_x, y + 1, _rate(dept.get("pass_rate")), align="right")
        doc.y = y - 6

        for teacher in dept.get("teachers") or []:
            for room in teacher.get("classrooms") or []:
                doc.room(16)
                y = doc.y - 12
                label = room.get("name") or "—"
                who = teacher.get("name") or ""
                line = f"{label}  ·  {who}" if who and who.split()[:1] and who.split()[0].lower() not in label.lower() else label
                _text(c, reg, 8.5, BODY, MARGIN + 18, y, _truncate(c, line, reg, 8.5, bar_x - MARGIN - 34))
                _split_bar(doc, bar_x, y - 1, bar_w, 6, room)
                _text(c, reg, 8.5, NAVY, rate_x, y, _rate(room.get("pass_rate")), align="right")
                doc.y = y - 5
        doc.y -= 4


def _section_header(doc, title, subtitle, node, *, tone=BLUE):
    """A department or teacher heading with its own pooled figures on the right."""
    c = doc.c
    reg, bold = _fonts()
    h = 34
    doc.room(h + 40)  # never orphaned: a heading must keep at least a row of what follows
    y = doc.y - h
    c.setFillColor(tone)
    c.roundRect(MARGIN, y, PAGE_W - 2 * MARGIN, h, 6, fill=1, stroke=0)
    _text(c, bold, 11.5, WHITE, MARGIN + 12, y + 13, _truncate(c, title, bold, 11.5, PAGE_W - 2 * MARGIN - 200))
    if subtitle:
        _text(c, reg, 8, BAND_TEXT, MARGIN + 12, y + 4, _truncate(c, subtitle, reg, 8, PAGE_W - 2 * MARGIN - 210))
    rx = PAGE_W - MARGIN - 12
    _text(c, bold, 14, WHITE, rx, y + 13, _rate(node.get("pass_rate")), align="right")
    _text(
        c, reg, 7.5, BAND_TEXT, rx, y + 4,
        f"{node.get('passed', 0)} of {node.get('roster', 0)} passed", align="right",
    )
    doc.y = y - 12


def _classroom_header(doc, room, teacher_name):
    c = doc.c
    reg, bold = _fonts()
    doc.room(30 + ROW_H + HEAD_H)
    y = doc.y - 20
    _text(c, bold, 10, NAVY, MARGIN, y + 4, _truncate(c, room.get("name") or "—", bold, 10, 300))
    bits = [b for b in (room.get("level_label"), teacher_name, _plural(room.get("distinct_students", 0) or room.get("roster", 0), "student")) if b]
    _text(c, reg, 8, GRAY, MARGIN, y - 6, _truncate(c, "  ·  ".join(bits), reg, 8, 320))
    rx = PAGE_W - MARGIN
    _text(c, bold, 11, NAVY, rx, y + 4, _rate(room.get("pass_rate")), align="right")
    _split_bar(doc, rx - 120, y - 5, 120, 7, room)
    doc.y = y - 20


def _paper_caption(doc, paper):
    c = doc.c
    reg, bold = _fonts()
    doc.room(18 + HEAD_H + ROW_H)
    y = doc.y - 12
    midterm = paper["midterm"]
    summary = paper["summary"]
    _text(c, bold, 8.5, BLUE_DK, MARGIN, y, _truncate(c, midterm["title"], bold, 8.5, 300))
    right = f"Pass mark {summary['pass_mark']}" if summary.get("pass_mark") is not None else "Not graded"
    if summary.get("average_score") is not None:
        right += f"   ·   Average {summary['average_score']}"
    _text(c, reg, 8, GRAY, PAGE_W - MARGIN, y, right, align="right")
    doc.y = y - 10


def _table_header(doc):
    c = doc.c
    _reg, bold = _fonts()
    y = doc.y - HEAD_H
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
    doc.y = y


def _student_row(doc, index, row):
    c = doc.c
    reg, bold = _fonts()
    y = doc.y - ROW_H
    if index % 2 == 0:
        c.setFillColor(HexColor("#fafbfd"))
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

    if not row["retake_eligible"]:
        _text(c, reg, 9, GRAY, x + widths[4] / 2, ty, "—", align="center")
        x += widths[4]
        _text(c, reg, 8, GRAY, x + widths[5] / 2, ty, "—", align="center")
        x += widths[5]
    else:
        r_score = row["retake_score"]
        _text(c, bold, 9, NAVY if r_score is not None else GRAY, x + widths[4] / 2, ty, "—" if r_score is None else str(r_score), align="center")
        x += widths[4]
        label, bg, fg = _cell_state_label(row["retake_state"], row["retake_passed"], r_score)
        _pill(c, x, ty, widths[5], label, bg, fg)
        x += widths[5]

    label, bg, fg = FINAL_LABELS.get(row["final_status"], (row["final_status"], NEUTRAL_BG, NEUTRAL_TXT))
    _pill(c, x, ty, widths[6], label, bg, fg)
    doc.y = y


def _note(doc, text):
    c = doc.c
    reg, _bold = _fonts()
    doc.room(20)
    y = doc.y - 12
    _text(c, reg, 8, GRAY, MARGIN + 6, y, _truncate(c, text, reg, 8, PAGE_W - 2 * MARGIN - 12))
    doc.y = y - 8


def _teacher_label(teacher, room_name) -> str:
    """The teacher's name, unless the class name already spells it out."""
    name = (teacher.get("name") or "").strip()
    if not name:
        return ""
    first = name.split()[0].lower()
    return "" if first and first in (room_name or "").lower() else name


def render_branch_report_pdf(report, *, generated_at=None) -> bytes:
    """PDF bytes for one branch's month: cover, then department → teacher → class → students."""
    _fonts()
    buf = io.BytesIO()
    doc = _Doc(buf)

    _cover_band(doc, report, generated_at)
    _summary_cards(doc, report.get("totals") or {})

    totals = report.get("totals") or {}
    head = totals.get("distinct_students", 0)
    roster = totals.get("roster", 0)
    if roster and head and roster != head:
        _note(
            doc,
            f"The pass rate is over {roster} exam results, not {head} students: "
            f"{roster - head} of them sat more than one exam this month.",
        )
    orphans = report.get("orphan_retakes") or []
    if orphans:
        _note(
            doc,
            "Left out of every figure: "
            + ", ".join(p["title"] for p in orphans)
            + (" — a retake with no parent exam is counted nowhere." if len(orphans) == 1
               else " — retakes with no parent exam are counted nowhere."),
        )

    _contents(doc, report)

    departments = report.get("departments") or []
    if not departments:
        _note(doc, "No class under this branch sat a countable exam in this month.")
        doc.finish()
        return buf.getvalue()

    for dept in departments:
        doc.break_page()
        doc.set_running(dept.get("name") or "")
        teachers = dept.get("teachers") or []
        _section_header(
            doc,
            dept.get("name") or "—",
            f"{_plural(len(teachers), 'teacher')}  ·  {_plural(dept.get('classrooms', 0), 'class', 'classes')}",
            dept,
        )

        for teacher in teachers:
            rooms = teacher.get("classrooms") or []
            _section_header(
                doc,
                teacher.get("name") or "Not assigned",
                _plural(len(rooms), "class", "classes"),
                teacher,
                tone=BLUE_DK,
            )
            for room in rooms:
                doc.set_running(f"{dept.get('name') or ''} · {room.get('name') or ''}")
                _classroom_header(doc, room, _teacher_label(teacher, room.get("name")))
                papers = room.get("papers") or []
                if not papers:
                    _note(doc, "No exam paper resolved for this class in this month.")
                    continue
                for paper in papers:
                    _paper_caption(doc, paper)
                    _table_header(doc)
                    rows = paper.get("rows") or []
                    if not rows:
                        _note(doc, "Nobody is on this class's list.")
                        continue
                    for i, row in enumerate(rows):
                        if doc.y - ROW_H < FLOOR:
                            doc.break_page()
                            _table_header(doc)
                        _student_row(doc, i, row)
                    doc.y -= 12
        doc.set_running("")

    doc.finish()
    return buf.getvalue()
