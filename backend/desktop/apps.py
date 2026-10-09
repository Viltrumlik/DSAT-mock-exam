from django.apps import AppConfig


class DesktopConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "desktop"
    verbose_name = "Windows exam app"

    def ready(self):
        from . import checks  # noqa: F401  (registers the system checks)
