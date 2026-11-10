# Hosting TAO Admin POC internally

For the IT team. This explains how to run the application on an internal server with `docker-compose.prod.yml`.
The development setup (`docker-compose.yml`, the laptop) is unchanged and stays the reference for the build agents and the demo tests.

## What it is

Six Linux containers, started by one compose file.

| Service | Image | What it does | Port |
| --- | --- | --- | --- |
| web | built from `deploy/web.Dockerfile` (nginx 1.27) | Serves the built React app and passes `/api/` to the API | `HTTP_PORT` on the host (default 80), the only published port |
| api | built from `deploy/api.Dockerfile` (Python 3.12) | FastAPI; applies database migrations on start-up | internal 8000 |
| worker | built from `deploy/worker.Dockerfile` (Python 3.12) | Extracts figures from uploaded SetRep PDFs, runs the validation rules | none |
| news | built from `deploy/news.Dockerfile` (Python 3.12) | Daily company news and adverse-media search; idle until switched on in System settings | none |
| postgres | `postgres:16-alpine` | The database | internal only |
| redis | `redis:7-alpine` | Job queue for extraction and news | internal only |

Three named volumes hold the data:

- `pgdata`: the database.
- `filestore`: uploaded PDFs and page images.
- `redisdata`: the queue.

Back up `pgdata` and `filestore` (the backup script does both), and keep a safe copy of `.env`, which holds the passwords and `NEWS_SECRET_KEY`.

## Server requirements

- **Docker:** Linux with Docker Engine 24 or later and the Compose plugin v2.20 or later. Windows Server works only with Linux containers (WSL2); Windows containers are not supported.
- **Size:** 2 vCPU, 4 GB RAM and 20 GB disk is plenty for a handful of users. Each SetRep adds a few MB.
- **Outbound HTTPS:**
  - `api.anthropic.com`: the news check (required for news) and the extraction fallback.
  - Only once the company news search is used:
    - `news.google.com` and `api.gdeltproject.org`, the free sources.
    - The paid sources that are switched on: `eventregistry.org`, `v3-api.newscatcherapi.com`, `api.search.brave.com`.
    - **Publisher websites in general.** The news worker opens each article's own page to confirm its publish date, so it needs outbound web access (ports 80 and 443) to public sites. Without it, stories show "Date not confirmed". It refuses internal addresses.
  - Docker Hub, PyPI and npm: only while images are built.

## Sign-in: read this first

The app has no real sign-in. Every visitor can choose any role, TAO Admin included, from the menu at the bottom left. This is by design for the proof of concept, and lets testers work across all partner accounts.

Restrict who can reach the server, for example:

- an internal network segment only;
- a firewall allow-list of the testers' machines;
- a reverse proxy that requires company sign-in (Entra ID application proxy or similar).

Do not expose it to the internet.

## First install

1. Copy the repository to the server, for example with `git clone`.

2. Create the settings file and fill it in:

   ```bash
   cp .env.production.example .env
   ```

   - `POSTGRES_PASSWORD`: required. Use letters and digits only.
   - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`: required for the news check; extraction uses Claude only as a fallback. Same values as the laptop.
   - `NEWS_SECRET_KEY`: encrypts the client API keys entered under System settings → News sources.
     - **Moving data from the laptop:** copy the laptop's `NEWS_SECRET_KEY` here, or the stored keys cannot be read after the restore and must be entered again.
     - **Starting fresh:** generate one with the command in `.env.production.example`.
   - `NEWS_MODEL`: the model for the news check (default `claude-haiku-5-5`).
   - `AZURE_DI_ENDPOINT`, `AZURE_DI_KEY`: reserved; no code reads them yet. Leave empty.
   - `HTTP_PORT`: the host port (default 80).

   Keep `.env` readable by the service account only (`chmod 600 .env`). It is git-ignored and never copied into an image. Keep a copy of it somewhere safe: the backup script does not include it.

3. Build and start:

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

   The first build takes a few minutes. The API creates the database tables on its first start.

4. Load the data. Do **one** of the following.
   - **Move everything from the laptop (recommended).** This brings every upload, review, publication, setting, user, company note and audit entry. On the laptop, in Git Bash, in the repo folder, with the laptop stack running:

     ```bash
     scripts/export-dev-data.sh
     ```

     This writes `data/export/tao_admin-<time>.dump` and `data/export/filestore-<time>.tgz`. Copy both to the server, then run:

     ```bash
     scripts/prod-restore.sh tao_admin-<time>.dump filestore-<time>.tgz
     ```

   - **Start empty with the master data only** (partners, programs, deals, covenants, sample users, companies):

     ```bash
     docker compose -f docker-compose.prod.yml exec api python -m app.seed
     ```

5. Open `http://<server>:<HTTP_PORT>/` and check that the API answers at `http://<server>:<HTTP_PORT>/api/v1/health`.

