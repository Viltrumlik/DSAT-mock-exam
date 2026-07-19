"""Blank out the names the Telegram upsert used to fabricate.

Until the fix in this branch, a Telegram signup with no usable display name was given
a literal ``"Telegram"`` first name, and a one-word name was copied into the last name.
A production survey found the damage: 12 accounts named ``"Telegram"``, 43 rows where
first and last name are identical (38 of them Telegram-origin), and 1 named ``"User"``.

Those rows read as *complete* to any emptiness check, so the profile-completion prompt
would never fire for exactly the people who need it. Clearing them once lets the live
predicate in ``users.profile_completeness`` stay purely structural — which matters
because a heuristic there ("the last name must differ from the first") can never be
satisfied by someone genuinely named "Aziz Aziz", trapping them permanently.

Only the first name is cleared when it is the placeholder; when first and last merely
match, the first name is kept — it is almost always the person's real given name, and
they only need to supply the surname.
"""

from django.db import migrations
from django.db.models import Q
from django.db.models.functions import Lower

PLACEHOLDER_FIRST = "Telegram"
PLACEHOLDER_LAST = "User"


def clear_fabricated_names(apps, schema_editor):
    User = apps.get_model("users", "User")

    # ORDER IS LOAD-BEARING. The duplicate-surname pass has to run while both fields
    # still hold their original values: clearing the first name first would leave
    # "Telegram Telegram" as ("", "Telegram"), the two would no longer match, and the
    # fabricated surname would survive.
    dupes = list(
        User.objects.exclude(Q(first_name__isnull=True) | Q(first_name__exact=""))
        .annotate(lf=Lower("first_name"))
        .filter(lf__exact=Lower("last_name"))
        .values_list("pk", flat=True)
    )
    User.objects.filter(pk__in=dupes).update(last_name="")

    # The literal "User" surname the old code fell back to (rare — the branch was
    # almost unreachable, since a missing surname was filled from the first name).
    User.objects.filter(last_name__iexact=PLACEHOLDER_LAST).update(last_name="")

    # "Telegram" as a given name is never real.
    User.objects.filter(first_name__iexact=PLACEHOLDER_FIRST).update(first_name="")


def noop_reverse(apps, schema_editor):
    """Not reversible: the fabricated values are indistinguishable from real ones once
    restored, and re-inserting them would re-hide the accounts from the prompt."""


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0023_email_claim"),
    ]

    operations = [
        migrations.RunPython(clear_fabricated_names, noop_reverse),
    ]
