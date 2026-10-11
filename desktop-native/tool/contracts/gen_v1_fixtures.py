#!/usr/bin/env python3
"""Generate desktop-native/contracts/v1/*.json — THE wire contract of /api/desktop/v1/.

Run from anywhere (stdlib only, no network):

    python3 -I desktop-native/tool/contracts/gen_v1_fixtures.py

It rewrites every fixture plus manifest.json and the fixture media PNGs. The output is
committed; CI and the Dart/Python tests load the committed files, and a test re-runs this
script into a temp dir to prove the committed files are what it produces (no hand drift).

Why a generator rather than hand-typed JSON:
  * ids, timings and module lists stay consistent across ~60 files;
  * ``content_hash`` is computed exactly the way the server must compute it
    (see ``content_hash`` below), so the fixtures double as a test vector.

Content is original SAT-style material written for these fixtures (no copyrighted items).
"""

from __future__ import annotations

import hashlib
import json
import struct
import sys
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # desktop-native/
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "contracts" / "v1"
DART_EMBED = (Path(sys.argv[2]) if len(sys.argv) > 2
              else ROOT / "app" / "lib" / "core" / "api" / "fixtures" / "v1_fixtures.g.dart")

NOW = datetime(2026, 10, 11, 9, 0, 0, tzinfo=timezone.utc)
MEDIA_HOST = "https://r2.fixtures.invalid/mastersat-media/"
PASTPAPER_MEDIA_TTL = timedelta(seconds=21600)
MIDTERM_MEDIA_TTL = timedelta(seconds=900)


def iso(dt: datetime | None) -> str | None:
    """ISO-8601 UTC with milliseconds and a Z suffix — the v1 timestamp format."""
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def at(minutes: float = 0, seconds: float = 0) -> datetime:
    return NOW + timedelta(minutes=minutes, seconds=seconds)


