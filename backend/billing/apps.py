from django.apps import AppConfig


class BillingConfig(AppConfig):
    """The centre's own money ledger, built to outlive lc-up (see ``ledger`` and ``shadow``)."""

    name = "billing"
    verbose_name = "Billing ledger"
