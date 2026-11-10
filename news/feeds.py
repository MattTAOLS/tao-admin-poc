"""The `company_feeds` setting and the daily schedule. The schedule works in the configured local time zone (zoneinfo):
one scheduled run per local calendar day, started at the first check at or after run_at. On a spring-forward day a
run_at inside the skipped hour starts at the first local time after it; on a fall-back day the repeated hour cannot start
a second run, because a run for that local date already exists."""
import datetime as dt
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULTS = {"enabled": False, "run_at": "06:00", "time_zone": "America/Toronto", "sources": ["google_news", "gdelt"],
            "daily_cap": 200}
CAP_RANGE = (1, 5000)


def settings(value):
    """Merge a stored value (or None) over the defaults; bad fields fall back to the default."""
    out = dict(DEFAULTS)
    if isinstance(value, dict):
        if isinstance(value.get("enabled"), bool):
            out["enabled"] = value["enabled"]
        if _parse_time(value.get("run_at")) is not None:
            out["run_at"] = value["run_at"]
        if isinstance(value.get("time_zone"), str) and _zone(value["time_zone"]) is not None:
            out["time_zone"] = value["time_zone"]
        if isinstance(value.get("sources"), list):
            out["sources"] = [s for s in value["sources"] if isinstance(s, str)]
        cap = value.get("daily_cap")
        if isinstance(cap, int) and not isinstance(cap, bool) and CAP_RANGE[0] <= cap <= CAP_RANGE[1]:
            out["daily_cap"] = cap
    return out


def day_start_utc(now_utc, tz_name):
    """Midnight of the local day (company_feeds.time_zone) that contains now, in UTC: the daily cap's day."""
    tz = ZoneInfo(tz_name)
    local = now_utc.astimezone(tz)
    return dt.datetime.combine(local.date(), dt.time(), tzinfo=tz).astimezone(dt.timezone.utc)


def _parse_time(s):
    try:
        h, m = str(s).split(":")
        return dt.time(int(h), int(m))
    except (ValueError, TypeError):
        return None


def _zone(name):
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def local_day(when_utc, tz_name):
    return when_utc.astimezone(ZoneInfo(tz_name)).date()


def schedule_due(now_utc, cfg, schedule_runs_utc):
    """True when a scheduled run should start now. `schedule_runs_utc`: queued_at of recent scheduled runs."""
    if not cfg["enabled"]:
        return False
    tz = ZoneInfo(cfg["time_zone"])
    local = now_utc.astimezone(tz)
    if local.time().replace(second=0, microsecond=0) < _parse_time(cfg["run_at"]):
        return False
    today = local.date()
    return not any(r.astimezone(tz).date() == today for r in schedule_runs_utc)
