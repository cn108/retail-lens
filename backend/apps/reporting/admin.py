from django.contrib import admin

from .models import ReportJob, SavedReport


@admin.register(SavedReport)
class SavedReportAdmin(admin.ModelAdmin):
    list_display = ("name", "organisation", "kind", "dataset", "created_at")
    list_filter = ("kind",)
    search_fields = ("name", "organisation__name", "dataset__name")
    readonly_fields = ("created_at", "updated_at")


@admin.register(ReportJob)
class ReportJobAdmin(admin.ModelAdmin):
    list_display = ("report", "format", "status", "row_count", "size_bytes", "created_at")
    list_filter = ("format", "status")
    search_fields = ("report__name",)
    readonly_fields = (
        "file",
        "filename",
        "row_count",
        "size_bytes",
        "error_message",
        "started_at",
        "finished_at",
        "created_at",
    )
