from django.apps import AppConfig


class RewardsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "rewards"
    verbose_name = "Reward points & coins"

    def ready(self):
        # Import for the side effect of registering the award hooks. Kept here rather than at
        # module import time so the app registry is fully populated first.
        from . import hooks  # noqa: F401
