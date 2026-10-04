.DEFAULT_GOAL := help
PY ?= .venv/bin/python
VENV ?= .venv

.PHONY: help setup setup-backend setup-frontend dev backend frontend test test-frontend test-all lint build icons serve-standalone clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: setup-backend setup-frontend ## Create the venv and install all dependencies

$(VENV)/bin/python:
	python3 -m venv $(VENV)

setup-backend: $(VENV)/bin/python ## Install Python dependencies
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r backend/requirements.txt

setup-frontend: ## Install dashboard dependencies
	cd frontend && npm install

dev: ## Run the API + dashboard dev server (Vite proxies /api and /ws)
	@echo "Start the API in one shell:      make backend"
	@echo "Start the dashboard in another:  make frontend"
	@echo "Then open http://localhost:5173"

backend: ## Run the FastAPI server on :8000 (auto data mode)
	cd backend && ../$(PY) -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

frontend: ## Run the Vite dev server on :5173
	cd frontend && npm run dev

test: ## Run the backend test suite
	cd backend && ../$(PY) -m pytest

test-frontend: ## Run the browser-engine test suite (vitest)
	cd frontend && npm test

test-all: test test-frontend ## Run every test suite

build: ## Build the dashboard (served by the API at /)
	cd frontend && npm run build

site: ## Rebuild the committed static site/ folder (relative paths, any host)
	cd frontend && ARBIBOT_BASE=./ npm run build
	cp site/README.md /tmp/arbibot-site-readme.md
	rm -rf site && mkdir -p site && cp -r frontend/dist/* site/
	cp /tmp/arbibot-site-readme.md site/README.md
	@echo "site/ rebuilt — commit it to publish on Pages/any static host"

serve-standalone: ## Build + serve the dashboard alone on :8090 (open it on your phone)
	cd frontend && npm run build
	@echo "Dashboard on http://<this-host>:8090 — open it on your phone (no backend needed)"
	cd frontend/dist && $(abspath $(PY)) -m http.server 8090 --bind 0.0.0.0

icons: ## Regenerate the PWA icons (needs Pillow: pip install pillow)
	$(PY) frontend/scripts/generate_icons.py

lint: ## Type-check the dashboard and byte-compile the backend
	cd frontend && npm run typecheck
	$(PY) -m compileall -q backend/app

clean: ## Remove caches and build output
	rm -rf frontend/dist backend/**/__pycache__ .pytest_cache
