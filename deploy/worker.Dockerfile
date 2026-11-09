# Production extraction worker. Build context: the repo root.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
COPY worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker/ /app/
COPY rules/ /app/rules/
COPY contracts/ /app/contracts/
ENV FILE_STORE=/data
CMD ["python", "main.py"]
