"""Repair journal midterm FKs that 0002 left pointing at the wrong row.

``JournalLesson.midterm_exam`` originally referenced ``exams.MockExam``. Migration 0002
retargeted it at ``midterms.Midterm`` with a bare ``AlterField``, which keeps the stored
integer untouched. Midterm mirrors are keyed by ``legacy_mock_exam_id``, NOT by matching
primary keys, so any row that already had a midterm selected came out of 0002 pointing at
an unrelated Midterm — or at nothing.

0002 is already applied everywhere it matters, so it cannot be edited into correctness:
Django will never re-run it. This repairs the result instead.

Safe to run repeatedly and on an empty table (both are no-ops). Fresh installs are
unaffected — 0002 alters an empty table there, so nothing was ever mis-pointed.
"""

from django.db import migrations


def repair(apps, schema_editor):
    JournalLesson = apps.get_model("journals", "JournalLesson")
    Midterm = apps.get_model("midterms", "Midterm")

    rows = list(JournalLesson.objects.filter(midterm_exam_id__isnull=False))
    if not rows:
        return

    legacy_ids = {r.midterm_exam_id for r in rows}
    # The mirror that was created FROM each legacy MockExam is the correct target.
    by_legacy = {
        m.legacy_mock_exam_id: m.id
        for m in Midterm.objects.filter(legacy_mock_exam_id__in=legacy_ids)
        if m.legacy_mock_exam_id
    }
    real_ids = set(Midterm.objects.filter(id__in=legacy_ids).values_list("id", flat=True))

    for row in rows:
        stored = row.midterm_exam_id
        target = by_legacy.get(stored)
        if target is not None and target != stored:
            # The stored value is a legacy MockExam id with a known mirror — remap it.
            row.midterm_exam_id = target
            row.save(update_fields=["midterm_exam"])
        elif target is None and stored not in real_ids:
            # Points at no Midterm at all and no mirror explains it: clear rather than
            # leave a session bound to whatever row happens to occupy that id later.
            row.midterm_exam_id = None
            row.save(update_fields=["midterm_exam"])


class Migration(migrations.Migration):
    dependencies = [
        ("journals", "0006_alter_classroomlesson_journal_lesson"),
        # Latest, not 0001: the historical model must already carry
        # legacy_mock_exam_id, which is what the remap keys on.
        ("midterms", "0004_midterm_level"),
    ]

    # Reversing would have to guess which ids were legacy; the forward pass is a repair,
    # so there is nothing meaningful to undo.
    operations = [migrations.RunPython(repair, migrations.RunPython.noop)]
