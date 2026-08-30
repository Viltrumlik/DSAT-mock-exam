"""Survey answering rules.

Validation lives here rather than in a serializer because the shape of a valid answer depends
on the question's type, and the same rules are needed by both the submit endpoint and any
future import path.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .models import Survey, SurveyAnswer, SurveyQuestion, SurveyResponse


def normalize_answer(question: SurveyQuestion, raw):
    """Coerce and validate one answer, or raise ``ValidationError``.

    Returns the value to store. An unanswered optional question stores ``None`` rather than an
    empty string, so "skipped" and "answered with nothing" stay distinguishable in the results.
    """
    qt = question.question_type
    blank = raw is None or (isinstance(raw, str) and not raw.strip()) or (
        isinstance(raw, list) and not raw
    )

    if blank:
        if question.is_required:
            raise ValidationError(f"“{question.prompt}” is required.")
        return None

    if qt in (SurveyQuestion.TYPE_SHORT_TEXT, SurveyQuestion.TYPE_LONG_TEXT):
        return str(raw).strip()

    if qt == SurveyQuestion.TYPE_DATE:
        from django.utils.dateparse import parse_date

        if parse_date(str(raw)) is None:
            raise ValidationError(f"“{question.prompt}” needs a date (YYYY-MM-DD).")
        return str(raw)

    if qt in SurveyQuestion.NUMERIC_TYPES:
        # A slider posts "7" as readily as 7, and a 0 must survive the blank test above —
        # which it does, because 0 is neither None, nor an empty string, nor an empty list.
        try:
            value = int(raw)
        except (TypeError, ValueError):
            raise ValidationError(f"“{question.prompt}” needs a number.")
        if not (question.scale_min <= value <= question.scale_max):
            raise ValidationError(
                f"“{question.prompt}” must be between {question.scale_min} and {question.scale_max}."
            )
        return value

    options = list(question.options or [])
    if qt == SurveyQuestion.TYPE_SINGLE_CHOICE:
        if str(raw) not in options:
            raise ValidationError(f"“{question.prompt}” has no such option.")
        return str(raw)

    if qt == SurveyQuestion.TYPE_MULTI_CHOICE:
        picked = [str(x) for x in (raw if isinstance(raw, list) else [raw])]
        unknown = [x for x in picked if x not in options]
        if unknown:
            raise ValidationError(f"“{question.prompt}” has no option {unknown[0]!r}.")
        # Deduplicated but order-preserving: a client that sends the same box twice is a bug,
        # not a reason to reject the whole submission.
        return list(dict.fromkeys(picked))

    raise ValidationError(f"Unsupported question type {qt!r}.")


def normalize_follow_up(question: SurveyQuestion, value, raw_text) -> str:
    """The comment to store beside ``value``, or ``""``.

    **Text for a question that did not open its box is dropped, not refused.** A student who
    types a reason at 6 and then drags the slider to 9 has watched the box disappear; failing
    their whole submission over a string they can no longer see would be a dead end with no
    visible cause. The stored answer is the one the form was showing when they pressed Submit.

    The reverse — a box that IS open and IS required and IS empty — is a real refusal, and it
    names the question so the student can find it.
    """
    text = ("" if raw_text is None else str(raw_text)).strip()
    if not question.wants_follow_up(value):
        return ""
    if question.follow_up_required and not text:
        raise ValidationError(
            f"“{question.prompt}” — please add a short note to go with that answer."
        )
    return text


def _pick(mapping: dict, question: SurveyQuestion):
    """``mapping[question.id]`` whether the client keyed it by int or by string."""
    if not isinstance(mapping, dict):
        return None
    return mapping.get(str(question.id), mapping.get(question.id))


@transaction.atomic
def submit_response(
    survey: Survey, student, answers: dict, *, follow_ups: dict | None = None,
    anonymous: bool = False,
) -> SurveyResponse:
    """Record a student's completed survey.

    ``answers`` is ``{question_id: value}``; ``follow_ups`` is the parallel
    ``{question_id: comment}`` for the questions that opened a follow-up box. Two maps
    rather than one composite value per question, so the ``answers`` shape a client already
    sends keeps working unchanged and a comment can never be mistaken for an answer.

    Submitting is one shot, matching the single-response rule: there is no draft-then-submit
    dance, and a second attempt is refused rather than silently overwriting the first — the
    40 points are already banked against that response.
    """
    if not survey.is_open():
        raise ValidationError("That survey is not open.")

    # `get_or_create`, not `select_for_update().first()`. A row lock locks a ROW, and on a
    # first-ever submit there is no row to lock — so two clicks landing together both saw
    # nothing, both went on to write, and the second one hit `uniq_survey_response_per_student`
    # and came back as a 500 with a stack trace. A double-tapped Submit button is not an
    # error condition; it is the single most likely thing a student does.
    #
    # After this, `existing` is real and the SELECT ... FOR UPDATE below has something to
    # hold, so the "already completed" check is serialised the way it always meant to be.
    SurveyResponse.objects.get_or_create(survey=survey, student=student)
    existing = SurveyResponse.objects.select_for_update().get(
        survey=survey, student=student
    )
    if existing.status == SurveyResponse.STATUS_SUBMITTED:
        raise ValidationError("You have already completed that survey.")

    questions = list(survey.questions.all())
    if not questions:
        raise ValidationError("That survey has no questions yet.")

    follow_ups = follow_ups if isinstance(follow_ups, dict) else {}

    # Validate EVERYTHING before writing anything: a half-saved response would leave the
    # student looking at a form they cannot resubmit.
    #
    # In ORDER, because a question's visibility can depend on an earlier answer, and the
    # earlier answer has to be normalised before it can be read. `survey.questions` is
    # ordered by ("order", "id") on the model's Meta, so one pass is enough — the serializer
    # guarantees a condition only ever points backwards.
    normalized: list[tuple[SurveyQuestion, object, str]] = []
    seen: dict[int, object] = {}
    for question in questions:
        if not question.is_visible_given(seen):
            # HIDDEN. Not asked, so not required — and whatever the client sent for it is
            # DROPPED rather than stored. Both halves matter: without the first, a required
            # question on a branch the student never saw makes the survey unsubmittable with
            # an error naming a question that was never on screen; without the second, a
            # stale answer from before they changed the score above pollutes the results with
            # a reply to a question that was not asked.
            #
            # Recorded as None in `seen` too, so a question depending on a hidden question is
            # itself hidden rather than reading a stale value.
            seen[question.id] = None
            normalized.append((question, None, ""))
            continue
        value = normalize_answer(question, _pick(answers, question))
        comment = normalize_follow_up(question, value, _pick(follow_ups, question))
        seen[question.id] = value
        normalized.append((question, value, comment))

    response = existing
    response.status = SurveyResponse.STATUS_SUBMITTED
    # Asked for AND offered. A client that posts anonymous=true against a survey whose author
    # never turned anonymity on gets a signed response, not a 400: the flag is a preference,
    # and the authority for whether it can be honoured is the survey, not the request body.
    response.is_anonymous = bool(anonymous) and survey.allow_anonymous
    response.submitted_at = timezone.now()
    response.save()

    for question, value, comment in normalized:
        SurveyAnswer.objects.update_or_create(
            response=response,
            question=question,
            defaults={"value": value, "follow_up": comment},
        )
    return response


def open_surveys_for(student):
    """Published, in-window surveys with something to answer that the student has not done.

    ``questions__isnull=False`` is not decoration. Nothing stops an author deleting the last
    question from a PUBLISHED survey, and until this filter existed the empty form stayed on
    the student's list, opened to a page with no questions, and offered a Submit that the
    server refused with "That survey has no questions yet" — a dead end reachable in three
    clicks with no way for the student to know it was not their fault.
    """
    now = timezone.now()
    done = SurveyResponse.objects.filter(
        student=student, status=SurveyResponse.STATUS_SUBMITTED
    ).values_list("survey_id", flat=True)
    return (
        Survey.objects.filter(status=Survey.STATUS_PUBLISHED, questions__isnull=False)
        .exclude(id__in=done)
        .exclude(opens_at__gt=now)
        .exclude(closes_at__lt=now)
        # The join to questions multiplies the row per question.
        .distinct()
        .order_by("-created_at", "-id")
    )


# ── Reading the results ───────────────────────────────────────────────────────


def _summarise_question(question: SurveyQuestion, answers: list, not_asked: int = 0) -> dict:
    """One question's results, shaped for the way that question is actually read.

    A choice question is read as a distribution ("14 of 31 picked B"); a slider is read as an
    average with the low scores called out; free text is read one line at a time. Returning a
    single generic shape and letting the client work it out is how the current console ended
    up printing a raw list of every answer for every type.

    ``answered`` counts only real answers — a skipped optional question is ``None`` in the
    database and must not drag an average down or inflate a percentage.
    """
    given = [a for a in answers if a.value is not None]
    summary = {
        "question_id": question.id,
        "prompt": question.prompt,
        "question_type": question.question_type,
        "answered": len(given),
        # SKIPPED means "was asked and chose not to answer". A question on a branch the
        # student never reached is NOT that, and lumping the two together would make a
        # conditional question look like mass non-response — "8 answered, 192 skipped" for a
        # question only 12 people were ever shown. Both are stored as a NULL answer, so the
        # difference is recovered by re-evaluating the condition against each reply.
        "skipped": len(answers) - len(given) - not_asked,
        "not_asked": not_asked,
        "is_conditional": question.is_conditional,
        # Every comment written on this question, with the answer that prompted it, so a
        # reader can see "6 — the pace is too fast" as one thought rather than two columns.
        "comments": [
            {"value": a.value, "text": a.follow_up}
            for a in answers
            if (a.follow_up or "").strip()
        ],
    }

    if question.question_type in SurveyQuestion.CHOICE_TYPES:
        counts = {str(o): 0 for o in (question.options or [])}
        for a in given:
            picked = a.value if isinstance(a.value, list) else [a.value]
            for p in picked:
                # `counts.get(...) + 1`, not a bare increment: an option renamed after
                # somebody answered leaves a stored string that is no longer in `options`,
                # and dropping it would silently shrink the total below `answered`.
                counts[str(p)] = counts.get(str(p), 0) + 1
        total = sum(counts.values())
        summary["options"] = [
            {
                "text": text,
                "count": n,
                # Share of PICKS, not of respondents — on a checkbox question one person can
                # pick three boxes, so shares of respondents would sum past 100%.
                "percent": round(100.0 * n / total, 1) if total else None,
            }
            for text, n in counts.items()
        ]
        return summary

    if question.question_type in SurveyQuestion.NUMERIC_TYPES:
        scores = [int(a.value) for a in given if isinstance(a.value, (int, float))]
        buckets = {n: 0 for n in range(int(question.scale_min), int(question.scale_max) + 1)}
        for sc in scores:
            buckets[sc] = buckets.get(sc, 0) + 1
        threshold = question.follow_up_threshold
        summary.update({
            "average": round(sum(scores) / len(scores), 2) if scores else None,
            "scale_min": question.scale_min,
            "scale_max": question.scale_max,
            "scale_low_label": question.scale_low_label,
            "scale_high_label": question.scale_high_label,
            "distribution": [{"score": k, "count": v} for k, v in sorted(buckets.items())],
            # How many landed under the author's own bar. The one number the school asked
            # this question to produce, so it is computed here rather than left to a reader
            # to add up the columns for.
            "below_threshold": (
                sum(1 for sc in scores if sc < int(threshold)) if threshold is not None else None
            ),
            "threshold": threshold,
        })
        return summary

    summary["texts"] = [str(a.value) for a in given if str(a.value).strip()]
    return summary


def survey_results(survey: Survey) -> dict:
    """Per-question summaries plus the individual responses, in one read.

    Both halves come off the same prefetched rows: the console shows the summary first and
    the individual replies underneath, and fetching them separately would let the two
    disagree while an answer landed between the requests.
    """
    responses = list(
        survey.responses.filter(status=SurveyResponse.STATUS_SUBMITTED)
        .select_related("student")
        .prefetch_related("answers__question")
    )
    by_question: dict[int, list] = {}
    for response in responses:
        for answer in response.answers.all():
            by_question.setdefault(answer.question_id, []).append(answer)

    questions = list(survey.questions.all())

    # How many respondents were never SHOWN each question. Recomputed per reply from that
    # reply's own answers, in question order — the same one-pass evaluation the submit path
    # does, and for the same reason it is safe: a condition only ever points backwards.
    not_asked = {q.id: 0 for q in questions}
    for response in responses:
        values = {a.question_id: a.value for a in response.answers.all()}
        seen: dict[int, object] = {}
        for q in questions:
            if not q.is_visible_given(seen):
                not_asked[q.id] += 1
                seen[q.id] = None
                continue
            seen[q.id] = values.get(q.id)

    return {
        "responses": responses,
        "summaries": [
            _summarise_question(q, by_question.get(q.id, []), not_asked.get(q.id, 0))
            for q in questions
        ],
    }
