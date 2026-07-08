from django.apps import AppConfig


class MocksConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "mocks"
    verbose_name = "Full Mocks"
