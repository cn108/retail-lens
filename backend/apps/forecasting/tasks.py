from celery import shared_task


@shared_task(name="forecasting.run_forecast")
def run_forecast(run_id: str) -> str:
    from .services import execute_forecast

    return execute_forecast(run_id)
