from django.apps import AppConfig


class SmsConfig(AppConfig):
    """SMS through eskiz.uz — today only the warning before the monthly debt freeze (``debt_warnings``)."""

    name = "sms"
    verbose_name = "SMS (eskiz.uz)"
