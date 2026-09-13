"""The learning center's foundation math topics — the list a foundation math midterm is
tagged from.

Verbatim from the school's list (2026-09-12), in its order and in the school's own words:
the school writes the foundation syllabus in Uzbek, so these names are Uzbek where the
junior list (0007) is English. They are what a teacher reads in the builder's Topic picker
and what a student reads on the midterm error report, so they are not translated.

Lives in a data migration rather than a seed command so every environment — prod on the
next deploy included — has the same list without anyone remembering to run anything.
"""

from django.db import migrations
from django.utils.text import slugify

DOMAIN_CODE = "foundation-math"
DOMAIN_NAME = "Foundation Math"

FOUNDATION_MATH_TOPICS = [
    "Musbat va manfiy sonlar ustida amallar",
    "Oddiy kasrlar",
    "O'nli kasrlar/ O'nli va oddiy kasrlar ustida amallar",
    "Bir o'zgaruvchili chiziqli tenglamalar",
    "Daraja va uning xossalari/ Kvadrat ildiz",
    "Birhadlar. Ko'phadlar yig'indisi va ayrimasi",
    "Birhadning ko'phadga ko'paytmasi. Ko'phadlar ko'paytmasi",
    "Koordinatalar sistemasi. Distance",
    "Kvadrat, To'rtburchak, Uchburchak",
    "Aylana va doira",
    "Revision",
]


def add_topics(apps, schema_editor):
    BankDomain = apps.get_model("questionbank", "BankDomain")
    BankSkill = apps.get_model("questionbank", "BankSkill")
    # display_order 101 keeps it after the four SAT domains and after Junior Math (100) in
    # any "every domain" listing. The two lists are never offered together, so the order
    # between them only ever shows in the Django admin.
    domain, _ = BankDomain.objects.update_or_create(
        subject="MATH",
        code=DOMAIN_CODE,
        defaults={"name": DOMAIN_NAME, "level": "foundation", "display_order": 101},
    )
    for order, name in enumerate(FOUNDATION_MATH_TOPICS):
        BankSkill.objects.update_or_create(
            domain=domain,
            name=name,
            defaults={"code": slugify(name)[:64], "display_order": order},
        )


def remove_topics(apps, schema_editor):
    BankDomain = apps.get_model("questionbank", "BankDomain")
    BankSkill = apps.get_model("questionbank", "BankSkill")
    # exams.Question.skill and midterm results are SET_NULL (results keep their frozen
    # names); no bank question can hold a curriculum topic, so nothing PROTECTs these.
    BankSkill.objects.filter(domain__subject="MATH", domain__code=DOMAIN_CODE).delete()
    BankDomain.objects.filter(subject="MATH", code=DOMAIN_CODE).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("questionbank", "0007_junior_math_topics"),
    ]

    operations = [
        migrations.RunPython(add_topics, remove_topics),
    ]
