"""The CRM's permission rows (plan 2026-11-12-crm-roles, PR 2).

Roles get their permissions from code (``access.services._role_permissions_map``), not from these rows. The rows
are what a per-person tick (``UserPermission``) points at, so each CRM codename needs one before the Staff page can
grant or remove it. New rows only: nothing existing changes. The list is written out here, not imported, so later
edits to ``access.constants`` cannot change what this migration did.
"""

from django.db import migrations

CRM_PERMISSIONS = (
    ("view_people", "View people", "Groups and their lessons, parents' contacts. No money."),
    ("edit_people", "Edit people", "A learner's details and parent contact."),
    ("view_money", "View money", "Balances, debtors, payments, the ledger."),
    ("take_payment", "Take payments", "Enter a payment or a refund."),
    ("void_payment", "Void payments", "Void an entered row; the reason stays on it."),
    ("adjust_balance", "Adjust balances", "Adjustment rows."),
    ("set_prices", "Set prices", "A group's price and a student's own price."),
    ("debt_freeze", "Debt-freeze exemptions", "Never freeze a student for debt, or freeze as usual again."),
    ("enroll", "Enrol students", "New student, add to a group, trial to paid, the trials list."),
    ("manage_seats", "Manage seats", "Freeze, return, move, leave, fix a date."),
    ("manage_groups", "Manage groups", "A class's teacher, details, archive, deletion and Telegram group."),
    ("send_sms", "Send SMS", "Campaigns, resend, templates, settings."),
    ("send_debt_sms", "Send debt SMS", "Debt reminders only."),
    ("view_reports", "View reports", "Money totals."),
    ("events_shop", "Events and shop", "Events, shop, Telegram posts, stories, somebody else's coins."),
    ("manage_staff", "Manage staff", "Staff accounts, roles and per-person permissions."),
    ("lcup_tools", "lc-up tools", "lc-up pairing, sync and review."),
)


def add_rows(apps, schema_editor):
    Permission = apps.get_model("access", "Permission")
    for codename, name, description in CRM_PERMISSIONS:
        Permission.objects.get_or_create(codename=codename, defaults={"name": name, "description": description})


def remove_rows(apps, schema_editor):
    Permission = apps.get_model("access", "Permission")
    Permission.objects.filter(codename__in=[codename for codename, _, _ in CRM_PERMISSIONS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("access", "0011_resourceaccessgrant_accessgrantevent_and_more"),
    ]

    operations = [
        migrations.RunPython(add_rows, remove_rows),
    ]
