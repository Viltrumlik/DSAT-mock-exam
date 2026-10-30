"""Copy everything lc-up's External API returns into ``models_archive`` — read-only, every night.

The owner (2026-10-30): the centre is leaving lc-up, so all of its data must be in our database first.
The sync (``sync.py``) keeps only what it acts on; this keeps lc-up's rows themselves, with history.

A run, in order:

1. The lists, whole: filials, courses, payment methods, absence reasons, teachers and groups (deleted
   ones too), students.
2. Every archived group's members, those who left too.
3. Attendance (deleted marks too) and payments, by date window — lc-up serves at most 92 days at a
   time. The last ``NIGHTLY_DAYS`` are read every night, so marks and payments edited or deleted later
   are caught; older windows, from ``LCUP_ARCHIVE_SINCE``, are read until each is done once.
4. Students the rows above name but the student list does not (lc-up drops archived students from
   it), one by one.

A payload that changed becomes a new version; one that did not only moves ``last_seen_at``. A record
missing from a complete pull is marked gone — never from a failed or empty one: an empty answer where
we hold live records is an alert, not "everything left".

Nothing here writes to lc-up (only ``GET``), and nothing outside the archive tables is touched.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Count, Max, Min, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date

from . import conf
from .client import LcupError
from .models_archive import ArchiveEntity as E
from .models_archive import LcupArchiveMark, LcupArchiveRecord, LcupArchiveRun, LcupArchiveVersion

logger = logging.getLogger(__name__)

API = "/api/external/v1"
#: lc-up's limit is 92 days a request; 90 leaves room for however it counts the ends.
WINDOW_DAYS = 90
#: Re-read every night: lc-up's own edits and deletions of recent marks and payments land in this span.
NIGHTLY_DAYS = 90
#: Unlisted students fetched one by one per run; the rest wait for the next night.
MAX_STUDENT_LOOKUPS = 300
BATCH = 500

#: (entity, path, params, paged)
LISTS = (
    (E.FILIAL, f"{API}/filials", None, False),
    (E.COURSE, f"{API}/courses", None, False),
    (E.PAYMENT_METHOD, f"{API}/payment-methods", None, False),
    (E.ABSENCE_REASON, f"{API}/attendance/reasons", None, False),
    (E.TEACHER, f"{API}/teachers", {"include_deleted": "true"}, True),
    (E.GROUP, f"{API}/groups", {"include_deleted": "true"}, True),
    (E.STUDENT, f"{API}/students", None, True),
)
WINDOWED = (
    (E.ATTENDANCE, f"{API}/attendance", {"include_deleted": "true"}),
    (E.PAYMENT, f"{API}/payments", None),
)


def payload_hash(payload) -> str:
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _chunks(items: list, size: int = BATCH):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _day(value) -> date | None:
    try:
        return parse_date(str(value or "")[:10])
    except ValueError:
        return None


def windows(since: date, until: date) -> list[tuple[date, date]]:
    """``since`` .. ``until`` in ``WINDOW_DAYS`` spans anchored on ``since``, so a window's ends are the
    same every night and "done" can be remembered per window. The last one may be cut short by ``until``."""
    out, start = [], since
    while start <= until:
        end = start + timedelta(days=WINDOW_DAYS - 1)
        out.append((start, min(end, until)))
        start = end + timedelta(days=1)
    return out


def _window_key(entity: str, start: date) -> str:
    """A window is named by its start alone: the same window, cut short one night, is the same window."""
    return f"window:{entity}:{start.isoformat()}"


def _missing_key(lcup_id) -> str:
    return f"missing:student:{lcup_id}"


def _nightly_start(today: date) -> date:
    return today - timedelta(days=NIGHTLY_DAYS - 1)


def backfill_windows(since: date, today: date) -> list[tuple[date, date]]:
    """The windows before the nightly span. One is done for good only once its whole span lies before the
    nightly span; until then its tail is read again each night."""
    nightly_start = _nightly_start(today)
    return windows(since, nightly_start - timedelta(days=1)) if since < nightly_start else []


def _complete(start: date, today: date) -> bool:
    return start + timedelta(days=WINDOW_DAYS - 1) < _nightly_start(today)


@dataclass
class Archiver:
    client: object
    now: object = field(default_factory=timezone.now)
    today: date = field(default_factory=timezone.localdate)
    counts: dict = field(default_factory=dict)
    errors: list = field(default_factory=list)
    alerts: list = field(default_factory=list)
    #: The student ids on tonight's lc-up list; None until (or unless) that pull succeeds.
    listed_students: set | None = None

    # ── bookkeeping ───────────────────────────────────────────────────────

    def _count(self, entity: str) -> dict:
        return self.counts.setdefault(entity, {"seen": 0, "new": 0, "changed": 0, "gone": 0, "back": 0})

    def _bump(self, entity: str, key: str, by: int = 1) -> None:
        count = self._count(entity)
        count[key] = count.get(key, 0) + by

    def _fail(self, where: str, exc: Exception) -> None:
        self.errors.append(f"{where}: {type(exc).__name__}: {exc}"[:300])

    # ── storing ───────────────────────────────────────────────────────────

    def store(self, entity: str, items: list[tuple[str, dict, date | None]]) -> set[str]:
        """Upsert ``(lcup_id, payload, day)`` rows of one entity; the ids seen come back."""
        latest = {key: (payload, day) for key, payload, day in items}  # a row repeated across pages: once
        self._bump(entity, "seen", len(latest))
        existing = {}
        for keys in _chunks(list(latest)):
            for rec in LcupArchiveRecord.objects.filter(entity=entity, lcup_id__in=keys).only(
                "id", "lcup_id", "payload_hash", "gone_at", "versions_count", "day"
            ):
                existing[rec.lcup_id] = rec

        fresh, changed, versions, seen_again, returned = [], [], [], [], []
        for key, (payload, day) in latest.items():
            digest = payload_hash(payload)
            rec = existing.get(key)
            if rec is None:
                fresh.append(LcupArchiveRecord(
                    entity=entity, lcup_id=key, day=day, payload=payload, payload_hash=digest,
                    first_seen_at=self.now, last_seen_at=self.now,
                ))
                continue
            if rec.gone_at is not None:
                self._bump(entity, "back")
            if rec.payload_hash == digest:
                (returned if rec.gone_at is not None else seen_again).append(rec.pk)
                continue
            rec.payload, rec.payload_hash, rec.day = payload, digest, day
            rec.versions_count += 1
            rec.last_seen_at, rec.gone_at = self.now, None
            changed.append(rec)
            versions.append(LcupArchiveVersion(record=rec, payload=payload, payload_hash=digest, seen_at=self.now))

        created = LcupArchiveRecord.objects.bulk_create(fresh, batch_size=BATCH)
        versions += [
            LcupArchiveVersion(record=rec, payload=rec.payload, payload_hash=rec.payload_hash, seen_at=self.now)
            for rec in created
        ]
        LcupArchiveRecord.objects.bulk_update(
            changed, ["payload", "payload_hash", "day", "versions_count", "last_seen_at", "gone_at"], batch_size=BATCH
        )
        LcupArchiveVersion.objects.bulk_create(versions, batch_size=BATCH)
        for pks in _chunks(seen_again):
            LcupArchiveRecord.objects.filter(pk__in=pks).update(last_seen_at=self.now)
        for pks in _chunks(returned):
            LcupArchiveRecord.objects.filter(pk__in=pks).update(last_seen_at=self.now, gone_at=None)
        self._bump(entity, "new", len(created))
        self._bump(entity, "changed", len(changed))
        return set(latest)

    def mark_gone(self, entity: str, seen: set[str], scope, *, where: str) -> bool:
        """Everything live in ``scope`` that a complete pull did not return. An empty pull where live
        records exist marks nothing: lc-up answering "none" is far likelier a fault than an exodus. False
        then — the pull is not to be trusted as complete."""
        live = list(scope.filter(gone_at__isnull=True).values_list("pk", "lcup_id"))
        if not seen and live:
            self.alerts.append(f"{where}: lc-up returned nothing where {len(live)} are archived; none marked gone")
            return False
        gone = [pk for pk, key in live if key not in seen]
        for pks in _chunks(gone):
            LcupArchiveRecord.objects.filter(pk__in=pks).update(gone_at=self.now)
        self._bump(entity, "gone", len(gone))
        return True

    # ── pulling ───────────────────────────────────────────────────────────

    def pull_lists(self) -> None:
        for entity, path, params, paged in LISTS:
            try:
                rows = self.client.fetch_all(path, params) if paged else (self.client.get(path, params).get("data") or [])
            except LcupError as exc:
                self._fail(entity, exc)
                continue
            items = [(str(r["id"]), r, None) for r in rows if isinstance(r, dict) and r.get("id") is not None]
            seen = self.store(entity, items)
            scope = LcupArchiveRecord.objects.filter(entity=entity)
            if entity == E.STUDENT:
                # Students fetched one by one (stage 4) are off the list by definition: only listed ones count here.
                self.listed_students = seen
                scope = scope.exclude(lcup_id__in=self._unlisted_ids())
            self.mark_gone(entity, seen, scope, where=entity)

    def _unlisted_ids(self) -> list[str]:
        return [k.rsplit(":", 1)[1] for k in LcupArchiveMark.objects.filter(key__startswith="unlisted:student:")
                .values_list("key", flat=True)]

    def pull_members(self) -> None:
        groups = LcupArchiveRecord.objects.filter(entity=E.GROUP).order_by("lcup_id").values_list("lcup_id", "payload")
        for group_id, payload in groups:
            try:
                rows = self.client.get(f"{API}/groups/{group_id}/students", {"include_left": "true"}).get("data") or []
            except LcupError as exc:
                if (payload or {}).get("deleted_at"):
                    # A deleted group's members may simply not be served any more; what we hold stays.
                    self._bump(E.GROUP_MEMBER, "deleted_group_unavailable")
                else:
                    self._fail(f"{E.GROUP_MEMBER} of group {group_id}", exc)
                continue
            items = [
                (f"{group_id}:{r['student_id']}", r, None)
                for r in rows if isinstance(r, dict) and r.get("student_id") is not None
            ]
            seen = self.store(E.GROUP_MEMBER, items)
            scope = LcupArchiveRecord.objects.filter(entity=E.GROUP_MEMBER, lcup_id__startswith=f"{group_id}:")
            self.mark_gone(E.GROUP_MEMBER, seen, scope, where=f"members of group {group_id}")

    def pull_window(self, entity: str, path: str, params: dict | None, start: date, end: date) -> bool:
        try:
            rows = self.client.fetch_all(path, dict(params or {}, **{"from": start.isoformat(), "to": end.isoformat()}))
        except LcupError as exc:
            self._fail(f"{entity} {start}..{end}", exc)
            return False
        items = [
            (str(r["id"]), r, _day(r.get("date")))
            for r in rows if isinstance(r, dict) and r.get("id") is not None
        ]
        seen = self.store(entity, items)
        scope = LcupArchiveRecord.objects.filter(entity=entity, day__range=(start, end))
        # An empty answer over records we hold is suspect: the window stays due and is read again next run.
        return self.mark_gone(entity, seen, scope, where=f"{entity} {start}..{end}")

    def pull_windows(self) -> None:
        since = conf.archive_since()
        for entity, path, params in WINDOWED:
            done = set(LcupArchiveMark.objects.filter(key__startswith=f"window:{entity}:").values_list("key", flat=True))
            for start, end in backfill_windows(since, self.today):
                key = _window_key(entity, start)
                if key in done:
                    continue
                if self.pull_window(entity, path, params, start, end) and _complete(start, self.today):
                    LcupArchiveMark.objects.get_or_create(key=key, defaults={"done_at": self.now})
            self.pull_window(entity, path, params, max(_nightly_start(self.today), since), self.today)

    def pull_unlisted_students(self) -> None:
        listed = self.listed_students
        if listed is None:  # the list itself failed tonight (an error already says so): "unlisted" is unknowable
            return
        referenced = set()
        for entity in (E.GROUP_MEMBER, E.ATTENDANCE, E.PAYMENT):
            referenced |= {
                str(v) for v in LcupArchiveRecord.objects.filter(entity=entity)
                .values_list("payload__student_id", flat=True).distinct() if v is not None
            }
        unlisted = set(self._unlisted_ids())
        back = unlisted & listed
        if back:  # on lc-up's list again: the list keeps them from now on
            LcupArchiveMark.objects.filter(key__in=[f"unlisted:student:{k}" for k in back]).delete()
        missing = {k.rsplit(":", 1)[1] for k in LcupArchiveMark.objects.filter(key__startswith="missing:student:")
                   .values_list("key", flat=True)}
        # Every night: a student lc-up still names but no longer lists, fetched one by one and refreshed so,
        # within one per-run budget.
        todo = sorted((referenced | unlisted) - listed - missing, key=lambda v: (len(v), v))
        self._bump(E.STUDENT, "unlisted", len(todo))
        for lcup_id in todo[:MAX_STUDENT_LOOKUPS]:
            try:
                body = self.client.get(f"{API}/students/{lcup_id}")
            except LcupError as exc:
                if "answered 404" in str(exc):
                    LcupArchiveMark.objects.get_or_create(key=_missing_key(lcup_id), defaults={"done_at": self.now})
                    LcupArchiveRecord.objects.filter(entity=E.STUDENT, lcup_id=lcup_id, gone_at__isnull=True).update(
                        gone_at=self.now
                    )
                    self._bump(E.STUDENT, "unlisted_missing")
                else:
                    self._fail(f"student {lcup_id}", exc)
                continue
            row = body.get("data") if isinstance(body, dict) else None
            if isinstance(row, dict) and row.get("id") is not None:
                self.store(E.STUDENT, [(str(row["id"]), row, None)])
                LcupArchiveMark.objects.get_or_create(key=f"unlisted:student:{row['id']}", defaults={"done_at": self.now})
        if len(todo) > MAX_STUDENT_LOOKUPS:
            self.alerts.append(f"{len(todo) - MAX_STUDENT_LOOKUPS} unlisted students left for the next run")

    def run(self) -> None:
        for stage in (self.pull_lists, self.pull_members, self.pull_windows, self.pull_unlisted_students):
            stage()


def run_archive(client, *, dry_run: bool = False) -> LcupArchiveRun:
    """One full pass. A dry run does all of it inside a transaction that is rolled back, so its counts
    are exactly what a real run would write."""
    archiver = Archiver(client)
    run = LcupArchiveRun(dry_run=dry_run, started_at=archiver.now)
    try:
        with transaction.atomic():
            archiver.run()
            if dry_run:
                transaction.set_rollback(True)
    except Exception as exc:  # the run row must say what broke, whatever it was
        logger.exception("lc-up archive run failed")
        archiver._fail("run", exc)
    run.finished_at = timezone.now()
    run.counts, run.errors, run.alerts = archiver.counts, archiver.errors, archiver.alerts
    run.ok = not archiver.errors
    run.save()
    return run


def summary() -> dict:
    """What the archive holds, per entity, and how the backfill stands — for /ops/lcup and the command."""
    by_entity = {
        r["entity"]: r
        for r in LcupArchiveRecord.objects.values("entity").annotate(
            total=Count("id"),
            gone=Count("id", filter=Q(gone_at__isnull=False)),
            versions=Sum("versions_count"),
            first_day=Min("day"),
            last_day=Max("day"),
            last_seen=Max("last_seen_at"),
        ).order_by()
    }
    entities = []
    for value, label in E.choices:
        r = by_entity.get(value) or {}
        entities.append({
            "entity": value,
            "label": label,
            "total": r.get("total", 0),
            "live": r.get("total", 0) - r.get("gone", 0),
            "gone": r.get("gone", 0),
            "versions": r.get("versions") or 0,
            "first_day": r.get("first_day"),
            "last_day": r.get("last_day"),
            "last_seen_at": r.get("last_seen"),
        })
    today = timezone.localdate()
    since = conf.archive_since()
    due = [start for start, _end in backfill_windows(since, today) if _complete(start, today)]
    done = set(LcupArchiveMark.objects.filter(key__startswith="window:").values_list("key", flat=True))
    backfill = {
        entity: {"done": sum(_window_key(entity, start) in done for start in due), "total": len(due)}
        for entity, _path, _params in WINDOWED
    }
    return {
        "enabled": conf.archive_enabled(),
        "since": since,
        "entities": entities,
        "backfill": backfill,
        "runs": [run_row(r) for r in LcupArchiveRun.objects.all()[:10]],
    }


def run_row(run: LcupArchiveRun) -> dict:
    return {
        "id": run.pk,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "dry_run": run.dry_run,
        "ok": run.ok,
        "counts": run.counts,
        "errors": run.errors,
        "alerts": run.alerts,
    }
