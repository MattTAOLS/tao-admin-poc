import datetime as dt
from zoneinfo import ZoneInfo

import feeds
from conftest import UTC

ON = dict(feeds.DEFAULTS, enabled=True)


def utc(*a):
    return dt.datetime(*a, tzinfo=UTC)


def test_defaults_and_bad_values():
    assert feeds.settings(None) == feeds.DEFAULTS
    assert feeds.settings({"enabled": True})["run_at"] == "06:00"
    bad = feeds.settings({"enabled": "yes", "run_at": "6am", "time_zone": "Mars/Base", "sources": "gdelt"})
    assert bad == feeds.DEFAULTS


def test_off_never_due():
    assert not feeds.schedule_due(utc(2026, 11, 6, 15), feeds.DEFAULTS, [])


def test_before_and_after_run_at_in_toronto():
    # 06:00 EST = 11:00 UTC in November
    assert not feeds.schedule_due(utc(2026, 11, 6, 10, 59), ON, [])
    assert feeds.schedule_due(utc(2026, 11, 6, 11, 0), ON, [])
    assert feeds.schedule_due(utc(2026, 11, 6, 20, 0), ON, [])        # a late start still runs that day


def test_once_per_local_day():
    ran = [utc(2026, 11, 6, 11, 0)]
    assert not feeds.schedule_due(utc(2026, 11, 6, 23, 0), ON, ran)
    # 23:30 Toronto on 6 Nov is 04:30 UTC on 7 Nov: still the same local day
    assert not feeds.schedule_due(utc(2026, 11, 7, 4, 30), ON, ran)
    assert not feeds.schedule_due(utc(2026, 11, 7, 10, 59), ON, ran)
    assert feeds.schedule_due(utc(2026, 11, 7, 11, 0), ON, ran)


def test_utc_midnight_is_not_local_midnight():
    cfg = dict(ON, run_at="00:00")
    ran = [utc(2026, 11, 6, 5, 0)]                                     # 00:00 local on 6 Nov
    assert not feeds.schedule_due(utc(2026, 11, 7, 0, 30), cfg, ran)   # 19:30 local on 6 Nov
    assert feeds.schedule_due(utc(2026, 11, 7, 5, 0), cfg, ran)        # 00:00 local on 7 Nov


def test_zone_east_of_utc():
    cfg = dict(ON, run_at="23:30", time_zone="Asia/Tokyo")
    assert feeds.schedule_due(utc(2026, 11, 6, 14, 30), cfg, [])       # 23:30 JST on 6 Nov
    assert not feeds.schedule_due(utc(2026, 11, 6, 15, 0), cfg, [utc(2026, 11, 6, 14, 30)])   # 00:00 JST 7 Nov


def test_spring_forward_skipped_hour():
    cfg = dict(ON, run_at="02:30")
    # 8 Mar 2026: 02:00 EST jumps to 03:00 EDT (07:00 UTC). 02:30 never happens; the first check after it runs.
    assert not feeds.schedule_due(utc(2026, 3, 8, 6, 59), cfg, [])    # 01:59 EST
    assert feeds.schedule_due(utc(2026, 3, 8, 7, 0), cfg, [])          # 03:00 EDT
    assert not feeds.schedule_due(utc(2026, 3, 8, 7, 1), cfg, [utc(2026, 3, 8, 7, 0)])


def test_fall_back_repeated_hour_runs_once():
    cfg = dict(ON, run_at="01:30")
    # 1 Nov 2026: 02:00 EDT falls back to 01:00 EST; 01:30 local happens at 05:30 and at 06:30 UTC.
    first = utc(2026, 11, 1, 5, 30)
    assert feeds.schedule_due(first, cfg, [])
    assert not feeds.schedule_due(utc(2026, 11, 1, 6, 30), cfg, [first])
    assert feeds.schedule_due(utc(2026, 11, 2, 6, 30), cfg, [first])   # 01:30 EST on 2 Nov


def test_simulated_week_across_dst_runs_once_a_day_at_run_at():
    cfg = dict(ON, run_at="06:00")
    tz = ZoneInfo("America/Toronto")
    t, ran = utc(2026, 10, 29, 4, 0), []         # 00:00 local on 29 Oct
    while t < utc(2026, 11, 5, 0, 0):          # crosses the 1 Nov fall-back
        if feeds.schedule_due(t, cfg, ran):
            ran.append(t)
        t += dt.timedelta(minutes=1)
    days = [feeds.local_day(r, cfg["time_zone"]) for r in ran]
    assert len(days) == len(set(days)) == 7
    assert {r.astimezone(tz).strftime("%H:%M") for r in ran} == {"06:00"}
