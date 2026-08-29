"""The reading a student does before a session's homework.

Lives in ``classes`` rather than ``journals`` for the reason ``views_roadmap`` already gives:
``/api/journals/`` is host-guarded to the admin subdomain and gated to staff, so a student on
the main site can never reach it. The content is authored there and read here.

Two endpoints' worth of rules, both about the same boundary — **a student may read the
roadmap of a session their own classroom has been given, and nothing else.** The check is
the delivery row: it names a classroom, the classroom names its members, and a session with
no delivery row has not reached anybody.
"""

from __future__ import annotations

from django.core.exceptions import PermissionDenied

from journals.models import ClassroomLesson, RoadmapRead

from .models import ClassroomMembership


def _image_url(section, request=None):
    """Signed URL for a section's picture, or None.

    The ``ValueError`` guard is the house pattern: ``.url`` on an unset ImageField raises
    rather than returning None, and the R2 bucket is private so every URL is signed and
    expires within the hour.
    """
    image = getattr(section, "image", None)
    if not image:
        return None
    try:
        url = image.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request and url.startswith("/") else url


def _video_url(section, request=None):
    """The link if there is one, otherwise the signed URL of the uploaded file."""
    link = (section.video_url or "").strip()
    if link:
        return link
    video = getattr(section, "video_file", None)
    if not video:
        return None
    try:
        url = video.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request and url.startswith("/") else url


def delivery_for_student(delivery_id, student) -> ClassroomLesson:
    """The delivery row, if this student is entitled to read it. Raises otherwise.

    ``NON_REMOVED_STATUSES``, not ``STATUS_ACTIVE`` alone — the rule stated on
    ``ClassroomMembership`` and followed by every other query in this codebase that decides
    whether a user may see a classroom. An INVITED student can already see the assignment
    list, so withholding the reading that explains it would be the odd one out.
    """
    delivery = (
        ClassroomLesson.objects.filter(pk=delivery_id)
        .select_related("classroom", "journal_lesson", "assignment")
        .first()
    )
    if delivery is None:
        raise ClassroomLesson.DoesNotExist()
    is_member = ClassroomMembership.objects.filter(
        classroom_id=delivery.classroom_id,
        user=student,
        status__in=ClassroomMembership.NON_REMOVED_STATUSES,
    ).exists()
    if not is_member:
        raise PermissionDenied("You are not in that class.")
    return delivery


def read_payload(delivery: ClassroomLesson, student, request=None) -> dict:
    """The reading itself, plus what the student may do at the bottom of it.

    ``homework_assignment_id`` is the whole point of the page: the button under the last
    section opens the homework for THIS session. It is null until two things are true —
    the homework has actually been released to the class, and the student has confirmed
    they read this (when the author asked for that confirmation).

    Withheld here rather than merely hidden in the UI. A button the client decides not to
    draw is a button anybody can draw for themselves; the id simply is not sent.
    """
    session = delivery.journal_lesson
    roadmap = getattr(session, "roadmap", None) if session is not None else None
    sections = [s for s in (roadmap.sections.all() if roadmap else []) if s.is_filled]

    has_read = RoadmapRead.objects.filter(
        classroom_lesson=delivery, student=student
    ).exists()
    requires_confirmation = bool(roadmap.require_read_confirmation) if roadmap else False
    # A released homework whose Assignment has since been deleted leaves `homework_released_at`
    # set and `assignment_id` NULL (SET_NULL). Treat that as not released, rather than as a
    # dead button — the same reading `roadmap._own_level_lessons` takes.
    released = bool(delivery.homework_released_at and delivery.assignment_id)
    unlocked = has_read or not requires_confirmation

    # Spelled out rather than chained: `A if x else B or C` is correct here but reads as
    # though the fallback might apply to A, and a reader should not have to work out that
    # `if/else` binds looser than `or`.
    if roadmap is not None:
        title = roadmap.display_title
    else:
        title = ((session.title or "").strip() if session else "") or (
            f"Lesson {delivery.lesson_number}"
        )

    return {
        "delivery_id": delivery.id,
        "classroom_id": delivery.classroom_id,
        "lesson_number": delivery.lesson_number,
        "title": title,
        "summary": roadmap.summary if roadmap else "",
        "estimated_minutes": roadmap.estimated_minutes if roadmap else 0,
        "require_read_confirmation": requires_confirmation,
        "read": has_read,
        "homework_released": released,
        "homework_assignment_id": delivery.assignment_id if (released and unlocked) else None,
        "sections": [
            {
                "id": s.id,
                "kind": s.kind,
                "heading": s.heading,
                "body": s.body,
                "caption": s.caption,
                "image_url": _image_url(s, request) if s.kind == s.KIND_IMAGE else None,
                "video_url": _video_url(s, request) if s.kind == s.KIND_VIDEO else None,
            }
            for s in sections
        ],
    }


def mark_read(delivery: ClassroomLesson, student) -> bool:
    """Record that this student has read it. Returns whether the row was newly created.

    ``get_or_create`` on the unique pair, so pressing the button twice — or twice at once
    from two tabs — is one row and not an IntegrityError. There is deliberately no un-read:
    a student who confirms and then scrolls back up has still read it, and the homework
    button must not vanish under them.
    """
    _, created = RoadmapRead.objects.get_or_create(
        classroom_lesson=delivery, student=student
    )
    return created
