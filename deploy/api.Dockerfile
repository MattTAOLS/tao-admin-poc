# Production API image. Build context: the repo root (docker-compose.prod.yml).
# The files land where the development compose mounts them, so the code finds them at the same paths.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ /app/
COPY rules/ /app/rules/
COPY contracts/ /app/contracts/
COPY seed/ /app/seed/
COPY docs/dashboard-json/ /app/docs/dashboard-json/
COPY db/migrations/ /migrations/
ENV FILE_STORE=/data MIGRATIONS_DIR=/migrations
EXPOSE 8000
# No --reload. API_WORKERS processes (default 1); start-up migrations take a database lock, so more than one is safe.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${API_WORKERS:-1} --proxy-headers --forwarded-allow-ips='*'"]
