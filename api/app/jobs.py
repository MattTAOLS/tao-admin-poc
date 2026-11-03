"""Extraction job queue. Job = {"upload_id": ..., "pass": 1|2, "pages": [...]} on Redis list `extract:jobs`
(RPUSH here, BLPOP in worker/main.py, so jobs run first-in first-out). Tests swap in a list."""
import json, os

QUEUE = "extract:jobs"


class RedisQueue:
    def __init__(self, url: str | None = None):
        self.url = url or os.environ.get("REDIS_URL", "redis://localhost:6379/0")

    def push(self, job: dict) -> None:
        import redis
        redis.Redis.from_url(self.url, socket_connect_timeout=2).rpush(QUEUE, json.dumps(job))


class ListQueue:
    def __init__(self):
        self.jobs: list[dict] = []

    def push(self, job: dict) -> None:
        self.jobs.append(job)


def get_queue():
    return RedisQueue()