def content_hash(questions: list[dict]) -> str:
    """sha256 over canonical JSON of the module's question list as served.

    Canonical = ``json.dumps(questions, sort_keys=True, separators=(",", ":"), ensure_ascii=False)``
    encoded as UTF-8. The list contains image KEYS only (never signed URLs), so the hash is stable
    across responses. The server MUST compute it the same way (``desktop/v1/content.py``).
    """
    canon = json.dumps(questions, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "sha256:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------------------------
# Question content (original, SAT-style)
# ---------------------------------------------------------------------------------------------

def mcq(qid, order, qtype, text, prompt, options, image_key=None):
    return {
        "id": qid,
        "order": order,
        "question_type": qtype,
        "is_math_input": False,
        "question_text": text,
        "question_prompt": prompt,
        "question_image_key": image_key,
        "options": {k: {"text": v if isinstance(v, str) else v[0], "image_key": None if isinstance(v, str) else v[1]}
                    for k, v in options.items()},
    }


def grid_in(qid, order, text, prompt="", image_key=None):
    return {
        "id": qid,
        "order": order,
        "question_type": "MATH",
        "is_math_input": True,
        "question_text": text,
        "question_prompt": prompt,
        "question_image_key": image_key,
        "options": None,
    }


RW_M1 = [
    mcq(2001, 1, "READING",
        "<p>Marine biologist Ayesha Rahman spent three seasons recording the clicks of sperm whales off the coast of "
        "Dominica. She noticed that whales in the same family group repeated a short pattern of clicks, called a "
        "<em>coda</em>, far more often than whales from other groups did. Rahman argues that these shared codas work "
        "much like a family name: they let a whale signal which group it belongs to.</p>",
        "Which choice best states the main idea of the text?",
        {"A": "Rahman found that sperm whales can only communicate with members of their own family group.",
         "B": "Rahman's recordings suggest that sperm whales use shared click patterns to identify their group.",
         "C": "Rahman discovered that codas are learned from whales in other family groups.",
         "D": "Rahman concluded that sperm whales stop producing codas once they leave the coast of Dominica."}),
    mcq(2002, 2, "WRITING",
        "<p>In 1921 the chemist Alice Ball developed a way to make chaulmoogra oil dissolve in water, producing the "
        "first injectable treatment for leprosy that the body could absorb. Her method ______ for more than two "
        "decades, until antibiotics replaced it in the 1940s.</p>",
        "Which choice completes the text so that it conforms to the conventions of Standard English?",
        {"A": "was used", "B": "were used", "C": "have been used", "D": "being used"}),
    mcq(2003, 3, "READING",
        "<p>Many cities plant trees along streets to cool neighborhoods in summer. <u>A 2024 survey of twelve cities, "
        "however, found that newly planted trees lowered street temperatures only after their canopies had grown for "
        "at least eight years.</u> Planners who expect quick results may therefore be disappointed, even though the "
        "long-term benefits are well documented.</p>",
        "Which choice best describes the function of the underlined sentence in the text as a whole?",
        {"A": "It introduces a finding that qualifies the expectation described in the first sentence.",
         "B": "It provides an example of a city that stopped planting trees.",
         "C": "It explains why the long-term benefits of trees are well documented.",
         "D": "It describes a method planners use to choose which trees to plant."}),
    mcq(2004, 4, "READING",
        "<p>A beekeeping cooperative tracked how many of its monitored colonies were lost each winter.</p>"
        "<table><thead><tr><th>Winter</th><th>Colonies monitored</th><th>Colonies lost (%)</th></tr></thead>"
        "<tbody><tr><td>2021&ndash;22</td><td>420</td><td>31</td></tr>"
        "<tr><td>2022&ndash;23</td><td>455</td><td>24</td></tr>"
        "<tr><td>2023&ndash;24</td><td>470</td><td>18</td></tr></tbody></table>"
        "<p>The cooperative attributes the change to a new practice of insulating hives each autumn, which it began "
        "in 2022.</p>",
        "Which choice most effectively uses data from the table to support the cooperative's claim?",
        {"A": "The cooperative monitored more colonies in 2023&ndash;24 than in 2021&ndash;22.",
         "B": "The percentage of colonies lost fell from 31% in 2021&ndash;22 to 18% in 2023&ndash;24.",
         "C": "In 2022&ndash;23, the cooperative monitored 455 colonies.",
         "D": "The number of colonies monitored rose by 35 between 2021&ndash;22 and 2022&ndash;23."}),
    mcq(2005, 5, "READING",
        "<p>When a firefly produces light, almost none of the chemical energy is lost as heat. In one laboratory "
        "measurement, a single flash released about 4.2&nbsp;&times;&nbsp;10<sup>&minus;12</sup> joules of light, "
        "while the surrounding tissue warmed by less than 0.01&nbsp;&deg;C. Engineers studying the reaction hope to "
        "design lighting that is similarly ______.</p>",
        "Which choice completes the text with the most logical and precise word or phrase?",
        {"A": "efficient", "B": "decorative", "C": "temporary", "D": "colorful"}),
    mcq(2006, 6, "READING",
        "<p>The bar chart shows the average number of hours students at one learning center spent on practice tests "
        "per week during each month of the autumn term.</p>",
        "Which choice most accurately describes the data in the chart?",
        {"A": "Practice hours were highest in September and declined each month after.",
         "B": "Practice hours rose each month, peaking in November.",
         "C": "Practice hours were the same in October and November.",
         "D": "Practice hours fell in October and then rose sharply in December."},
        image_key="question_images/rw/2025-10-us-a/m1-q6-chart.png"),
]

RW_M2 = [
    mcq(2011, 1, "WRITING",
        "<p>The Registan in Samarkand is framed by three madrasas built over two centuries. The oldest, completed in "
        "1420, was commissioned by the astronomer-ruler Ulugh Beg; the other two ______ in the seventeenth "
        "century.</p>",
        "Which choice completes the text so that it conforms to the conventions of Standard English?",
        {"A": "was added", "B": "were added", "C": "adding", "D": "to add"}),
    mcq(2012, 2, "WRITING",
        "<p>Solar panels lose efficiency as they heat up. ______ researchers have begun testing panels that float on "
        "reservoirs, where the water below keeps them cooler.</p>",
        "Which choice completes the text with the most logical transition?",
        {"A": "For this reason,", "B": "Nevertheless,", "C": "In contrast,", "D": "Similarly,"}),
    mcq(2013, 3, "READING",
        "<p><strong>Text 1</strong></p><p>Some historians argue that the printing press spread literacy mainly by "
        "making books cheaper.</p><p><strong>Text 2</strong></p><p>Others point out that literacy rose fastest where "
        "schools were founded, regardless of book prices.</p>",
        "Based on the texts, how would the author of Text 2 most likely respond to the claim in Text 1?",
        {"A": "By agreeing that book prices were the only factor in rising literacy.",
         "B": "By suggesting that schooling may explain rising literacy at least as well as cheaper books.",
         "C": "By arguing that the printing press made books more expensive.",
         "D": "By claiming that literacy did not rise at all."}),
]

MATH_M1 = [
    mcq(1001, 1, "MATH", "<p>If $3x + 5 = 20$, what is the value of $x$?</p>", "",
        {"A": "$3$", "B": "$5$", "C": "$\\frac{25}{3}$", "D": "$15$"}),
    grid_in(1002, 2,
            "<p>The function $f$ is defined by $f(x) = x^2 - 6x + 11$. What is the minimum value of $f(x)$?</p>"),
    mcq(1003, 3, "MATH",
        "<p>The table shows four pairs of values for a linear relationship between $x$ and $y$.</p>"
        "<table><thead><tr><th>$x$</th><th>$y$</th></tr></thead><tbody>"
        "<tr><td>$-1$</td><td>$-1$</td></tr><tr><td>$0$</td><td>$2$</td></tr>"
        "<tr><td>$1$</td><td>$5$</td></tr><tr><td>$2$</td><td>$8$</td></tr></tbody></table>",
        "Which equation represents this relationship?",
        {"A": "$y = 2x + 3$", "B": "$y = 3x + 2$", "C": "$y = 3x - 1$", "D": "$y = x + 2$"}),
    mcq(1004, 4, "MATH", "<p>The graph of $y = g(x)$ is shown.</p>",
        "For what value of $x$ does $g(x)$ reach its maximum?",
        {"A": "$-2$", "B": "$0$", "C": "$1$", "D": "$3$"},
        image_key="question_images/math/2025-10-us-a/m1-q4-graph.png"),
    mcq(1005, 5, "MATH",
        "<p>A colony of bacteria has 3&nbsp;&times;&nbsp;10<sup>5</sup> cells and doubles every 4 hours. Which "
        "expression gives the number of cells after $t$ hours?</p>", "",
        {"A": "$300{,}000(2)^{4t}$", "B": "$300{,}000(2)^{t/4}$", "C": "$300{,}000(4)^{t/2}$",
         "D": "$300{,}000 + 2^{t/4}$"}),
    mcq(1006, 6, "MATH",
        "<p>Which of the following could be the graph of $y = -(x - 1)^2 + 4$?</p>", "",
        {"A": ("", "question_images/math/2025-10-us-a/m1-q6-a.png"),
         "B": ("", "question_images/math/2025-10-us-a/m1-q6-b.png"),
         "C": ("", "question_images/math/2025-10-us-a/m1-q6-c.png"),
         "D": ("", "question_images/math/2025-10-us-a/m1-q6-d.png")}),
]

MATH_M2 = [
    grid_in(1011, 1, "<p>If $\\frac{2}{7}k = 1$, what is the value of $k$?</p>"),
    mcq(1012, 2, "MATH",
        "<p>In the $xy$-plane, line $\\ell$ passes through the points $(0, 4)$ and $(2, 0)$. What is the slope of "
        "line $\\ell$?</p>", "",
        {"A": "$-2$", "B": "$-\\frac{1}{2}$", "C": "$\\frac{1}{2}$", "D": "$2$"}),
    mcq(1013, 3, "MATH", "<p>Which expression is equivalent to $\\sqrt{50x^2}$ for $x > 0$?</p>", "",
        {"A": "$5x\\sqrt{2}$", "B": "$25x$", "C": "$2x\\sqrt{5}$", "D": "$10x$"}),
    grid_in(1014, 4, "<p>What is the solution to the equation $4(y + 3) = 2y + 6$?</p>"),
]

MT_M1 = [
    mcq(3001, 1, "MATH", "<p>What is the value of $2^3 + 3^2$?</p>", "",
        {"A": "$12$", "B": "$15$", "C": "$17$", "D": "$25$"}),
    grid_in(3002, 2, "<p>A rectangle has a perimeter of $30$ and a length of $9$. What is its width?</p>"),
    mcq(3003, 3, "MATH",
        "<p>The circle shown has center $O$ and radius $5$.</p>",
        "What is the area of the circle?",
        {"A": "$10\\pi$", "B": "$25\\pi$", "C": "$50\\pi$", "D": "$100\\pi$"},
        image_key="question_images/midterm/2026-10/m1-q3-circle.png"),
    mcq(3004, 4, "MATH",
        "<p>If $x^2 - 9 = 0$ and $x < 0$, what is the value of $x$?</p>", "",
        {"A": "$-9$", "B": "$-3$", "C": "$3$", "D": "$9$"}),
]

MT_M2 = [
    mcq(3011, 1, "MATH", "<p>What is $15\\%$ of $80$?</p>", "",
        {"A": "$8$", "B": "$12$", "C": "$15$", "D": "$20$"}),
    grid_in(3012, 2, "<p>If $\\frac{x}{4} + \\frac{x}{6} = 5$, what is the value of $x$?</p>"),
    mcq(3013, 3, "MATH",
        "<p>The scatterplot shows the relationship between hours studied and test score.</p>",
        "Which statement is best supported by the scatterplot?",
        {"A": "More hours studied is associated with higher scores.",
         "B": "More hours studied is associated with lower scores.",
         "C": "There is no association between hours studied and score.",
         "D": "Every student who studied more than 5 hours scored 800."},
        image_key="question_images/midterm/2026-10/m2-q3-scatter.png"),
]

ALL_IMAGE_KEYS = sorted({
    k for qs in (RW_M1, RW_M2, MATH_M1, MATH_M2, MT_M1, MT_M2) for q in qs
    for k in [q["question_image_key"]] + [o["image_key"] for o in (q["options"] or {}).values()] if k
})


def image_keys(questions: list[dict]) -> list[str]:
    keys: list[str] = []
    for q in questions:
        for k in [q["question_image_key"]] + [o["image_key"] for o in (q["options"] or {}).values()]:
            if k and k not in keys:
                keys.append(k)
    return keys


def signed_url(key: str, ttl: timedelta, issued: datetime) -> str:
    sig = hashlib.sha256(f"{key}|{iso(issued)}".encode()).hexdigest()
    return (f"{MEDIA_HOST}{key}?X-Amz-Algorithm=AWS4-HMAC-SHA256"
            f"&X-Amz-Credential=FIXTURE%2F{issued:%Y%m%d}%2Fauto%2Fs3%2Faws4_request"
            f"&X-Amz-Date={issued:%Y%m%dT%H%M%SZ}&X-Amz-Expires={int(ttl.total_seconds())}"
            f"&X-Amz-SignedHeaders=host&X-Amz-Signature={sig}")


def media_list(questions: list[dict], ttl: timedelta, issued: datetime) -> list[dict]:
    return [{"key": k, "url": signed_url(k, ttl, issued), "expires_at": iso(issued + ttl)}
            for k in image_keys(questions)]


# ---------------------------------------------------------------------------------------------
# Shared shapes
# ---------------------------------------------------------------------------------------------

MATH = {"id": 52, "modules": [(301, 35, MATH_M1), (302, 35, MATH_M2)]}
RW = {"id": 51, "modules": [(311, 32, RW_M1), (312, 32, RW_M2)]}
MIDTERM = {"id": 14, "modules": [(401, 35, MT_M1), (402, 35, MT_M2)]}


def timing(server_now, deadline=None, remaining_ms=None, paused=False):
    return {"server_now": iso(server_now), "deadline_at": iso(deadline), "remaining_ms": remaining_ms,
            "paused": paused}


def module_ref(mid, order, minutes):
    return {"id": mid, "order": order, "duration_ms": minutes * 60_000}


def attempt_lite(*, id, kind, ref_id, state, version, module, module_ids, timing, results_ready=False, score=None,
                 midterm=None):
    return {"id": id, "kind": kind, "ref_id": ref_id, "state": state, "version": version, "module": module,
            "module_ids": module_ids, "timing": timing, "results_ready": results_ready, "score": score,
            "midterm": midterm}


def midterm_block(violations=0, terminated_reason=None):
    return {"offscreen_violations": violations, "offscreen_limit": 3, "offscreen_grace_seconds": 3,
            "terminated_reason": terminated_reason, "desktop_required": True, "late_grace_seconds": 300}


def module_content(mid, order, minutes, questions, *, unchanged=False, deferred=False):
    return {"id": mid, "order": order, "time_limit_minutes": minutes, "question_count": len(questions),
            "content_hash": content_hash(questions), "unchanged": unchanged, "deferred": deferred,
            "questions": None if (unchanged or deferred) else questions}


def answers_for(questions, picks):
    """The full-module answer map the client sends: every question, "" when unanswered."""
    return {str(q["id"]): picks.get(q["id"], "") for q in questions}


# ---------------------------------------------------------------------------------------------
# Attempts used across fixtures
# ---------------------------------------------------------------------------------------------

MATH_TEST = {"id": 52, "subject": "MATH", "title": "", "label": "A", "form_type": "US",
             "practice_date": "2025-10-04", "collection_name": "October 2025 US A",
             "tools": {"calculator": "graphing", "reference_sheet": True}}
RW_TEST = {"id": 51, "subject": "READING_WRITING", "title": "", "label": "A", "form_type": "US",
           "practice_date": "2025-10-04", "collection_name": "October 2025 US A",
           "tools": {"calculator": None, "reference_sheet": False}}
MIDTERM_TEST = {"id": 14, "subject": "MATH", "title": "October Midterm · Math", "label": None, "form_type": None,
                "practice_date": None, "collection_name": None,
                "tools": {"calculator": "graphing", "reference_sheet": False}}


def pp_math(state, version, module, t, **kw):
    return attempt_lite(id=9123, kind="pastpaper", ref_id=52, state=state, version=version, module=module,
                        module_ids=[301, 302], timing=t, **kw)


def pp_rw(state, version, module, t, **kw):
    return attempt_lite(id=9124, kind="pastpaper", ref_id=51, state=state, version=version, module=module,
                        module_ids=[311, 312], timing=t, **kw)


def mt(state, version, module, t, violations=0, terminated_reason=None, module_ids=(401, 402)):
    return attempt_lite(id=5521, kind="midterm", ref_id=14, state=state, version=version, module=module,
                        module_ids=list(module_ids), timing=t, midterm=midterm_block(violations, terminated_reason))


M301 = module_ref(301, 1, 35)
M302 = module_ref(302, 2, 35)
M311 = module_ref(311, 1, 32)
M401 = module_ref(401, 1, 35)
M402 = module_ref(402, 2, 35)

MATH_M1_PICKS = {1001: "B", 1002: "2", 1003: "B", 1004: "C", 1005: "A"}
MATH_M2_PICKS = {1011: "7/2", 1012: "A", 1013: "A"}
MT_M1_PICKS = {3001: "C", 3002: "6", 3003: "B"}

# ---------------------------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------------------------

FIXTURES: list[dict] = []  # manifest rows


def emit(name: str, body, *, endpoint: str, method: str, path: str, kind: str, model: str | None,
         status: int | None = None, headers: dict | None = None, note: str = ""):
    """Write ``name`` (no extension) and record it in the manifest."""
    file = f"{name}.json"
    (OUT / file).write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    row = {"file": file, "endpoint": endpoint, "method": method, "path": path, "kind": kind, "model": model}
    if status is not None:
        row["status"] = status
    if headers:
        row["headers"] = headers
    if note:
        row["note"] = note
    FIXTURES.append(row)


V1 = "/api/desktop/v1/"
IDEM = "Idempotency-Key"
LOCK = "X-Lockdown-Session"


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()

    # ---- home -----------------------------------------------------------------------------
    pastpapers = [
        {"id": 52, "title": "", "practice_date": "2025-10-04", "subject": "MATH", "label": "A", "form_type": "US",
         "collection_name": "October 2025 US A",
         "modules": [{"order": 1, "time_limit_minutes": 35, "question_count": 6},
                     {"order": 2, "time_limit_minutes": 35, "question_count": 4}],
         "state": {"status": "new", "open_attempt_id": None, "open_state": None, "last_attempt_id": None,
                   "last_score": None, "last_completed_at": None, "sittings": 0, "reopened": None},
         "history": []},
        {"id": 51, "title": "", "practice_date": "2025-10-04", "subject": "READING_WRITING", "label": "A",
         "form_type": "US", "collection_name": "October 2025 US A",
         "modules": [{"order": 1, "time_limit_minutes": 32, "question_count": 6},
                     {"order": 2, "time_limit_minutes": 32, "question_count": 3}],
         "state": {"status": "progress", "open_attempt_id": 9124, "open_state": "MODULE_1_ACTIVE",
                   "last_attempt_id": None, "last_score": None, "last_completed_at": None, "sittings": 0,
                   "reopened": None},
         "history": []},
        {"id": 43, "title": "", "practice_date": "2025-08-23", "subject": "READING_WRITING", "label": "B",
         "form_type": "INTERNATIONAL", "collection_name": "August 2025 International B",
         "modules": [{"order": 1, "time_limit_minutes": 32, "question_count": 27},
                     {"order": 2, "time_limit_minutes": 32, "question_count": 27}],
         "state": {"status": "completed", "open_attempt_id": None, "open_state": None, "last_attempt_id": 8801,
                   "last_score": 640, "last_completed_at": iso(datetime(2026, 9, 28, 14, 12, 5, tzinfo=timezone.utc)),
                   "sittings": 2, "reopened": None},
         "history": [
             {"attempt_id": 8801, "score": 640,
              "completed_at": iso(datetime(2026, 9, 28, 14, 12, 5, tzinfo=timezone.utc))},
             {"attempt_id": 8710, "score": 590,
              "completed_at": iso(datetime(2026, 9, 14, 10, 3, 41, tzinfo=timezone.utc))}]},
        {"id": 44, "title": "", "practice_date": "2025-08-23", "subject": "MATH", "label": "B",
         "form_type": "INTERNATIONAL", "collection_name": "August 2025 International B",
         "modules": [{"order": 1, "time_limit_minutes": 35, "question_count": 22},
                     {"order": 2, "time_limit_minutes": 35, "question_count": 22}],
         "state": {"status": "reopened", "open_attempt_id": None, "open_state": None, "last_attempt_id": 8802,
                   "last_score": 610, "last_completed_at": iso(datetime(2026, 9, 29, 15, 40, 0, tzinfo=timezone.utc)),
                   "sittings": 1,
                   "reopened": {"assignment_id": 5, "assignment_title": "Retake: August Math",
                                "classroom_name": "SAT Evening B", "set_at": iso(datetime(2026, 10, 9, 12, 0, 0,
                                                                                         tzinfo=timezone.utc)),
                                "due_at": iso(datetime(2026, 10, 16, 18, 0, 0, tzinfo=timezone.utc))}},
         "history": [{"attempt_id": 8802, "score": 610,
                      "completed_at": iso(datetime(2026, 9, 29, 15, 40, 0, tzinfo=timezone.utc))}]},
        {"id": 38, "title": "June practice — Math", "practice_date": "2025-06-07", "subject": "MATH", "label": "C",
         "form_type": "US", "collection_name": "June 2025 US C",
         "modules": [{"order": 1, "time_limit_minutes": 35, "question_count": 22},
                     {"order": 2, "time_limit_minutes": 35, "question_count": 22}],
         "state": {"status": "completed", "open_attempt_id": None, "open_state": None, "last_attempt_id": 8420,
                   "last_score": 700, "last_completed_at": iso(datetime(2026, 8, 30, 11, 0, 0, tzinfo=timezone.utc)),
                   "sittings": 1, "reopened": None},
         "history": [{"attempt_id": 8420, "score": 700,
                      "completed_at": iso(datetime(2026, 8, 30, 11, 0, 0, tzinfo=timezone.utc))}]},
        {"id": 37, "title": "", "practice_date": "2025-06-07", "subject": "READING_WRITING", "label": "C",
         "form_type": "US", "collection_name": "June 2025 US C",
         "modules": [{"order": 1, "time_limit_minutes": 32, "question_count": 27},
                     {"order": 2, "time_limit_minutes": 32, "question_count": 27}],
         "state": {"status": "progress", "open_attempt_id": 8990, "open_state": "MODULE_2_ACTIVE",
                   "last_attempt_id": None, "last_score": None, "last_completed_at": None, "sittings": 0,
                   "reopened": None},
         "history": []},
    ]
    midterms = [
        {"midterm_id": 14, "title": "October Midterm · Math", "subject": "MATH", "scoring_scale": "SCALE_800",
         "score_ceiling": 800, "duration_minutes": 70, "question_count": 44, "flavor": "CLASSROOM",
         "attempt_id": None, "state": "NOT_STARTED", "submitted": False, "resit_open": False, "is_open": True,
         "is_before_start": False, "awaiting_code": False, "available_at": iso(at(-30)),
         "deadline": iso(at(180)), "results_visible": False, "score": None, "certificate": None,
         "requires_code": True},
        {"midterm_id": 15, "title": "October Midterm · Reading and Writing", "subject": "READING_WRITING",
         "scoring_scale": "SCALE_800", "score_ceiling": 800, "duration_minutes": 64, "question_count": 54,
         "flavor": "CLASSROOM", "attempt_id": None, "state": "NOT_STARTED", "submitted": False, "resit_open": False,
         "is_open": False, "is_before_start": True, "awaiting_code": False,
         "available_at": iso(at(60 * 24)), "deadline": iso(at(60 * 24 + 210)), "results_visible": False,
         "score": None, "certificate": None, "requires_code": True},
        {"midterm_id": 9, "title": "September Midterm · Math", "subject": "MATH", "scoring_scale": "SCALE_800",
         "score_ceiling": 800, "duration_minutes": 70, "question_count": 44, "flavor": "CLASSROOM",
         "attempt_id": 4410, "state": "COMPLETED", "submitted": True, "resit_open": False, "is_open": False,
         "is_before_start": False, "awaiting_code": False,
         "available_at": iso(datetime(2026, 9, 18, 8, 30, tzinfo=timezone.utc)),
         "deadline": iso(datetime(2026, 9, 18, 12, 0, tzinfo=timezone.utc)), "results_visible": True, "score": 680,
         "certificate": {"available": True, "code": "MT-9-77-4F2K", "download_url":
                         "/classes/certificates/midterm/MT-9-77-4F2K/download/", "rank": 4, "cohort_size": 23},
         "requires_code": True},
        {"midterm_id": 10, "title": "September Midterm · Reading and Writing", "subject": "READING_WRITING",
         "scoring_scale": "SCALE_100", "score_ceiling": 100, "duration_minutes": 64, "question_count": 54,
         "flavor": "STANDALONE", "attempt_id": 4411, "state": "COMPLETED", "submitted": True, "resit_open": True,
         "is_open": True, "is_before_start": False, "awaiting_code": False, "available_at": None, "deadline": None,
         "results_visible": True, "score": 71, "certificate": None, "requires_code": False},
    ]
    home = {"schema": 1, "server_now": iso(NOW),
            "student": {"id": 77, "first_name": "Aziza", "last_name": "Karimova"},
            "app": {"latest_version": "0.2.0", "minimum_version": "0.2.0",
                    "update_url": "https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe", "update": "none",
                    "message": ""},
            "midterms": midterms, "pastpapers": pastpapers}
    emit("home.response", home, endpoint="home", method="GET", path=V1 + "home", kind="response", model="HomeResponse",
         status=200, headers={"ETag": '"sha256:<hex of body>"'},
         note="Send If-None-Match with the cached ETag; an unchanged home is 304 with an empty body.")
    home_update = json.loads(json.dumps(home))
    home_update["app"] = {"latest_version": "0.3.0", "minimum_version": "0.2.0",
                          "update_url": "https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe",
                          "update": "available", "message": "A new version of MasterSAT is ready."}
    home_update["midterms"] = []
    home_update["pastpapers"] = pastpapers[:1]
    emit("home.response.update_available", home_update, endpoint="home", method="GET", path=V1 + "home",
         kind="response", model="HomeResponse", status=200)

    # ---- past paper: open -------------------------------------------------------------------
    emit("pastpaper_open.request", {"start": False, "have": {}}, endpoint="pastpaper_open", method="POST",
         path=V1 + "pastpapers/{practice_test_id}/open", kind="request", model="PastpaperOpenRequest")
    open_math = {
        "schema": 1,
        "attempt": pp_math("NOT_STARTED", 1, M301, timing(NOW, None, 35 * 60_000, False)),
        "test": MATH_TEST,
        "modules": [module_content(301, 1, 35, MATH_M1), module_content(302, 2, 35, MATH_M2)],
        "answers": {"301": {}, "302": {}},
        "flagged": {"301": [], "302": []},
        "media": media_list(MATH_M1 + MATH_M2, PASTPAPER_MEDIA_TTL, NOW),
        "annotations": [],
    }
    emit("pastpaper_open.response", open_math, endpoint="pastpaper_open", method="POST",
         path=V1 + "pastpapers/{practice_test_id}/open", kind="response", model="ExamBundle", status=200,
         note="practice_test_id=52; fresh attempt created with start:false (Welcome screen pending).")

    rw_started = at(-10)
    rw_deadline = rw_started + timedelta(minutes=32)
    rw_attempt = pp_rw("MODULE_1_ACTIVE", 6, M311, timing(NOW, rw_deadline, int((rw_deadline - NOW).total_seconds() * 1000)))
    emit("pastpaper_open.request.resume", {"start": True, "have": {}}, endpoint="pastpaper_open", method="POST",
         path=V1 + "pastpapers/{practice_test_id}/open", kind="request", model="PastpaperOpenRequest")
    open_rw = {
        "schema": 1,
        "attempt": rw_attempt,
        "test": RW_TEST,
        "modules": [module_content(311, 1, 32, RW_M1), module_content(312, 2, 32, RW_M2)],
        "answers": {"311": {"2001": "B", "2002": "A", "2004": "B"}, "312": {}},
        "flagged": {"311": [2003], "312": []},
        "media": media_list(RW_M1 + RW_M2, PASTPAPER_MEDIA_TTL, NOW),
        "annotations": [
            {"target_id": 2001, "container": "passage",
             "data": [{"start": 0, "end": 15, "kind": "highlight", "color": "yellow"},
                      {"start": 120, "end": 168, "kind": "underline", "underline": "dashed"}]},
            {"target_id": 2003, "container": "question",
             "data": [{"start": 9, "end": 21, "kind": "highlight", "color": "pink"}]},
        ],
    }
    emit("pastpaper_open.response.resume", open_rw, endpoint="pastpaper_open", method="POST",
         path=V1 + "pastpapers/{practice_test_id}/open", kind="response", model="ExamBundle", status=200,
         note="practice_test_id=51; resumes attempt 9124 in module 1 with saved answers, a flag and highlights.")

    have = {"311": content_hash(RW_M1), "312": content_hash(RW_M2)}
    emit("pastpaper_open.request.cached", {"start": True, "have": have}, endpoint="pastpaper_open", method="POST",
         path=V1 + "pastpapers/{practice_test_id}/open", kind="request", model="PastpaperOpenRequest")
    open_cached = json.loads(json.dumps(open_rw))
    open_cached["modules"] = [module_content(311, 1, 32, RW_M1, unchanged=True),
                              module_content(312, 2, 32, RW_M2, unchanged=True)]
    emit("pastpaper_open.response.cached", open_cached, endpoint="pastpaper_open", method="POST",
         path=V1 + "pastpapers/{practice_test_id}/open", kind="response", model="ExamBundle", status=200,
         note="Every `have` hash matched: questions:null, unchanged:true. Media is still listed (fresh URLs).")

    open_deferred = json.loads(json.dumps(open_math))
    open_deferred["modules"] = [module_content(301, 1, 35, MATH_M1), module_content(302, 2, 35, MATH_M2, deferred=True)]
    open_deferred["media"] = media_list(MATH_M1, PASTPAPER_MEDIA_TTL, NOW)
    emit("pastpaper_open.response.deferred", open_deferred, endpoint="pastpaper_open", method="POST",
         path=V1 + "pastpapers/{practice_test_id}/open", kind="response", model="ExamBundle", status=200,
         note="DESKTOP_PASTPAPER_M2_UPFRONT=False: module 2 deferred; it arrives as submit.next_module.")

    # ---- past paper: start ------------------------------------------------------------------
    started = at(0, 5)
    emit("pastpaper_start.response",
         {"schema": 1, "attempt": pp_math("MODULE_1_ACTIVE", 2, M301,
                                          timing(started, started + timedelta(minutes=35), 35 * 60_000))},
         endpoint="pastpaper_start", method="POST", path=V1 + "pastpapers/attempts/{id}/start", kind="response",
         model="AttemptEnvelope", status=200, headers={IDEM: "start.{attempt_id}"},
         note="Request body is empty ({}).")

    # ---- past paper: sync -------------------------------------------------------------------
    t_sync = at(12)
    sync_req = {"module_id": 301, "seq": 12, "answers": answers_for(MATH_M1, {1001: "B", 1002: "2", 1003: "B"}),
                "flagged": [1004]}
    emit("pastpaper_sync.request", sync_req, endpoint="pastpaper_sync", method="POST",
         path=V1 + "pastpapers/attempts/{id}/sync", kind="request", model="SyncRequest",
         headers={IDEM: "sync.{attempt_id}.{module_id}.{seq}"})
    deadline_m1 = started + timedelta(minutes=35)
    emit("pastpaper_sync.response",
         {"schema": 1, "applied": True, "reason": None,
          "attempt": pp_math("MODULE_1_ACTIVE", 5, M301,
                             timing(t_sync, deadline_m1, int((deadline_m1 - t_sync).total_seconds() * 1000)))},
         endpoint="pastpaper_sync", method="POST", path=V1 + "pastpapers/attempts/{id}/sync", kind="response",
         model="WriteOutcome", status=200)
    emit("pastpaper_sync.response.not_active",
         {"schema": 1, "applied": False, "reason": "module_not_active",
          "attempt": pp_math("MODULE_2_ACTIVE", 9, M302,
                             timing(at(40), at(75), 35 * 60_000))},
         endpoint="pastpaper_sync", method="POST", path=V1 + "pastpapers/attempts/{id}/sync", kind="response",
         model="WriteOutcome", status=200, note="A late sync for module 1 after module 2 began: nothing written.")

    # ---- past paper: submit -----------------------------------------------------------------
    t_sub1 = at(30)
    submit1_req = {"module_id": 301, "seq": 20, "answers": answers_for(MATH_M1, MATH_M1_PICKS), "flagged": [1004]}
    emit("pastpaper_submit.request", submit1_req, endpoint="pastpaper_submit", method="POST",
         path=V1 + "pastpapers/attempts/{id}/submit", kind="request", model="SyncRequest",
         headers={IDEM: "submit.{attempt_id}.{module_id}"})
    m2_deadline = t_sub1 + timedelta(minutes=35)
    emit("pastpaper_submit.response",
         {"schema": 1, "applied": True, "reason": None, "transitioned_to": "MODULE_2_ACTIVE",
          "attempt": pp_math("MODULE_2_ACTIVE", 7, M302, timing(t_sub1, m2_deadline, 35 * 60_000)),
          "next_module": None, "media": [], "result": None},
         endpoint="pastpaper_submit", method="POST", path=V1 + "pastpapers/attempts/{id}/submit", kind="response",
         model="SubmitOutcome", status=200, note="Module 1 submitted; module 2 content was already sent up front.")
    t_sub2 = at(58)
    submit2_req = {"module_id": 302, "seq": 31, "answers": answers_for(MATH_M2, MATH_M2_PICKS), "flagged": []}
    emit("pastpaper_submit.request.final", submit2_req, endpoint="pastpaper_submit", method="POST",
         path=V1 + "pastpapers/attempts/{id}/submit", kind="request", model="SyncRequest",
         headers={IDEM: "submit.{attempt_id}.{module_id}"})
    emit("pastpaper_submit.response.final",
         {"schema": 1, "applied": True, "reason": None, "transitioned_to": "SCORING",
          "attempt": pp_math("SCORING", 9, None, timing(t_sub2, None, None, False)),
          "next_module": None, "media": [], "result": {"poll_after_ms": 2000}},
         endpoint="pastpaper_submit", method="POST", path=V1 + "pastpapers/attempts/{id}/submit", kind="response",
         model="SubmitOutcome", status=200, note="Module 2 submitted: scoring enqueued; poll result.")
    emit("pastpaper_submit.response.noop",
         {"schema": 1, "applied": False, "reason": "module_not_active", "transitioned_to": None,
          "attempt": pp_math("MODULE_2_ACTIVE", 9, M302,
                             timing(at(31), m2_deadline, int((m2_deadline - at(31)).total_seconds() * 1000))),
          "next_module": None, "media": [], "result": None},
         endpoint="pastpaper_submit", method="POST", path=V1 + "pastpapers/attempts/{id}/submit", kind="response",
         model="SubmitOutcome", status=200,
         note="Duplicate submit for a module that is no longer live (new key or lost reply): a no-op success.")
    deferred_next = module_content(302, 2, 35, MATH_M2)
    emit("pastpaper_submit.response.deferred",
         {"schema": 1, "applied": True, "reason": None, "transitioned_to": "MODULE_2_ACTIVE",
          "attempt": pp_math("MODULE_2_ACTIVE", 7, M302, timing(t_sub1, m2_deadline, 35 * 60_000)),
          "next_module": deferred_next, "media": media_list(MATH_M2, PASTPAPER_MEDIA_TTL, t_sub1), "result": None},
         endpoint="pastpaper_submit", method="POST", path=V1 + "pastpapers/attempts/{id}/submit", kind="response",
         model="SubmitOutcome", status=200, note="Only when module 2 was deferred at open.")

    # ---- past paper: pause / resume ---------------------------------------------------------
    t_pause = at(20)
    frozen = int((deadline_m1 - t_pause).total_seconds() * 1000)
    emit("pastpaper_pause.response",
         {"schema": 1, "attempt": pp_math("MODULE_1_ACTIVE", 6, M301, timing(t_pause, None, frozen, True))},
         endpoint="pastpaper_pause", method="POST", path=V1 + "pastpapers/attempts/{id}/pause", kind="response",
         model="AttemptEnvelope", status=200, note="No idempotency key; request body {}.")
    t_resume = at(26)
    emit("pastpaper_resume.response",
         {"schema": 1, "attempt": pp_math("MODULE_1_ACTIVE", 7, M301,
                                          timing(t_resume, t_resume + timedelta(milliseconds=frozen), frozen, False))},
         endpoint="pastpaper_resume", method="POST", path=V1 + "pastpapers/attempts/{id}/resume", kind="response",
         model="AttemptEnvelope", status=200, note="No idempotency key; request body {}.")

    # ---- past paper: result -----------------------------------------------------------------
    emit("pastpaper_result.response.scoring", {"schema": 1, "attempt_id": 9123, "state": "SCORING",
                                               "poll_after_ms": 2000},
         endpoint="pastpaper_result", method="GET", path=V1 + "pastpapers/attempts/{id}/result", kind="response",
         model="PastpaperResult", status=200)
    correct_m1 = {1001: "B", 1002: "2", 1003: "B", 1004: "C", 1005: "B", 1006: "A"}
    correct_m2 = {1011: "7/2, 3.5", 1012: "A", 1013: "A", 1014: "-3"}
    qrows = []
    for mid, qs, picks, correct, flagged in ((301, MATH_M1, MATH_M1_PICKS, correct_m1, {1004}),
                                             (302, MATH_M2, MATH_M2_PICKS, correct_m2, set())):
        for q in qs:
            ans = picks.get(q["id"], "")
            ok_values = [v.strip() for v in correct[q["id"]].split(",")]
            qrows.append({"id": q["id"], "module_id": mid, "order": q["order"], "student_answer": ans or None,
                          "correct_answers": correct[q["id"]], "is_correct": bool(ans) and ans in ok_values,
                          "was_flagged": q["id"] in flagged})
    totals = {"questions": len(qrows), "answered": sum(1 for r in qrows if r["student_answer"]),
              "correct": sum(1 for r in qrows if r["is_correct"])}
    totals["incorrect"] = totals["answered"] - totals["correct"]
    totals["skipped"] = totals["questions"] - totals["answered"]
    modules_summary = [
        {"order": 1, "module_id": 301, "correct": sum(1 for r in qrows if r["module_id"] == 301 and r["is_correct"]),
         "total": len(MATH_M1)},
        {"order": 2, "module_id": 302, "correct": sum(1 for r in qrows if r["module_id"] == 302 and r["is_correct"]),
         "total": len(MATH_M2)}]
    completed_at = at(58, 4)
    result_completed = {
        "schema": 1, "attempt_id": 9123, "practice_test_id": 52, "state": "COMPLETED", "poll_after_ms": None,
        "score": 690, "previous_score": None, "score_delta": None, "completed_at": iso(completed_at),
        "totals": totals, "modules": modules_summary, "questions": qrows,
        "content": {"301": {"content_hash": content_hash(MATH_M1), "questions": MATH_M1},
                    "302": {"content_hash": content_hash(MATH_M2), "questions": MATH_M2}},
        "media": media_list(MATH_M1 + MATH_M2, PASTPAPER_MEDIA_TTL, at(59)),
    }
    emit("pastpaper_result.response.completed", result_completed, endpoint="pastpaper_result", method="GET",
         path=V1 + "pastpapers/attempts/{id}/result", kind="response", model="PastpaperResult", status=200,
         note="No ?have= sent, so content for both modules is included (review content).")
    rw_rows = []
    rw_correct = {2001: "B", 2002: "A", 2003: "A", 2004: "B", 2005: "A", 2006: "B", 2011: "B", 2012: "A", 2013: "B"}
    rw_picks = {2001: "B", 2002: "A", 2003: "C", 2004: "B", 2005: "A", 2006: "B", 2011: "B", 2012: "C"}
    for mid, qs in ((311, RW_M1), (312, RW_M2)):
        for q in qs:
            ans = rw_picks.get(q["id"], "")
            rw_rows.append({"id": q["id"], "module_id": mid, "order": q["order"], "student_answer": ans or None,
                            "correct_answers": rw_correct[q["id"]], "is_correct": ans == rw_correct[q["id"]],
                            "was_flagged": q["id"] == 2003})
    rw_totals = {"questions": len(rw_rows), "answered": sum(1 for r in rw_rows if r["student_answer"]),
                 "correct": sum(1 for r in rw_rows if r["is_correct"])}
    rw_totals["incorrect"] = rw_totals["answered"] - rw_totals["correct"]
    rw_totals["skipped"] = rw_totals["questions"] - rw_totals["answered"]
    emit("pastpaper_result.response.completed_cached", {
        "schema": 1, "attempt_id": 8801, "practice_test_id": 43, "state": "COMPLETED", "poll_after_ms": None,
        "score": 640, "previous_score": 590, "score_delta": 50,
        "completed_at": iso(datetime(2026, 9, 28, 14, 12, 5, tzinfo=timezone.utc)),
        "totals": rw_totals,
        "modules": [{"order": 1, "module_id": 311,
                     "correct": sum(1 for r in rw_rows if r["module_id"] == 311 and r["is_correct"]), "total": 6},
                    {"order": 2, "module_id": 312,
                     "correct": sum(1 for r in rw_rows if r["module_id"] == 312 and r["is_correct"]), "total": 3}],
        "questions": rw_rows,
        "content": {"311": {"content_hash": content_hash(RW_M1), "questions": None},
                    "312": {"content_hash": content_hash(RW_M2), "questions": None}},
        "media": [],
    }, endpoint="pastpaper_result", method="GET", path=V1 + "pastpapers/attempts/{id}/result", kind="response",
        model="PastpaperResult", status=200,
        note="?have=311:sha256:…,312:sha256:… matched: content questions are null; the app uses its cache.")

    # ---- midterm: prepare -------------------------------------------------------------------
    rules = {"title": "October Midterm · Math", "subject": "MATH", "question_count": 44, "module_count": 2,
             "durations_min": [35, 35], "calculator": "graphing", "offscreen_limit": 3,
             "offscreen_grace_seconds": 3, "late_grace_seconds": 300}
    emit("midterm_prepare.request", {}, endpoint="midterm_prepare", method="POST",
         path=V1 + "midterms/{midterm_id}/prepare", kind="request", model="MidtermPrepareRequest")
    not_started = mt("NOT_STARTED", 1, M401, timing(NOW, None, 35 * 60_000))
    emit("midterm_prepare.response", {"schema": 1, "attempt": not_started, "requires_code": True,
                                      "code_verified": False, "rules": rules},
         endpoint="midterm_prepare", method="POST", path=V1 + "midterms/{midterm_id}/prepare", kind="response",
         model="MidtermPrepareResponse", status=200, note="No code sent yet: the app shows the code screen.")
    emit("midterm_prepare.request.code", {"code": "482913"}, endpoint="midterm_prepare", method="POST",
         path=V1 + "midterms/{midterm_id}/prepare", kind="request", model="MidtermPrepareRequest")
    emit("midterm_prepare.response.verified", {"schema": 1, "attempt": not_started, "requires_code": True,
                                               "code_verified": True, "rules": rules},
         endpoint="midterm_prepare", method="POST", path=V1 + "midterms/{midterm_id}/prepare", kind="response",
         model="MidtermPrepareResponse", status=200)
    emit("midterm_prepare.response.code_incorrect",
         {"code": "code_incorrect", "detail": "That code doesn't match. Check it with your teacher and try again."},
         endpoint="midterm_prepare", method="POST", path=V1 + "midterms/{midterm_id}/prepare", kind="error",
         model="ApiErrorBody", status=403)

    # ---- midterm: lockdown handshake (existing endpoints, used as they are) -----------------
    emit("midterm_challenge.response", {"nonce": "n0nce-7f3c2a9e41b84d6c9a5e0b1d2c3f4a5b", "expires_in": 60},
         endpoint="midterm_challenge", method="POST", path="/api/midterms/attempts/{id}/desktop_challenge/",
         kind="response", model="LockdownChallenge", status=200, note="Existing endpoint. Request body {}.")
    precheck = json.dumps({"ok": True, "displays": 1, "remote": False, "vm": False, "apps": []},
                          separators=(",", ":"))
    emit("midterm_session.request",
         {"nonce": "n0nce-7f3c2a9e41b84d6c9a5e0b1d2c3f4a5b", "key_id": "k2026a",
          "mac": "3f1d0b6e9c2a4e8f7d5b1a0c9e8d7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e", "app_version": "0.2.0",
          "precheck": precheck},
         endpoint="midterm_session", method="POST", path="/api/midterms/attempts/{id}/desktop_session/",
         kind="request", model="LockdownSessionRequest",
         note="`precheck` is ms_precheck_json() verbatim (never re-serialised); mac = ms_prove(...).")
    emit("midterm_session.response", {"lockdown_session": "ls-5521-9b2f6e1d4c3a8b7e6f5d4c3b2a1f0e9d", "required": True},
         endpoint="midterm_session", method="POST", path="/api/midterms/attempts/{id}/desktop_session/",
         kind="response", model="LockdownSession", status=200)

    # ---- midterm: open ----------------------------------------------------------------------
    emit("midterm_open.request", {"have": {}}, endpoint="midterm_open", method="POST",
         path=V1 + "midterms/attempts/{id}/open", kind="request", model="MidtermOpenRequest",
         headers={LOCK: "{lockdown_session}"})
    mt_started = NOW
    mt_deadline1 = mt_started + timedelta(minutes=35)
    open_mt = {
        "schema": 1,
        "attempt": mt("MODULE_1_ACTIVE", 2, M401, timing(mt_started, mt_deadline1, 35 * 60_000)),
        "test": MIDTERM_TEST,
        "modules": [module_content(401, 1, 35, MT_M1)],
        "answers": {"401": {}},
        "flagged": {"401": []},
        "media": media_list(MT_M1, MIDTERM_MEDIA_TTL, mt_started),
        "annotations": [],
    }
    emit("midterm_open.response", open_mt, endpoint="midterm_open", method="POST",
         path=V1 + "midterms/attempts/{id}/open", kind="response", model="ExamBundle", status=200,
         note="Live module only; image URLs live 15 minutes; content is never written to disk.")

    # ---- midterm: sync ----------------------------------------------------------------------
    t_msync = at(10)
    emit("midterm_sync.request",
         {"module_id": 401, "seq": 5, "answers": answers_for(MT_M1, {3001: "C", 3002: "6"}), "flagged": [3004]},
         endpoint="midterm_sync", method="POST", path=V1 + "midterms/attempts/{id}/sync", kind="request",
         model="SyncRequest", headers={LOCK: "{lockdown_session}", IDEM: "sync.{attempt_id}.{module_id}.{seq}"})
    emit("midterm_sync.response",
         {"schema": 1, "applied": True, "reason": None,
          "attempt": mt("MODULE_1_ACTIVE", 4, M401,
                        timing(t_msync, mt_deadline1, int((mt_deadline1 - t_msync).total_seconds() * 1000)))},
         endpoint="midterm_sync", method="POST", path=V1 + "midterms/attempts/{id}/sync", kind="response",
         model="WriteOutcome", status=200, note="Also the 15 s heartbeat: same body even with no changes.")
    t_late = mt_deadline1 + timedelta(seconds=320)
    emit("midterm_sync.response.late",
         {"schema": 1, "applied": False, "reason": "late",
          "attempt": mt("MODULE_2_ACTIVE", 6, M402,
                        timing(t_late, mt_deadline1 + timedelta(seconds=300) + timedelta(minutes=35),
                               int((mt_deadline1 + timedelta(seconds=300) + timedelta(minutes=35) - t_late)
                                   .total_seconds() * 1000)))},
         endpoint="midterm_sync", method="POST", path=V1 + "midterms/attempts/{id}/sync", kind="response",
         model="WriteOutcome", status=200, note="More than 300 s after the module deadline: nothing banked.")

    # ---- midterm: submit --------------------------------------------------------------------
    emit("midterm_submit.request",
         {"module_id": 401, "seq": 9, "answers": answers_for(MT_M1, MT_M1_PICKS), "flagged": [3004]},
         endpoint="midterm_submit", method="POST", path=V1 + "midterms/attempts/{id}/submit", kind="request",
         model="SyncRequest", headers={LOCK: "{lockdown_session}", IDEM: "submit.{attempt_id}.{module_id}"})
    t_early = mt_deadline1 - timedelta(milliseconds=500)
    emit("midterm_submit.response.not_expired",
         {"code": "module_not_expired", "detail": "This module is still running.", "retry_after_ms": 500,
          "attempt": mt("MODULE_1_ACTIVE", 5, M401, timing(t_early, mt_deadline1, 500))},
         endpoint="midterm_submit", method="POST", path=V1 + "midterms/attempts/{id}/submit", kind="error",
         model="ApiErrorBody", status=409,
         note="Checked before the idempotency layer, never cached: retry after retry_after_ms + 250.")
    t_msub1 = mt_deadline1 + timedelta(milliseconds=750)
    mt_deadline2 = t_msub1 + timedelta(minutes=35)
    emit("midterm_submit.response",
         {"schema": 1, "applied": True, "reason": None, "transitioned_to": "MODULE_2_ACTIVE",
          "attempt": mt("MODULE_2_ACTIVE", 6, M402, timing(t_msub1, mt_deadline2, 35 * 60_000)),
          "next_module": module_content(402, 2, 35, MT_M2),
          "media": media_list(MT_M2, MIDTERM_MEDIA_TTL, t_msub1), "result": None},
         endpoint="midterm_submit", method="POST", path=V1 + "midterms/attempts/{id}/submit", kind="response",
         model="SubmitOutcome", status=200, note="Module 2 arrives here (content + 15-minute image list).")
    t_msub2 = mt_deadline2 + timedelta(milliseconds=750)
    emit("midterm_submit.response.final",
         {"schema": 1, "applied": True, "reason": None, "transitioned_to": "SCORING",
          "attempt": mt("SCORING", 8, None, timing(t_msub2, None, None)),
          "next_module": None, "media": [], "result": {"poll_after_ms": 2000}},
         endpoint="midterm_submit", method="POST", path=V1 + "midterms/attempts/{id}/submit", kind="response",
         model="SubmitOutcome", status=200)

    # ---- midterm: offscreen -----------------------------------------------------------------
    t_off = at(12)
    emit("midterm_offscreen.request",
         {"event_id": "6f1c2b3a-4d5e-4f60-8a9b-0c1d2e3f4a5b", "occurred_at": iso(t_off - timedelta(seconds=4)),
          "away_ms": 4100},
         endpoint="midterm_offscreen", method="POST", path=V1 + "midterms/attempts/{id}/offscreen", kind="request",
         model="OffscreenRequest", headers={LOCK: "{lockdown_session}", IDEM: "off.{attempt_id}.{event_uuid}"},
         note="The body is informational; the server counts one strike per idempotency key.")
    emit("midterm_offscreen.response",
         {"schema": 1, "violations": 1, "limit": 3, "grace_seconds": 3, "terminated": False,
          "attempt": mt("MODULE_1_ACTIVE", 5, M401,
                        timing(t_off, mt_deadline1, int((mt_deadline1 - t_off).total_seconds() * 1000)), violations=1)},
         endpoint="midterm_offscreen", method="POST", path=V1 + "midterms/attempts/{id}/offscreen", kind="response",
         model="OffscreenOutcome", status=200)
    t_off3 = at(20)
    emit("midterm_offscreen.response.terminated",
         {"schema": 1, "violations": 3, "limit": 3, "grace_seconds": 0, "terminated": True,
          "attempt": mt("SCORING", 9, None, timing(t_off3, None, None), violations=3, terminated_reason="OFFSCREEN")},
         endpoint="midterm_offscreen", method="POST", path=V1 + "midterms/attempts/{id}/offscreen", kind="response",
         model="OffscreenOutcome", status=200, note="Third strike: the sitting ends on the server immediately.")

    # ---- midterm: result --------------------------------------------------------------------
    emit("midterm_result.response.scoring", {"schema": 1, "attempt_id": 5521, "state": "SCORING",
                                             "poll_after_ms": 2000},
         endpoint="midterm_result", method="GET", path=V1 + "midterms/attempts/{id}/result", kind="response",
         model="MidtermResult", status=200)
    emit("midterm_result.response.released",
         {"schema": 1, "attempt_id": 4410, "state": "COMPLETED", "poll_after_ms": None, "score_only": True,
          "released": True, "mock_kind": "MIDTERM", "subject": "MATH", "scoring_scale": "SCALE_800",
          "total_score": 680, "score_ceiling": 800,
          "certificate": {"available": True, "code": "MT-9-77-4F2K",
                          "download_url": "/classes/certificates/midterm/MT-9-77-4F2K/download/", "rank": 4,
                          "cohort_size": 23}},
         endpoint="midterm_result", method="GET", path=V1 + "midterms/attempts/{id}/result", kind="response",
         model="MidtermResult", status=200)
    emit("midterm_result.response.awaiting_release",
         {"schema": 1, "attempt_id": 5521, "state": "COMPLETED", "poll_after_ms": None, "score_only": True,
          "released": False, "mock_kind": "MIDTERM", "subject": "MATH", "scoring_scale": "SCALE_800",
          "total_score": None, "score_ceiling": None, "certificate": None},
         endpoint="midterm_result", method="GET", path=V1 + "midterms/attempts/{id}/result", kind="response",
         model="MidtermResult", status=200, note="Classroom midterm before the teacher publishes results.")

    # ---- media re-sign ----------------------------------------------------------------------
    emit("media.response", {"schema": 1, "attempt_id": 9123, "kind": "pastpaper",
                            "media": media_list(MATH_M1 + MATH_M2, PASTPAPER_MEDIA_TTL, at(90))},
         endpoint="media", method="GET", path=V1 + "attempts/{kind}/{id}/media", kind="response",
         model="MediaResponse", status=200, note="kind is pastpaper|midterm; midterm needs X-Lockdown-Session.")

    # ---- auth (existing endpoints, used as they are) ----------------------------------------
    emit("auth_exchange.request", {"code": "dc-3YqK9w2LmN8pR4tV", "verifier": "vrf-0123456789abcdef0123456789abcdef0123456789a"},
         endpoint="auth_exchange", method="POST", path="/api/desktop/auth/exchange/", kind="request",
         model="AuthExchangeRequest")
    emit("auth_exchange.response", {"ok": True, "access": "eyJhbGciOiJIUzI1NiJ9.fixture-access.sig",
                                    "refresh": "eyJhbGciOiJIUzI1NiJ9.fixture-refresh.sig"},
         endpoint="auth_exchange", method="POST", path="/api/desktop/auth/exchange/", kind="response",
         model="AuthTokens", status=200)
    emit("auth_refresh.request", {"refresh": "eyJhbGciOiJIUzI1NiJ9.fixture-refresh.sig"}, endpoint="auth_refresh",
         method="POST", path="/api/auth/refresh/", kind="request", model="RefreshRequest")
    emit("auth_refresh.response", {"access": "eyJhbGciOiJIUzI1NiJ9.fixture-access-2.sig",
                                   "refresh": "eyJhbGciOiJIUzI1NiJ9.fixture-refresh-2.sig"},
         endpoint="auth_refresh", method="POST", path="/api/auth/refresh/", kind="response", model="AuthTokens",
         status=200, note="Rotation: the old refresh is revoked (60 s lost-reply grace). Always store the new one.")

    # ---- annotations / question reports (existing endpoints) --------------------------------
    emit("annotation_write.request", {"scope": "exam", "ref": "9124", "target_id": 2001, "container": "passage",
                                      "data": [{"start": 0, "end": 15, "kind": "highlight", "color": "yellow"}]},
         endpoint="annotation_write", method="PUT", path="/api/annotations/write/", kind="request",
         model="AnnotationWriteRequest", note="204 No Content. Midterms use ref \"mt-<attempt_id>\".")
    emit("question_report.request", {"system": "exam", "question_id": 2002, "category": "typo_unclear",
                                     "message": "> \"Her method ______ for more than two decades\"\nThe blank is hard to see at 80% zoom.",
                                     "attempt_id": 9124},
         endpoint="question_report", method="POST", path="/api/question-reports/reports/", kind="request",
         model="QuestionReportRequest", headers={IDEM: "report.{uuid}"})
    emit("question_report.response", {"id": 311, "status": "NEW"}, endpoint="question_report", method="POST",
         path="/api/question-reports/reports/", kind="response", model="QuestionReportResponse", status=201)
    emit("question_report.response.deduped", {"id": 311, "deduped": True}, endpoint="question_report",
         method="POST", path="/api/question-reports/reports/", kind="response", model="QuestionReportResponse",
         status=200)

    # ---- errors -----------------------------------------------------------------------------
    emit("error.400", {"code": "practice_test_empty", "detail": "This practice test has no questions yet."},
         endpoint="*", method="*", path=V1 + "*", kind="error", model="ApiErrorBody", status=400)
    emit("error.401", {"detail": "Given token not valid for any token type", "code": "token_not_valid",
                       "messages": [{"token_class": "AccessToken", "token_type": "access",
                                     "message": "Token is invalid or expired"}]},
         endpoint="*", method="*", path="/api/*", kind="error", model="ApiErrorBody", status=401,
         note="Refresh once, then retry the request with the new access token.")
    emit("error.403.lockdown", {"detail": "This midterm was opened in another MasterSAT window. Continue there.",
                                "reason": "desktop_session_replaced", "desktop_required": True},
         endpoint="*", method="*", path=V1 + "midterms/*", kind="error", model="ApiErrorBody", status=403,
         note="Lockdown refusals keep the existing shape: reason + desktop_required (no `code`).")
    emit("error.404", {"code": "not_visible", "detail": "This test is not available to you."},
         endpoint="*", method="*", path=V1 + "*", kind="error", model="ApiErrorBody", status=404)
    emit("error.409", {"code": "state_conflict", "detail": "The attempt is no longer in that state.",
                       "attempt": pp_math("SCORING", 9, None, timing(at(59), None, None))},
         endpoint="*", method="*", path=V1 + "*", kind="error", model="ApiErrorBody", status=409)
    emit("error.426", {"detail": "Update the MasterSAT app to continue.", "code": "update_required",
                       "minimum_version": "0.3.0", "latest_version": "0.3.1",
                       "update_url": "https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe"},
         endpoint="*", method="*", path="/api/*", kind="error", model="ApiErrorBody", status=426,
         note="From mobile.middleware for X-MasterSAT-Client: windows/<semver> below the policy minimum.")
    emit("error.429", {"detail": "Request was throttled. Expected available in 30 seconds."},
         endpoint="*", method="*", path="/api/*", kind="error", model="ApiErrorBody", status=429,
         headers={"Retry-After": "30"})
    emit("error.503", {"code": "desktop_v1_disabled", "detail": "The desktop API is switched off."},
         endpoint="*", method="*", path=V1 + "*", kind="error", model="ApiErrorBody", status=503,
         note="DESKTOP_V1_ENABLED=False.")

    manifest = {
        "schema": 1,
        "generated_by": "desktop-native/tool/contracts/gen_v1_fixtures.py",
        "now": iso(NOW),
        "content_hash": "sha256 over json.dumps(questions, sort_keys=True, separators=(',', ':'), "
                        "ensure_ascii=False).encode('utf-8'), prefixed 'sha256:'",
        "fixtures": FIXTURES,
        "media": [{"key": k, "file": f"media/{k}"} for k in ALL_IMAGE_KEYS],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_media()
    write_dart_embed()


# ---------------------------------------------------------------------------------------------
# Fixture images: tiny deterministic PNGs so a local fixture server can serve real bytes.
# ---------------------------------------------------------------------------------------------

def png(width: int, height: int, seed: int) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            border = x in (0, width - 1) or y in (0, height - 1)
            grid = (x % 20 == 0) or (y % 20 == 0)
            bar = (x // 24) % 4 == seed % 4 and y > height - 1 - ((x * 7 + seed * 13) % (height - 8))
            if border:
                rows += bytes((15, 23, 42))
            elif bar:
                rows += bytes((37, 57, 133))
            elif grid:
                rows += bytes((226, 232, 240))
            else:
                rows += bytes((255, 255, 255))
    raw = zlib.compress(bytes(rows), 9)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


def write_media() -> None:
    for i, key in enumerate(ALL_IMAGE_KEYS):
        path = OUT / "media" / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png(160, 100, i))


def write_dart_embed() -> None:
    """Embed every fixture in Dart so FixtureV1Api works in tests AND in `flutter run`
    (no file IO, no assets outside the package). A test checks it equals the JSON files."""
    import base64
    dart_out = DART_EMBED
    files = sorted(p.name for p in OUT.glob("*.json"))
    lines = [
        "// GENERATED by desktop-native/tool/contracts/gen_v1_fixtures.py — do not edit.",
        "// The committed contracts/v1/*.json files, embedded for FixtureV1Api.",
        "// ignore_for_file: lines_longer_than_80_chars",
        "",
        "/// File name → exact file contents.",
        "const Map<String, String> v1FixtureFiles = {",
    ]
    for name in files:
        text = (OUT / name).read_text(encoding="utf-8")
        if "\'\'\'" in text:
            raise SystemExit(f"{name} contains a triple quote; cannot embed as a raw string")
        lines.append(f"  '{name}': r\'\'\'{text}\'\'\',")
    lines.append("};")
    lines.append("")
    lines.append("/// Fixture image storage key → PNG bytes (base64).")
    lines.append("const Map<String, String> v1FixtureMediaBase64 = {")
    for key in ALL_IMAGE_KEYS:
        b64 = base64.b64encode((OUT / "media" / key).read_bytes()).decode()
        lines.append(f"  '{key}': '{b64}',")
    lines.append("};")
    dart_out.parent.mkdir(parents=True, exist_ok=True)
    dart_out.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    build()
    print(f"wrote {len(FIXTURES)} fixtures + manifest.json + {len(ALL_IMAGE_KEYS)} images to {OUT}")
