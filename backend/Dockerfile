# syntax=docker/dockerfile:1
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home /app app

COPY requirements.txt requirements-dev.txt ./

FROM base AS dev
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY . .
USER app
ENV DJANGO_SETTINGS_MODULE=config.settings.dev
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

FROM base AS prod
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN python manage.py collectstatic --noinput --settings=config.settings.prod || true
USER app
ENV DJANGO_SETTINGS_MODULE=config.settings.prod
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120"]
