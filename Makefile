# One command the Lead runs before every merge. Everything here must pass on main.
.PHONY: check contracts rules-test api-test up down mock seed

check: contracts rules-test api-test
	@echo "check: ok"

contracts:
	python3 scripts/check_contracts.py

rules-test:
	cd rules && python3 -m pytest -q

api-test:
	cd api && python3 -m pytest -q

up:
	docker compose up --build

down:
	docker compose down -v

seed:
	docker compose exec api python -m app.seed

# Mock API from the OpenAPI file for UI agents (needs: npm i -g @stoplight/prism-cli)
mock:
	prism mock contracts/openapi.yaml -p 8001
