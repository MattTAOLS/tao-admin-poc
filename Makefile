# One command the Lead runs before every merge. Everything here must pass on main.
# PYTHON defaults to python3; on Windows run `make check PYTHON=python`.
PYTHON ?= python3
.PHONY: check contracts rules-test api-test validate-test web-test extract-test e2e up down mock seed seed-demo

check: contracts rules-test api-test validate-test web-test
	@echo "check: ok"

contracts:
	$(PYTHON) scripts/check_contracts.py

rules-test:
	cd rules && $(PYTHON) -m pytest -q

api-test:
	cd api && $(PYTHON) -m pytest -q

validate-test:
	cd worker/validate && $(PYTHON) -m pytest -q

web-test:
	cd web && npx vitest run && npx tsc --noEmit

# Slow (about 3-6 minutes; parses the 12 SetRep PDFs in data/samples/). Not part of check.
extract-test:
	$(PYTHON) -m pytest -q worker/extract/tests

# End-to-end demo against a fresh, seeded stack (see README: End-to-end demo tests).
e2e:
	cd tests/e2e && npm run test:e2e

up:
	docker compose up --build

down:
	docker compose down -v

seed:
	docker compose exec api python -m app.seed

# All 12 reference deals published as they are (partner portals have data before any upload).
seed-demo:
	docker compose exec api python -m app.seed --reference-publications

# Mock API from the OpenAPI file for UI agents (needs: npm i -g @stoplight/prism-cli)
mock:
	prism mock contracts/openapi.yaml -p 8001
