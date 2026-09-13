"""One branch's whole midterm month, nested department → teacher → classroom → student.

What this exists for: the console could export a PDF of ONE classroom on ONE paper, so an
administrator who wanted the branch had to download a dozen files and staple them. This
assembles the same evidence for every class under a branch in one pass, in the order the
school is organised, so it can be printed as a single document.

**The numbers are not recomputed here.** Every tally comes from ``stats.school_month_stats``
— the same call the statistics page draws — and this module only walks its tree and hangs
the per-student rows off the classroom leaves. A report that did its own arithmetic would be
free to disagree with the page an administrator read it from, which is the one thing a
printed document must never do.

The per-student rows come from ``admin_report.build_midterm_rows``, so a student rescued by
a retake reads as passed here exactly as they do on screen.
"""

from __future__ import annotations

from classes.models import Classroom
from classes.models_org import Branch

from .admin_report import build_midterm_rows, retakes_for
from .stats import _midterm_brief, month_index, school_month_stats

#: Levels of ``school_month_stats``'s tree, outermost first. A branch report starts at
#: ``branch`` and keeps the three below it; the region above is named in the header instead.
_DEPARTMENT, _TEACHER, _CLASSROOM = "department", "teacher", "classroom"


def branch_brief(branch) -> dict | None:
    if branch is None:
        return None
    return {
        "id": branch.id,
        "name": branch.name,
        "region": branch.region.name if branch.region_id else None,
    }


def _children(node) -> list[dict]:
    return list(node.get("children") or ())


def _find_branch_node(tree: list[dict], branch_id: int | None) -> dict | None:
    """The branch node in a region-rooted tree.

    ``school_month_stats(branch_id=…)`` already filters the classrooms, so the tree it
    returns holds exactly one branch — but it is still wrapped in its region, and an
    unassigned classroom sits under an unassigned region whose branch node has ``id: None``.
    Matching on the id rather than on position is what makes both cases land.
    """
    for region in tree:
        for branch in _children(region):
            if branch.get("level") != "branch":
                continue
            if branch_id is None or branch.get("id") == branch_id:
                return branch
    return None


def _papers_for(classroom, midterm_ids) -> list[dict]:
    """Every countable paper this class sat in the month, with its per-student table.

    Ordered by title so two runs of the same report print the same document.
    """
    from .models import Midterm

    papers = []
    for midterm in Midterm.objects.filter(id__in=sorted(midterm_ids)).order_by("title", "id"):
        retakes = list(retakes_for(midterm))
        rows, summary = build_midterm_rows(classroom, midterm, retakes)
        papers.append(
            {
                "midterm": _midterm_brief(midterm),
                # One retake column on the sheet, so one named paper — the rest are still
                # consulted for each student's verdict by ``build_midterm_rows``.
                "retake": _midterm_brief(retakes[0]) if retakes else None,
                "retakes": [_midterm_brief(r) for r in retakes],
                "summary": summary,
                "rows": rows,
            }
        )
    return papers


def build_branch_report(*, branch_id: int | None, month: str | None) -> dict:
    """Everything one branch sat in one month, ready to print.

    ``branch_id=None`` means the whole school — the same document with every branch's
    departments flattened into one list, which is what an owner with one branch gets anyway.

    Returns ``departments: []`` for a month the branch never sat rather than raising: an
    empty month is a fact about the branch, and the PDF says so on its cover.
    """
    branch = Branch.objects.select_related("region").filter(pk=branch_id).first() if branch_id else None
    stats = school_month_stats(month, branch_id=branch_id)

    # (classroom, midterm) pairs that landed in this month — the same index the statistics
    # used to decide what counts, so a paper cannot appear in one and not the other.
    classroom_ids = [
        node["id"]
        for region in stats["tree"]
        for br in _children(region)
        for dept in _children(br)
        for teacher in _children(dept)
        for node in _children(teacher)
        if node.get("level") == _CLASSROOM and node.get("id") is not None
    ]
    papers_by_classroom: dict[int, set[int]] = {}
    if classroom_ids:
        for (cid, mid), (key, _basis) in month_index(classroom_ids).items():
            if key == month:
                papers_by_classroom.setdefault(cid, set()).add(mid)

    classrooms = {c.id: c for c in Classroom.objects.select_related("teacher", "branch").filter(id__in=classroom_ids)}

    if branch_id is None:
        # The whole school: every branch's departments, in the tree's own order.
        department_nodes = [
            dept
            for region in stats["tree"]
            for br in _children(region)
            for dept in _children(br)
        ]
        header = None
    else:
        node = _find_branch_node(stats["tree"], branch_id)
        department_nodes = _children(node) if node else []
        header = branch_brief(branch)

    departments = []
    for dept in department_nodes:
        teachers = []
        for teacher in _children(dept):
            rooms = []
            for room in _children(teacher):
                classroom = classrooms.get(room.get("id"))
                if classroom is None:
                    continue
                rooms.append(
                    {
                        **{k: v for k, v in room.items() if k != "children"},
                        "papers": _papers_for(classroom, papers_by_classroom.get(classroom.id, set())),
                    }
                )
            teachers.append({**{k: v for k, v in teacher.items() if k != "children"}, "classrooms": rooms})
        departments.append({**{k: v for k, v in dept.items() if k != "children"}, "teachers": teachers})

    return {
        "branch": header,
        "month": stats["month"],
        "definition": stats["definition"],
        "totals": stats["totals"],
        "orphan_retakes": stats["orphan_retakes"],
        "departments": departments,
    }
