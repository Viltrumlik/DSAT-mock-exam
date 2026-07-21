"""Live sync: legacy ``exams.MockExam(kind=MIDTERM)`` → new ``midterms.Midterm``.

The legacy Questions-console builder (``/builder/midterms``) still authors midterms into
``exams.MockExam``. The *separated* runtime — teacher standalone area, student runner,
scorer, certificates — reads ``midterms.Midterm``. Without a bridge, a midterm published
in the builder never reaches the new tables (the one-shot ``migrate_midterms_to_new_tables``
command only moves what already existed).

This module mirrors the **definition + questions** of a legacy midterm into the new tables
on publish/unpublish/delete, so builder-authored midterms appear in the new teacher area.
It never touches attempt/cert/grant data (those are migrated once), and it refuses to
rebuild questions once any attempt exists — attempt answers key on ``Question.id``, so a
delete+recreate would orphan them.

Idempotent on ``Midterm.legacy_mock_exam_id`` (unique). Safe to call inside a request path;
callers wrap it so a mirror failure never breaks the legacy publish itself.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# exams.Question content fields copied verbatim onto the mirror's question rows.
# Kept in lock-step with migrate_midterms_to_new_tables._QUESTION_FIELDS.
_QUESTION_FIELDS = [
    "question_type", "question_text", "question_prompt", "question_image",
    "option_a", "option_b", "option_c", "option_d",
    "option_a_image", "option_b_image", "option_c_image", "option_d_image",
    "correct_answers", "is_math_input", "score", "explanation",
    # Taxonomy rides along so a skill set in the builder reaches the mirrored question the
    # error report actually grades. Omitting it would leave every mirrored question
    # unclassified no matter what the builder shows.
    "skill_id",
]


def _is_legacy_midterm(mock) -> bool:
    from exams.models import MockExam

    return getattr(mock, "kind", None) == MockExam.KIND_MIDTERM


def upsert_midterm_from_legacy(mock, *, sync_questions: bool = True):
    """Create or refresh the ``midterms.Midterm`` mirror of a legacy midterm MockExam.

    Returns the mirror ``Midterm`` (or ``None`` when ``mock`` is not a midterm). Refreshes
    the definition (title/subject/scale/timing/publish state) every call. Rebuilds the
    owned question module from the legacy sections only when ``sync_questions`` is set AND
    the mirror has no attempts yet.
    """
    if not _is_legacy_midterm(mock):
        return None

    from exams.models import Module
    from .models import Midterm

    m1 = int(getattr(mock, "midterm_module1_minutes", 60) or 60)
    m2 = int(getattr(mock, "midterm_module2_minutes", 60) or 60)
    count = int(getattr(mock, "midterm_module_count", 1) or 1)
    duration = max(1, m1 + (m2 if count >= 2 else 0))

    midterm, _created = Midterm.objects.get_or_create(
        legacy_mock_exam_id=mock.id,
        defaults={
            "title": mock.title,
            "subject": getattr(mock, "midterm_subject", None) or Midterm.READING_WRITING,
            # The builder authors the tier on the legacy exam; mirror it verbatim so a
            # Math middle/senior midterm gets its calculator (see Midterm.calculator_enabled).
            "level": getattr(mock, "midterm_level", "") or "",
            "scoring_scale": getattr(mock, "midterm_scoring_scale", None) or Midterm.SCALE_100,
            "duration_minutes": duration,
            "question_limit": int(getattr(mock, "midterm_module_question_limit", 30) or 30),
            "midterm_type": getattr(mock, "midterm_type", None) or Midterm.TYPE_MIDTERM,
            "pass_mark": getattr(mock, "midterm_pass_mark", None),
            "is_published": bool(getattr(mock, "is_published", False)),
            "published_at": getattr(mock, "published_at", None),
        },
    )

    # Refresh the definition from the legacy source of truth on every sync.
    midterm.title = mock.title
    midterm.subject = getattr(mock, "midterm_subject", None) or midterm.subject
    # Mirror VERBATIM — legacy is the source of truth, exactly like title/subject/scale
    # above. Do NOT fall back to the mirror's own value on blank: `midterm_level` is
    # blank=True (never None), so a fallback would fire precisely when an admin CLEARS
    # the tier to "Any level", leaving the calculator stuck ON with no way to turn it off.
    midterm.level = getattr(mock, "midterm_level", "") or ""
    midterm.scoring_scale = getattr(mock, "midterm_scoring_scale", None) or midterm.scoring_scale
    midterm.midterm_type = getattr(mock, "midterm_type", None) or Midterm.TYPE_MIDTERM
    # Mirror VERBATIM, including None — same reasoning as `level` above. `pass_mark` is
    # nullable and None MEANS "use the scale default", so an `or` fallback here would make
    # clearing the pass mark in the builder impossible.
    midterm.pass_mark = getattr(mock, "midterm_pass_mark", None)
    # Resolve the retake link through the mirrors: the builder points one MockExam at
    # another, and the runtime needs the corresponding Midterm rows. Left as None until the
    # parent's mirror exists, so publish order never breaks the sync.
    parent_mock_id = getattr(mock, "midterm_retake_of_id", None)
    midterm.retake_of = (
        Midterm.objects.filter(legacy_mock_exam_id=parent_mock_id).first() if parent_mock_id else None
    )
    midterm.duration_minutes = duration
    midterm.question_limit = int(getattr(mock, "midterm_module_question_limit", 30) or 30)
    midterm.is_published = bool(getattr(mock, "is_published", False))
    midterm.published_at = getattr(mock, "published_at", None)

    if not midterm.question_module_id:
        module = Module.objects.create(
            practice_test=None, module_order=1, time_limit_minutes=duration
        )
        midterm.question_module = module
    else:
        module = midterm.question_module
        if module.time_limit_minutes != duration:
            module.time_limit_minutes = duration
            module.save(update_fields=["time_limit_minutes"])
    midterm.save()

    # Mirror questions from the legacy sections LIVE — refresh IN PLACE on every sync so
    # builder edits/additions show immediately (no frozen snapshot). Question.id is
    # preserved per position, so existing attempt answers (keyed on Question.id) survive.
    # No longer gated on attempts — historical immutability was intentionally dropped to
    # match assessments/pastpapers.
    if sync_questions:
        practice_tests = list(mock.tests.all().order_by("id"))
        if len(practice_tests) >= 2:
            # Multiple PracticeTests = multiple VERSIONS: mirror each into its own
            # MidtermVersion. Leave the flat question_module INTACT — emptying it would
            # orphan any legacy single-set attempts (an attempt with version_id=NULL
            # resolves effective_questions() to the flat module). It is simply dormant for
            # new (version-pinned) attempts, and display counts are version-aware. A midterm
            # that was versioned from the start has an empty flat module anyway.
            _sync_versions(midterm, practice_tests)
        else:
            # Single set: drop any stale versions and flatten questions into the
            # midterm's own module (legacy single-version behavior).
            for v in list(midterm.versions.all()):
                v.delete()
            _sync_module_questions_in_place(module, _iter_live_questions(practice_tests))

    return midterm


def _iter_live_questions(practice_tests) -> list:
    """Flatten the live builder questions of the given PracticeTests, in authoring order."""
    live = []
    for section in practice_tests:
        for src_mod in section.modules.all().order_by("module_order"):
            live.extend(src_mod.questions.all().order_by("order", "id"))
    return live


def _sync_module_questions_in_place(module, live_questions) -> None:
    """Make ``module``'s mirrored Questions match ``live_questions`` (ordered) BY POSITION.

    Updates content in place (preserving ``Question.id`` so attempt answers survive),
    appends new questions, and trims extras. This is what makes midterm content live:
    re-running it after a builder edit refreshes the mirror without orphaning attempts.
    """
    from exams.models import Question

    existing = list(Question.objects.filter(module_id=module.id).order_by("order", "id"))
    for i, src in enumerate(live_questions):
        fields = {f: getattr(src, f) for f in _QUESTION_FIELDS}
        if i < len(existing):
            q = existing[i]
            dirty = []
            if q.order != i:
                q.order = i
                dirty.append("order")
            for f, val in fields.items():
                if getattr(q, f) != val:
                    setattr(q, f, val)
                    dirty.append(f)
            if dirty:
                # _plain_db_save: order is already finalized densely (0..n-1) by position,
                # so bypass the dense-reindex-under-lock in Question.save (its intended use).
                q.save(update_fields=list(dict.fromkeys(dirty)) + ["updated_at"], _plain_db_save=True)
        else:
            q = Question(module_id=module.id, order=i, **fields)
            q.save(_plain_db_save=True)
    # Trim questions the builder no longer has (orphans any attempt answer for them — the
    # accepted live-content tradeoff).
    for q in existing[len(live_questions):]:
        q.delete()


def _sync_versions(midterm, practice_tests) -> None:
    """Mirror up to 4 legacy PracticeTests into ``midterm.versions`` (one per version),
    each owning its own Module of questions. IN-PLACE: versions are matched by
    ``legacy_practice_test_id`` and their questions refreshed by position, so re-syncing
    after a builder edit keeps content live while preserving Question.id for attempts."""
    from exams.models import Module
    from .models import MidtermVersion

    duration = midterm.duration_minutes or 1
    keep_pt_ids = set()
    # Existing versions keep their number; new ones take the next FREE number so a
    # remove-then-add-version sequence can't collide with the (midterm, version_number)
    # unique constraint.
    used = set(midterm.versions.values_list("version_number", flat=True))

    def _next_free() -> int:
        n = 1
        while n in used:
            n += 1
        used.add(n)
        return n

    for pt in practice_tests[:4]:
        keep_pt_ids.add(pt.id)
        version = midterm.versions.filter(legacy_practice_test_id=pt.id).first()
        if version is None:
            num = _next_free()
            module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=duration)
            version = MidtermVersion.objects.create(
                midterm=midterm,
                version_number=num,
                label=f"Version {chr(64 + num)}" if num <= 26 else f"Version {num}",
                question_module=module,
                legacy_practice_test_id=pt.id,
            )
        else:
            module = version.question_module
            if module is None:
                module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=duration)
                version.question_module = module
                version.save(update_fields=["question_module"])
        _sync_module_questions_in_place(module, _iter_live_questions([pt]))
    # Drop versions whose legacy PracticeTest no longer exists.
    for v in list(midterm.versions.exclude(legacy_practice_test_id__in=keep_pt_ids)):
        v.delete()


def resync_midterm_for_module(module_id) -> None:
    """Re-mirror the midterm owning this legacy ``exams.Module``, if any.

    Called from the builder's question/module mutation paths so edits/additions show live
    in the runner. No-op for non-midterm modules; never raises (a mirror failure must not
    break the builder edit itself)."""
    try:
        from exams.models import Module, MockExam

        mod = (
            Module.objects.select_related("practice_test__mock_exam")
            .filter(pk=module_id)
            .first()
        )
        pt = getattr(mod, "practice_test", None) if mod is not None else None
        exam = getattr(pt, "mock_exam", None) if pt is not None else None
        if exam is not None and exam.kind == MockExam.KIND_MIDTERM:
            upsert_midterm_from_legacy(exam, sync_questions=True)
    except Exception:  # pragma: no cover - defensive
        logger.exception("midterm mirror resync failed for module_id=%s", module_id)


def resync_midterm_for_exam(exam) -> None:
    """Re-mirror a midterm MockExam directly (e.g. after add/remove version). Never raises."""
    try:
        from exams.models import MockExam

        if getattr(exam, "kind", None) == MockExam.KIND_MIDTERM:
            upsert_midterm_from_legacy(exam, sync_questions=True)
    except Exception:  # pragma: no cover - defensive
        logger.exception("midterm mirror resync failed for exam_id=%s", getattr(exam, "pk", None))


def unpublish_midterm_mirror(mock) -> None:
    """Hide the mirror when the legacy midterm is unpublished."""
    if not _is_legacy_midterm(mock):
        return
    from .models import Midterm

    Midterm.objects.filter(legacy_mock_exam_id=mock.id).update(
        is_published=False, published_at=None
    )


def delete_midterm_mirror(mock) -> None:
    """Remove the mirror when the legacy midterm is deleted.

    If the mirror already has attempts, its results/certificates must survive — so it is
    merely unpublished (hidden from the teacher catalog) rather than deleted.
    """
    if not _is_legacy_midterm(mock):
        return
    from .models import Midterm, MidtermAttempt

    for mt in Midterm.objects.filter(legacy_mock_exam_id=mock.id):
        if MidtermAttempt.objects.filter(midterm=mt).exists():
            Midterm.objects.filter(pk=mt.pk).update(is_published=False, published_at=None)
        else:
            mt.delete()
