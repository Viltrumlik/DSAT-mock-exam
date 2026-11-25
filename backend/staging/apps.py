from django.apps import AppConfig


class StagingConfig(AppConfig):
    """The test copy's toolbox (/ops/toolbox) and the capture of every outgoing message there.

    Installed everywhere, so its two tables exist on prod too and stay empty: everything it does is behind
    ``staging.guard.toolbox_on()``, which is False anywhere but the copy."""

    name = "staging"
    verbose_name = "Test copy toolbox"
