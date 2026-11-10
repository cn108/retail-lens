from django.contrib import admin

from .models import AlertEvent, AlertRule, Board, ReportSchedule, Target


@admin.register(AlertRule)
class AlertRuleAdmin(admin.ModelAdmin):
    list_display = ("name", "organisation", "metric", "comparator", "threshold", "last_state")
    list_filter = ("metric", "last_state", "enabled")


@admin.register(AlertEvent)
class AlertEventAdmin(admin.ModelAdmin):
    list_display = ("rule", "value", "threshold", "triggered_at", "acknowledged_at")


@admin.register(Target)
class TargetAdmin(admin.ModelAdmin):
    list_display = ("name", "organisation", "metric", "amount", "period_start", "period_end")


@admin.register(ReportSchedule)
class ReportScheduleAdmin(admin.ModelAdmin):
    list_display = ("report", "frequency", "format", "enabled", "next_run_at", "last_status")


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    list_display = ("name", "organisation", "updated_at")
