"""Word mastery moves from a streak to the four games.

A word used to be mastered by three correct answers in a row, with a *Learning* bucket in
between. It is now mastered by being answered correctly in every study mode — the per-word
form of the rule that masters the set itself.

Two questions the schema change alone cannot answer, settled here:

* **What happens to a word a student had already mastered?** It stays mastered. The old
  streak did not record WHICH games proved the word, so there is no way to re-derive the
  new column honestly — and demoting thousands of already-earned words to "not yet" to
  satisfy a bookkeeping change would take away work students actually did. They are
  grandfathered with all four games credited.
* **And a word that was mid-streak (``learning``)?** It becomes ``new``. That bucket no
  longer exists, and a partial streak proves nothing under the new rule; the word is one
  clean game away from counting again, which is where it honestly stands.
"""

from django.db import migrations, models


def carry_forward_mastery(apps, schema_editor):
    VocabWordProgress = apps.get_model("vocabulary", "VocabWordProgress")
    all_modes = ["flashcard", "matching", "speed", "test"]
    VocabWordProgress.objects.filter(status="mastered").update(correct_modes=all_modes)
    # Everything that is not mastered is `new` now — `learning` is gone as a value, so a
    # row left holding it would render as an unknown status on every screen.
    VocabWordProgress.objects.exclude(status="mastered").update(status="new", correct_modes=[])


def back_to_streaks(apps, schema_editor):
    """Reverse: mastery survives, the streak restarts.

    The streak column comes back at 0 for everyone rather than guessing a number that was
    never stored. A mastered word keeps its status, so the reverse costs a student nothing.
    """
    VocabWordProgress = apps.get_model("vocabulary", "VocabWordProgress")
    VocabWordProgress.objects.exclude(status="mastered").update(status="new")


class Migration(migrations.Migration):

    dependencies = [
        ('vocabulary', '0006_vocab_session_coverage'),
    ]

    operations = [
        migrations.AddField(
            model_name='vocabwordprogress',
            name='correct_modes',
            field=models.JSONField(blank=True, default=list),
        ),
        # Before the AlterField: the rows still hold `learning` at this point, and the data
        # step is what clears it.
        migrations.RunPython(carry_forward_mastery, back_to_streaks),
        migrations.AlterField(
            model_name='vocabwordprogress',
            name='status',
            field=models.CharField(choices=[('new', 'New'), ('mastered', 'Mastered')], db_index=True, default='new', max_length=16),
        ),
        migrations.RemoveField(
            model_name='vocabwordprogress',
            name='streak',
        ),
    ]
