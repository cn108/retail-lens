from django.apps import AppConfig


class OrganisationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.organisations"
    label = "organisations"
    verbose_name = "Organisations and membership"
