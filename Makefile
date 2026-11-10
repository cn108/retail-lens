.PHONY: up down logs migrate makemigrations test lint check build

up: ## start the full stack in Docker
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f backend worker frontend

migrate:
	docker compose run --rm backend python manage.py migrate

makemigrations:
	docker compose run --rm backend python manage.py makemigrations

check:
	docker compose run --rm backend python manage.py check

test:
	docker compose run --rm backend pytest

lint:
	docker compose run --rm backend ruff check . && docker compose run --rm backend ruff format --check .

build:
	docker compose build
