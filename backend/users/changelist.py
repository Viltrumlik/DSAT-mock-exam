"""What a Django-admin changelist needs from the server — search, facets counted with the OTHER filters
applied, and clamped pages. Shared by the /ops people and classrooms lists (plan 2026-10-15-ops-detail-pages).

A filter definition is ``{key: (label, choices(qs) -> [(value, label, count)], to_q(value) -> Q | None)}``.
"""

from __future__ import annotations

from django.db.models import Q

PAGE_SIZES = (25, 50, 100)
DEFAULT_PAGE_SIZE = 50


def to_int(raw):
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def apply_search(qs, q: str, fields: list[str]):
    """Every word (at most five) must match one of ``fields``, case-insensitively."""
    for term in (q or "").split()[:5]:
        cond = Q()
        for f in fields:
            cond |= Q(**{f"{f}__icontains": term})
        qs = qs.filter(cond)
    return qs


def facets(qs, defs: dict, params):
    """``(qs with every chosen filter applied, the filters payload)``. Each filter's counts are taken with
    the search and every OTHER chosen filter applied, as a facet is; a value ``to_q`` refuses is ignored."""
    chosen = {}
    for key, (_, _, to_q) in defs.items():
        value = (params.get(key) or "").strip()
        q = to_q(value) if value else None
        if q is not None:
            chosen[key] = (value, q)

    def applied(base, skip=None):
        for key, (_, q) in chosen.items():
            if key != skip:
                base = base.filter(q)
        return base

    filters = [
        {
            "key": key,
            "label": label,
            "options": [{"value": v, "label": lab, "count": n} for v, lab, n in choices(applied(qs, skip=key))],
            "selected": chosen[key][0] if key in chosen else None,
        }
        for key, (label, choices, _) in defs.items()
    ]
    return applied(qs), filters


def paginate(qs, params):
    """``(the page's slice of qs, {count, page, page_size, pages})``. An unknown page size is the default;
    a page past either end is clamped, so a stale link still shows rows."""
    count = qs.count()
    size = to_int(params.get("page_size"))
    size = size if size in PAGE_SIZES else DEFAULT_PAGE_SIZE
    pages = max(1, -(-count // size))
    page = min(max(to_int(params.get("page")) or 1, 1), pages)
    return qs[(page - 1) * size: page * size], {"count": count, "page": page, "page_size": size, "pages": pages}


def page_slice(meta) -> slice:
    """The rows ``paginate`` chose, for a queryset annotated after counting (the count does not need it)."""
    start = (meta["page"] - 1) * meta["page_size"]
    return slice(start, start + meta["page_size"])
