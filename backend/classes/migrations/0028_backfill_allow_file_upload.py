from django.db import migrations


def backfill_allow_file_upload(apps, schema_editor):
    """Preserve pre-change behavior: file/link/instructions-only homeworks (no
    auto-graded content) previously let students upload their work. Set
    allow_file_upload=True for those so existing file submissions keep working.
    Homeworks with auto-graded content stay False (upload was locked before);
    teachers can opt in per homework going forward."""
    Assignment = apps.get_model("classes", "Assignment")
    HomeworkAssignment = apps.get_model("assessments", "HomeworkAssignment")

    assessment_assignment_ids = set(
        HomeworkAssignment.objects.values_list("assignment_id", flat=True)
    )

    to_update = []
    for a in Assignment.objects.all().iterator():
        has_auto = bool(
            a.mock_exam_id
            or a.practice_test_id
            or a.practice_test_pack_id
            or a.practice_test_ids
            or a.practice_test_pack_ids
            or a.module_id
            or a.id in assessment_assignment_ids
        )
        if not has_auto:
            a.allow_file_upload = True
            to_update.append(a)

    Assignment.objects.bulk_update(to_update, ["allow_file_upload"], batch_size=500)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("classes", "0027_assignment_allow_file_upload"),
        ("assessments", "0025_remove_homeworkassignment_uniq_assessment_hw_class_assignment_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill_allow_file_upload, noop_reverse),
    ]
