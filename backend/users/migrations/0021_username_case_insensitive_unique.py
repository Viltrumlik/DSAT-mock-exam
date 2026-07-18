"""Make ``username`` unique case-insensitively.

``username`` was already declared unique, but Postgres indexes it case-sensitively
while every lookup in the codebase uses ``__iexact``. Production had six pairs that
differed only in case (``asilbek`` / ``Asilbek`` etc.). For those, ``backends.py``
raised ``MultipleObjectsReturned`` and the old fallback password-checked whichever row
had the lower id — so the newer of each pair could not log in by username at all, with
no error explaining why.

The data step below resolves the collisions before the constraint is added, otherwise
``AddConstraint`` fails to apply. It keeps the **older** account's username untouched
and appends the smallest free numeric suffix to the newer one (``asilbek`` ->
``asilbek2``). Those users can pick a different username later; the alternative —
blanking it — would push them into the "incomplete profile" cohort for no reason.
"""

import django.db.models.functions.text
from django.db import migrations, models
from django.db.models import Count, Q
from django.db.models.functions import Lower

MAX_LENGTH = 30


def _free_username(User, base, taken_lower):
    """Smallest ``base<n>`` (n >= 2) not present in the DB or in ``taken_lower``."""
    i = 1
    while True:
        i += 1
        suffix = str(i)
        candidate = (base[: max(1, MAX_LENGTH - len(suffix))] + suffix)[:MAX_LENGTH]
        if candidate.lower() in taken_lower:
            continue
        if User.objects.filter(username__iexact=candidate).exists():
            continue
        return candidate


def resolve_username_collisions(apps, schema_editor):
    User = apps.get_model("users", "User")
    colliding = (
        User.objects.exclude(Q(username__isnull=True) | Q(username__exact=""))
        .annotate(lu=Lower("username"))
        .values("lu")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
        .values_list("lu", flat=True)
    )
    # Reserve names handed out during this run so two groups cannot claim the same one.
    taken_lower = set()
    for lu in list(colliding):
        rows = list(User.objects.filter(username__iexact=lu).order_by("id"))
        # rows[0] is the oldest account and keeps its username.
        for row in rows[1:]:
            new_username = _free_username(User, row.username, taken_lower)
            taken_lower.add(new_username.lower())
            User.objects.filter(pk=row.pk).update(username=new_username)


def noop_reverse(apps, schema_editor):
    """Renames are not reversed: we cannot know which rows this migration touched."""


class Migration(migrations.Migration):

    dependencies = [
        ('access', '0011_resourceaccessgrant_accessgrantevent_and_more'),
        ('auth', '0012_alter_user_first_name_max_length'),
        ('users', '0020_reactivate_all_users'),
    ]

    operations = [
        migrations.RunPython(resolve_username_collisions, noop_reverse),
        migrations.AddConstraint(
            model_name='user',
            constraint=models.UniqueConstraint(django.db.models.functions.text.Lower('username'), condition=models.Q(models.Q(('username', None), _negated=True), models.Q(('username', ''), _negated=True)), name='users_username_ci_unique'),
        ),
    ]
