from django.db import migrations, models


def backfill_review_status(apps, schema_editor):
    """Sets that already have a published version are treated as approved;
    everything else starts as draft."""
    AssessmentSet = apps.get_model("assessments", "AssessmentSet")
    AssessmentSetVersion = apps.get_model("assessments", "AssessmentSetVersion")

    published_set_ids = set(
        AssessmentSetVersion.objects.values_list("assessment_set_id", flat=True).distinct()
    )
    if published_set_ids:
        AssessmentSet.objects.filter(pk__in=published_set_ids).update(review_status="approved")
    AssessmentSet.objects.exclude(pk__in=published_set_ids).update(review_status="draft")


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("assessments", "0028_alter_governanceevent_event_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="assessmentset",
            name="review_status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("needs_review", "Needs review"),
                    ("approved", "Approved"),
                ],
                db_index=True,
                default="draft",
                max_length=24,
            ),
        ),
        migrations.AlterField(
            model_name="governanceevent",
            name="event_type",
            field=models.CharField(
                choices=[
                    ("publish", "Published"),
                    ("publish_idempotent", "Publish (idempotent — identical content)"),
                    ("publish_validation_failed", "Publish validation failed"),
                    ("supersede", "Superseded by new version"),
                    ("set_delete", "Assessment set deleted"),
                    ("submit_for_review", "Submitted for review"),
                    ("approve", "Approved"),
                    ("send_back", "Sent back for changes"),
                    ("assignment_pin", "Assignment version pinned"),
                    ("attempt_snapshot_pin", "Attempt snapshot pinned"),
                    ("scoring_start", "Scoring started"),
                    ("scoring_complete", "Scoring completed"),
                    ("scoring_retry", "Scoring retried"),
                    ("scoring_failure", "Scoring failed"),
                    ("scoring_override", "Scoring overridden"),
                    ("integrity_failure", "Integrity failure detected"),
                    ("integrity_repair", "Integrity repair performed"),
                    ("fallback_path_used", "Live-read fallback path used (pre-snapshot attempt)"),
                ],
                db_index=True,
                max_length=64,
            ),
        ),
        migrations.RunPython(backfill_review_status, noop_reverse),
    ]
