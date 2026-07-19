"""``User.email`` becomes nullable, and the invented placeholder addresses go away.

Two kinds of fake address existed only because the column could not be empty:

* ``tg{id}@telegram.mastersat.local`` — minted for Telegram signups, which never supply
  an address. 72 of 387 production rows carry one.
* the ``released-…`` placeholder, for an account whose address moved to whoever proved
  control of it.

Both said "this person has no address" in a way that every other part of the system had
to be taught to decode. NULL says it directly, so the data step below converts the
Telegram ones and the helpers that produced them are deleted.

NULL is safe here where ``""`` would not be: Postgres treats NULLs as distinct under
``UNIQUE(lower(email))``, so any number of address-less accounts coexist, while two
empty strings collide. That is what the accompanying CheckConstraint enforces, and why
``User.clean`` has to put the NULL back after ``AbstractBaseUser.clean`` rewrites it.

Accounts left without an address sign in with their username — verified against
production before shipping: 385 of 387 rows have one, and the two that do not are
restore fixtures. The release path refuses to take an address off an account with no
username, so this cannot strand anyone.
"""

from django.db import migrations, models

SYNTHETIC_SUFFIX = "@telegram.mastersat.local"


def drop_placeholder_addresses(apps, schema_editor):
    User = apps.get_model("users", "User")

    # Telegram login now resolves by telegram_id alone, so recover it from the address
    # first for any row the 0008 backfill missed. Production has one such account; drop
    # its address without this and it can never be reached by Telegram again — the
    # address was its only remaining link.
    for pk, email in User.objects.filter(
        email__iendswith=SYNTHETIC_SUFFIX, telegram_id__isnull=True
    ).values_list("pk", "email"):
        digits = str(email or "").split("@", 1)[0][2:]
        if digits.isdigit() and not User.objects.filter(telegram_id=int(digits)).exists():
            User.objects.filter(pk=pk).update(telegram_id=int(digits))

    User.objects.filter(email__iendswith=SYNTHETIC_SUFFIX).update(email=None)
    User.objects.filter(email__iendswith="@released.mastersat.invalid").update(email=None)
    # Nothing should hold "" — create_user rejects it — but .update() bypasses that, and
    # the CheckConstraint added below would fail to apply if one existed.
    User.objects.filter(email__exact="").update(email=None)


def noop_reverse(apps, schema_editor):
    """Not reversible: the synthetic address is derivable from telegram_id, but a NULL
    that was always NULL is indistinguishable from one this migration created."""


class Migration(migrations.Migration):

    dependencies = [
        ('access', '0011_resourceaccessgrant_accessgrantevent_and_more'),
        ('auth', '0012_alter_user_first_name_max_length'),
        ('users', '0024_clear_fabricated_names'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='email',
            field=models.EmailField(blank=True, db_index=True, help_text='NULL means the user has not supplied an address yet (a Telegram signup) or lost it to someone who proved control of it. Those accounts sign in with their username, which is why releasing one is refused when it has none.', max_length=254, null=True, unique=True),
        ),
        # Must sit between the two: the column has to be nullable before we can write
        # NULLs, and no "" may survive into the CheckConstraint.
        migrations.RunPython(drop_placeholder_addresses, noop_reverse),
        migrations.AddConstraint(
            model_name='user',
            constraint=models.CheckConstraint(condition=models.Q(('email', ''), _negated=True), name='users_email_not_blank'),
        ),
    ]
