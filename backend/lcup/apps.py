from django.apps import AppConfig


class LcupConfig(AppConfig):
    """The centre's CRM, lc-up: groups, members and accounts follow it (see ``sync``)."""

    name = "lcup"
    verbose_name = "lc-up CRM integration"

    def ready(self):
        from users.profile_completeness import register_requirement

        from .claims import password_requirement

        register_requirement(password_requirement)
