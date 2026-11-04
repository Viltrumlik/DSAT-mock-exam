import json
import uuid

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from billing import ledger
from billing.models import Account, EntryKind
from classes.capabilities import is_global_admin


class Command(BaseCommand):
    help = (
        "Write one adjustment, with a reason and an admin's name. For a difference from lc-up that lc-up cannot "
        "explain, while the Ledger tab's form is closed. Below zero lowers the balance."
    )

    def add_arguments(self, parser):
        parser.add_argument("--account", type=int, required=True, help="The ledger account's id.")
        parser.add_argument("--amount", type=int, required=True, help="Whole so'm, signed.")
        parser.add_argument("--reason", required=True)
        parser.add_argument("--by", required=True, help="The username of the admin who decided it.")

    def handle(self, *args, **options):
        user = get_user_model().objects.filter(username=options["by"]).first()
        if user is None or not is_global_admin(user):
            raise CommandError(f"{options['by']} is not an admin.")
        account = Account.objects.filter(pk=options["account"]).first()
        if account is None:
            raise CommandError(f"There is no account {options['account']}.")
        today = timezone.localdate()
        try:
            row = ledger.enter_money(
                account, EntryKind.ADJUST, options["amount"], today, request_id=uuid.uuid4(), today=today,
                note=options["reason"], by=user,
            )
        except ledger.EntryRefused as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(json.dumps({"entry": row.pk, "balance": ledger.balance(account)}))
