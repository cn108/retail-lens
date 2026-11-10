from celery import shared_task


@shared_task(name="reporting.generate_export")
def generate_export(job_id: str) -> str:
    from .services import execute_export

    return execute_export(job_id)
