from django.contrib import admin

from .models import Membership, Organisation


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0
    autocomplete_fields = ("user",)
    fields = ("user", "role", "created_at")
    readonly_fields = ("created_at",)


@admin.register(Organisation)
class OrganisationAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "currency", "timezone", "created_at")
    search_fields = ("name", "slug")
    readonly_fields = ("slug", "created_at", "updated_at")
    inlines = (MembershipInline,)


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("user", "organisation", "role", "created_at")
    list_filter = ("role", "organisation")
    search_fields = ("user__email", "organisation__name")
    autocomplete_fields = ("user", "organisation")
