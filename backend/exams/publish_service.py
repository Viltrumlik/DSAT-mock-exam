"""
Publish-readiness checks for timed mocks and pastpaper packs.

All structural rules are delegated to sat_rules.py — do not add
SAT constraints here directly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Tuple

if TYPE_CHECKING:
    from .models import MockExam, PastpaperPack

from .sat_rules import (
    mock_exam_publish_violations,
    pastpaper_pack_publish_violations,
)


def mock_exam_publish_ready(exam: "MockExam") -> Tuple[bool, str]:
    """
    Returns (is_ready, blocking_message).

    Delegates entirely to the canonical SAT rule engine in sat_rules.py.
    For midterms: question counts are flexible (institution-controlled).
    For full MOCK_SAT: strict Digital SAT structure required.
    """
    violations = mock_exam_publish_violations(exam)
    if violations:
        return False, violations[0].message
    return True, ""


def pastpaper_pack_publish_ready(pack: "PastpaperPack") -> Tuple[bool, str]:
    """
    Returns (is_ready, blocking_message) for a pastpaper pack.

    A complete SAT pastpaper pack must have both R&W and Math sections,
    each with exactly 2 modules at the official question counts (27/22).
    """
    violations = pastpaper_pack_publish_violations(pack)
    if violations:
        return False, violations[0].message
    return True, ""


def mock_exam_all_violations(exam: "MockExam") -> list[str]:
    """Return all blocking violation messages for display in admin UIs."""
    return [v.message for v in mock_exam_publish_violations(exam)]


def pastpaper_pack_all_violations(pack: "PastpaperPack") -> list[str]:
    """Return all blocking violation messages for display in admin UIs."""
    return [v.message for v in pastpaper_pack_publish_violations(pack)]
