from celery import shared_task


@shared_task(name="ingestion.process_dataset")
def process_dataset(run_id: str) -> str:
    """Celery entry point; the ETL lives in etl.run_processing."""
    from .etl import run_processing

    return run_processing(run_id)
