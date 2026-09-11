"""The learning center's junior math topics — the list a junior math midterm is tagged from.

Verbatim from the school's list (2026-09-11), in its order. The list repeats its revision
lesson four times ("Takrorlash - Revision" twice, "Takrorlash" twice); a question can only
be tagged with it once, so it is one topic here. "Exponents and Their_Properties" is kept
without the stray underscore.

Lives in a data migration rather than a seed command so every environment — prod on the
next deploy included — has the same list without anyone remembering to run anything.
"""

from django.db import migrations
from django.utils.text import slugify

DOMAIN_CODE = "junior-math"
DOMAIN_NAME = "Junior Math"

JUNIOR_MATH_TOPICS = [
    "Exponents and Their Properties",
    "Polynomial by Monomial",
    "Square of Sum and Difference",
    "Difference of Squares",
    "Algebraic Fractions",
    "Systems of Linear Equations",
    "Linear System Solutions Guide",
    "Linear Functions Guide",
    "Takrorlash - Revision",
    "Linear Equations Systems",
    "Proportion",
    "Percent",
    "Inequalities",
    "Absolute Value",
    "Incomplete Quadratic Equations",
    "Quadratic Equations",
    "Factoring Viet",
    "Systems Quadratic",
    "Quadratic Functions",
    "Parametric Linear Equations",
    "Angles",
    "Triangle Angles",
    "Right Triangles",
    "Triangle Area",
    "Triangle Similarity",
    "Circles",
    "Volume and Surface Area",
]


def add_topics(apps, schema_editor):
    BankDomain = apps.get_model("questionbank", "BankDomain")
    BankSkill = apps.get_model("questionbank", "BankSkill")
    # display_order 100 keeps it after the four SAT domains in any "first domain" ordering.
    domain, _ = BankDomain.objects.update_or_create(
        subject="MATH",
        code=DOMAIN_CODE,
        defaults={"name": DOMAIN_NAME, "level": "junior", "display_order": 100},
    )
    for order, name in enumerate(JUNIOR_MATH_TOPICS):
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
        ("questionbank", "0006_bankdomain_level"),
    ]

    operations = [
        migrations.RunPython(add_topics, remove_topics),
    ]
