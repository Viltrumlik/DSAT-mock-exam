"""Email-verification state, plus a case-insensitive unique index on ``email``.

There is deliberately **no backfill**: every existing row starts unverified.

Two reasons. First, signup provenance is not recorded anywhere — there is no
``google_sub`` column and nothing stores how an account was created — so for an
existing address there is no way to tell, retroactively, whether it was ever real.
Second, marking the 89 Telegram-linked rows as verified would be actively wrong: 72
of them hold a synthetic ``tg{id}@telegram.mastersat.local`` address that cannot
receive mail at all, and those users are precisely the ones we need to prompt for a
real address.

So on day one the badge reads "unverified" for all 387 accounts. That is the honest
answer; ``last_login`` and attempt counts carry the duplicate-triage workflow until
real verifications accumulate.

The ``Lower("email")`` constraint was checked against production first — 0
case-colliding groups — so ``AddConstraint`` applies without a data step. Compare
migration 0021, where six username collisions had to be resolved before the
equivalent constraint could be added.
"""

import django.db.models.functions.text
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('access', '0011_resourceaccessgrant_accessgrantevent_and_more'),
        ('auth', '0012_alter_user_first_name_max_length'),
        ('users', '0021_username_case_insensitive_unique'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='email_released_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='email_verified',
            field=models.BooleanField(db_index=True, default=False, help_text='True only once the user proved control of this address by entering a mailed code. Never backfilled: signup provenance is not recorded, so for existing rows there is no way to tell whether the address was ever real.'),
        ),
        migrations.AddField(
            model_name='user',
            name='email_verified_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='previous_email',
            field=models.EmailField(blank=True, db_index=True, max_length=254, null=True),
        ),
        migrations.AddConstraint(
            model_name='user',
            constraint=models.UniqueConstraint(django.db.models.functions.text.Lower('email'), name='users_email_ci_unique'),
        ),
    ]