## HTTPS

The web container speaks plain HTTP on `HTTP_PORT`. Put the organisation's usual TLS termination in front of it: a load balancer, a reverse proxy (IIS ARR, nginx, Traefik) or an Entra application proxy. Forward everything, `/api/` included, to that one port. Uploads can be up to 100 MB, and some requests take up to 5 minutes (re-extraction), so allow both on the proxy.

## Day to day

| Task | Command (from the repo folder) |
| --- | --- |
| Status | `docker compose -f docker-compose.prod.yml ps` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f --tail 100 api worker` |
| Stop / start | `docker compose -f docker-compose.prod.yml stop` / `... up -d` |
| Back up | `scripts/prod-backup.sh` (database and files into `backups/`; the stack keeps running; backups older than 14 days are removed, change with `KEEP_DAYS=30`) |
| Restore | `scripts/prod-restore.sh <file.dump> <filestore.tgz>` (replaces everything; asks you to type RESTORE) |

The containers restart on their own after a crash or a server reboot (`restart: unless-stopped`). Logs rotate at 10 MB × 5 files per container.

Schedule the backup daily and copy `backups/` off the server. `backups/` sits on the same disk as the database, so the off-server copy is the real backup. For example, in cron:

```bash
15 2 * * * cd /opt/tao-admin-poc && mkdir -p backups && scripts/prod-backup.sh >> backups/backup.log 2>&1
```

**How a restore protects what you have.** The restore script checks both backup files before it stops anything. It then loads the dump into a scratch database and unpacks the files into a scratch folder. Only when both have loaded does it swap them in. If anything fails before the swap, your existing data is untouched and the app is started again. After the swap it clears the job queues, because queued jobs belonged to the replaced data.

## Updating to a new version

1. Back up first:

   ```bash
   scripts/prod-backup.sh
   ```

2. Pull the new version and rebuild:

   ```bash
   git pull
   ```

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

   The API applies new database migrations on start-up. Each one runs once, inside a transaction. Data is kept.

3. If a release adds master data, for example new companies, the release notes will name the one command to load it. Do not re-run the full seed on a live system.

## What differs from the laptop setup

| | Laptop (`docker-compose.yml`) | Server (`docker-compose.prod.yml`) |
| --- | --- | --- |
| Web app | Vite development server, port 5173 | Built once, served by nginx |
| API | `--reload`, port 8000 published | No reload, internal only, reached through `/api/` on the web port |
| Source code | Mounted from the folder | Copied into the images; the server runs the images, not the folder |
| Database password | `tao`/`tao` in the compose file | From `.env` |
| Postgres and Redis ports | Published (5432, 6379) | Not published |
| Restart, health checks, log rotation | No | Yes |
| Redis | In memory | Saved to disk (`redisdata`), so queued jobs survive a restart |

Every feature is the same. The production stack was tested with the full demo script (`tests/e2e`, project `demo`) using `scripts/compose.prod-test.yml`, which points the news worker at its test fixture. That override is for testing only.
