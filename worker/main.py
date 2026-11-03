"""Queue consumer skeleton. Job = {"upload_id": ..., "pass": 1|2, "pages": [...]}.
Flow: load PDF -> extract/ (text layer, OCR fallback) -> validate/ (rules package) -> write extraction + findings -> set upload status."""
import os, json, time, redis
r = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
QUEUE = "extract:jobs"
def handle(job: dict):
    print("job received (stub):", job, flush=True)
if __name__ == "__main__":
    print("worker up; waiting on", QUEUE, flush=True)
    while True:
        item = r.blpop(QUEUE, timeout=5)
        if item: handle(json.loads(item[1]))
