from django.apps import AppConfig


class LcupConfig(AppConfig):
    """The centre's CRM, lc-up: groups, members and accounts follow it (see ``sync``)."""

    name = "lcup"
    verbose_name = "lc-up CRM integration"

    def ready(self):
        from users.profile_completeness import register_requirement

        from .claims import password_requirement
        from .phone_confirm import phone_requirement

        # Asked in this order: an account's own password first, then — on a same-name account —
        # the phone that decides which of the student's accounts lc-up follows.
        register_requirement(password_requirement)
        register_requirement(phone_requirement)
