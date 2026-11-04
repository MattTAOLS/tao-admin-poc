# TAO Admin POC

Upload a SetRep → extract → validate → review → publish → partner portals. See `CLAUDE.md` for the brief every
agent reads, `docs/` for the plan inputs, `contracts/` for the day-0 contracts.

Run: `cp .env.example .env` (fill in keys), `docker compose up --build`, then open http://localhost:5173.
API docs at http://localhost:8000/docs. Contract check: `make check`. Mock API for UI work: `make mock`.

The first start runs `npm install` inside the web container, so http://localhost:5173 can take a minute or two to
answer. A fresh database is empty: run `make seed` for master data, then either upload SetReps from Upload report,
load demo state with `python scripts/demo_data.py --api http://localhost:8000 --profile review` (Moneda and Xpedite
history published, a seeded R05 error waiting in the approval queue), or publish the 12 reference deals with
`make seed-demo`. Reset with `make down` and start again. On Windows, `make` may be missing: run the commands in the
`Makefile` directly, with `python` in place of `python3`.

## End-to-end demo tests

Prerequisites: Docker Desktop, Node 20+, Python 3.11+ with `pip install httpx pypdf`, the 12 SetRep PDFs in
`data/samples/`. From the repo root: `cp .env.example .env` (fill in `ANTHROPIC_API_KEY`), `docker compose up -d
--build`, `docker compose exec api python -m app.seed`. Then `cd tests/e2e && npm ci && npx playwright install
chromium && npm run test:e2e`. The demo needs a fresh database; reset with `docker compose down -v` and repeat the up
and seed. `npm run lighthouse` scores the four main pages after a run. Point the tests at another stack with
`E2E_WEB_URL` / `E2E_API_URL`. Walkthrough and acceptance results: `docs/demo.md`.

## Running beside another stack

`scripts/compose.agent.yml` runs a second, private stack with its own volumes: the API on `API_PORT` and the web app
on `WEB_PORT`, proxying `/api` to its own API.

    API_PORT=18100 WEB_PORT=15100 docker compose -p my-stack -f docker-compose.yml -f scripts/compose.agent.yml up -d --build

In Git Bash, prefix commands that pass a path-like value (e.g. `VITE_API_URL=/api/v1 npx vite`) with
`MSYS_NO_PATHCONV=1`, or MSYS rewrites `/api/v1` into a Windows path and every API call fails.
