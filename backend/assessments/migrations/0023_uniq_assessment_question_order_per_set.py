from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Add UNIQUE(assessment_set, order) in its OWN transaction.

    Split out from 0022 (which normalizes existing orders to dense 0..n-1): on
    PostgreSQL, `ALTER TABLE ... ADD CONSTRAINT` cannot run in the same
    transaction as the preceding RunPython bulk updates — it fails with "cannot
    ALTER TABLE ... because it has pending trigger events". Running it as a
    separate migration gives it a clean transaction where the table is quiescent.
    0022 has already made every set's orders unique, so the constraint validates.
    """

    dependencies = [
        ('assessments', '0022_remove_assessmentquestion_assessment__assessm_a256a3_idx_and_more'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='assessmentquestion',
            constraint=models.UniqueConstraint(
                fields=('assessment_set', 'order'),
                name='uniq_assessment_question_order_per_set',
            ),
        ),
    ]
