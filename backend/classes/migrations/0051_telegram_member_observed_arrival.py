"""Rule 3: the bot only acts on people it watched arrive.

No backfill, and null is the whole point of that. Every row this migration finds becomes
"never seen to arrive", which means nothing will ever remove those people — the safe
direction to be wrong in, and the only honest one: a row written before this field existed
cannot say whether it came from a ``chat_member`` update or from a ``getChatMember`` probe,
and guessing "watched" would hand the bot people it may not have any right to touch.

The cost is a handful of rows on staging that go back to being left alone. They rejoin the
managed set the moment they next leave and come back, which is the same door everybody else
uses.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('classes', '0050_classroomtelegramevent_classroomtelegrammember'),
    ]

    operations = [
        migrations.AddField(
            model_name='classroomtelegrammember',
            name='observed_arrival_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
