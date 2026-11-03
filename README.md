# TAO Admin POC

Upload a SetRep → extract → validate → review → publish → partner portals. See `CLAUDE.md` for the brief every
agent reads, `docs/` for the plan inputs, `contracts/` for the day-0 contracts.

Run: `cp .env.example .env` (fill in keys), `docker compose up --build`, then open http://localhost:5173.
API docs at http://localhost:8000/docs. Contract check: `make check`. Mock API for UI work: `make mock`.
