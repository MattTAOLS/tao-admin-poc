"""Extraction job queue. Job = {"upload_id": ..., "pass": 1|2, "pages": [...], "template_id": <the deal's>} on Redis list `extract:jobs`
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


class NewsQueue:
    """Run now (wave D): LPUSH the news_run id to the Redis list NEWS_QUEUE (default "news"); the news worker block-pops it.
    Its own list, never the extraction queue."""
    def __init__(self, url: str | None = None, name: str | None = None):
        self.url = url or os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        self.name = name or os.environ.get("NEWS_QUEUE") or "news"

    def push(self, run_id: str) -> None:
        import redis
        redis.Redis.from_url(self.url, socket_connect_timeout=2).lpush(self.name, run_id)


def get_news_queue():
    return NewsQueue()
