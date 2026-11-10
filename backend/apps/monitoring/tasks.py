from celery import shared_task


@shared_task(name="monitoring.check_alerts")
def check_alerts() -> int:
    """Evaluate every enabled alert rule on a schedule."""
    from .services import evaluate_all_rules

    return evaluate_all_rules()


@shared_task(name="monitoring.dispatch_schedules")
def dispatch_schedules() -> int:
    """Deliver every scheduled report that is due."""
    from .services import dispatch_due_schedules

    return dispatch_due_schedules()
