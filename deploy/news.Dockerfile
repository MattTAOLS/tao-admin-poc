# Production news worker. Build context: the repo root. Idle while the System setting company_feeds.enabled is false.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY news/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY news/ /app/
COPY seed/ /app/seed/
CMD ["python", "main.py"]
