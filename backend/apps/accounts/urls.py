from django.urls import path

from . import views

urlpatterns = [
    path("csrf", views.csrf_token, name="auth-csrf"),
    path("register", views.RegisterView.as_view(), name="auth-register"),
    path("login", views.LoginView.as_view(), name="auth-login"),
    path("logout", views.LogoutView.as_view(), name="auth-logout"),
    path("me", views.MeView.as_view(), name="auth-me"),
    path("me/password", views.PasswordChangeView.as_view(), name="auth-password"),
    path("me/preferences", views.PreferencesView.as_view(), name="auth-preferences"),
]
