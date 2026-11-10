"""Wave E paid news sources (contract lead/wave-e, decisions E1 and E8): the provider definitions (labels, fields, defaults),
the write-only credential store and the checks behind /news/sources. No routes here; main.py calls these.

Secrets. secrets_enc = Fernet(NEWS_SECRET_KEY).encrypt(json.dumps({secret field: value, ...}).encode()).decode(); the news
worker decrypts the same way, so keep exactly this format. secrets_last4[field] = the last 4 characters when the value is at
least 12 characters long, else null; a field is "set" when it is a key of secrets_last4. A secret value is never returned,
logged, audited or put in an exception message: every Refused below names fields only."""
import json, os
from sqlalchemy.orm import Session
from .models import NewsSource, utcnow
from .people import Refused
from . import views

ARCHIVE_NOTE = "Free plan covers the last 30 days; an archive plan lets the first search go back 12 months"
CLIENT_DOCS_NOTE = "Needs the client's API documentation to finish; credentials can be stored now"


def _f(name, label, secret=False, required=False, kind="text", help=None):
    return {"name": name, "label": label, "secret": secret, "required": required, "kind": kind, "help": help}


def _archive_fields():
    return [_f("api_key", "API key", secret=True, required=True),
            _f("archive_months", "Archive on your plan (months)", kind="integer",
               help="0 = last 30 days only; 12 or more = first search goes back 12 months")]


PROVIDERS: dict[str, dict] = {
    "event_registry": {"label": "Event Registry (newsapi.ai)", "available": True, "note": ARCHIVE_NOTE,
                       "fields": _archive_fields(), "defaults": {"archive_months": 0}},
    "newscatcher": {"label": "NewsCatcher (v3)", "available": True, "note": ARCHIVE_NOTE,
                    "fields": _archive_fields(), "defaults": {"archive_months": 0}},
    "brave": {"label": "Brave Search", "available": True, "note": None,
              "fields": [_f("api_key", "API key", secret=True, required=True),
                         _f("news", "News search", kind="boolean"),
                         _f("web", "Web search (non-news pages)", kind="boolean")],
              "defaults": {"news": True, "web": True}},
    "dow_jones": {"label": "Dow Jones (Factiva)", "available": False, "note": CLIENT_DOCS_NOTE,
                  "fields": [_f("user_key", "User key", secret=True), _f("client_id", "Client ID", secret=True),
                             _f("client_secret", "Client secret", secret=True), _f("username", "Service account username", secret=True),
                             _f("password", "Service account password", secret=True), _f("base_url", "API base URL", kind="url")],
                  "defaults": {}},
    "lexisnexis": {"label": "LexisNexis (Nexis Data+)", "available": False, "note": CLIENT_DOCS_NOTE,
                   "fields": [_f("client_id", "Client ID", secret=True), _f("client_secret", "Client secret", secret=True),
                              _f("base_url", "API base URL", kind="url")],
                   "defaults": {}},
}
ORDER = list(PROVIDERS)
UPDATE_KEYS = {"enabled", "config", "secrets", "reason"}


def secret_fields(provider: str) -> list[str]:
    return [f["name"] for f in PROVIDERS[provider]["fields"] if f["secret"]]


def config_fields(provider: str) -> dict[str, dict]:
    return {f["name"]: f for f in PROVIDERS[provider]["fields"] if not f["secret"]}


def required_secrets(provider: str) -> list[str]:
    return [f["name"] for f in PROVIDERS[provider]["fields"] if f["secret"] and f["required"]]


# ---- the key ----
def fernet():
    """Fernet over NEWS_SECRET_KEY, or None when it is unset or not a valid Fernet key."""
    key = (os.environ.get("NEWS_SECRET_KEY") or "").strip()
    if not key:
        return None
    try:
        from cryptography.fernet import Fernet
        return Fernet(key.encode())
    except Exception:                                   # never echo the key
        return None


def secret_key_set() -> bool:
    return fernet() is not None


def encrypt(secrets: dict[str, str]) -> str:
    return fernet().encrypt(json.dumps(secrets).encode()).decode()


def decrypt(token: str | None) -> dict[str, str] | None:
    """The stored secrets, {} when none are stored, None when they cannot be read (no key, or the key changed)."""
    if not token:
        return {}
    f = fernet()
    if f is None:
        return None
    try:
        return json.loads(f.decrypt(token.encode()).decode())
    except Exception:
        return None


def last4(value: str) -> str | None:
    return value[-4:] if len(value) >= 12 else None


# ---- reads ----
def row(s: Session, provider: str) -> NewsSource:
    """The provider's row, added when missing (migration 013 inserts all five; a database built by create_all has none)."""
    r = s.get(NewsSource, provider)
    if r is None:
        r = NewsSource(provider=provider, enabled=False, secrets_last4={}, config={})
        s.add(r)
        s.flush()
    return r


def config_of(r: NewsSource) -> dict:
    return {**PROVIDERS[r.provider]["defaults"], **(r.config or {})}


def is_set(r: NewsSource) -> set[str]:
    return set((r.secrets_last4 or {}).keys())


def source_dict(s: Session, r: NewsSource) -> dict:
    from . import companies
    p = PROVIDERS[r.provider]
    set_ = r.secrets_last4 or {}
    return {"provider": r.provider, "label": p["label"], "available": p["available"], "note": p["note"], "enabled": bool(r.enabled),
            "fields": [{k: f[k] for k in ("name", "label", "secret", "required", "kind", "help")} for f in p["fields"]],
            "secrets": {name: {"set": name in set_, "last4": set_.get(name)} for name in secret_fields(r.provider)},
            "config": config_of(r),
            "last_test": {"at": views.iso(r.last_test_at), "ok": r.last_test_ok, "message": r.last_test_message},
            "updated_at": views.iso(r.updated_at), "updated_by": companies.author(s, r.updated_by)}


def all_sources(s: Session) -> dict:
    return {"secret_key_set": secret_key_set(), "sources": [source_dict(s, row(s, p)) for p in ORDER]}


# ---- writes ----
def _bad(message: str) -> Refused:
    return Refused(422, "invalid", message)


def check_update(provider: str, body) -> dict:
    """The NewsSourceUpdate body, checked (422 invalid). Messages name fields, never values."""
    if not isinstance(body, dict):
        raise _bad("the body is {enabled, config, secrets, reason}")
    extra = set(body) - UPDATE_KEYS
    if extra:
        raise _bad(f"unknown field(s): {', '.join(sorted(map(str, extra)))}")
    reason = body.get("reason")
    if not isinstance(reason, str) or len(reason.strip()) < 3:
        raise _bad("reason is required (at least 3 characters)")
    if "enabled" in body and not isinstance(body["enabled"], bool):
        raise _bad("enabled is true or false")
    secrets, cfg = secret_fields(provider), config_fields(provider)
    config = body.get("config", {})
    if config is None or not isinstance(config, dict):
        raise _bad("config is an object of the provider's non-secret fields")
    for k, v in config.items():
        if k in secrets:
            raise _bad(f"config.{k}: {k} is a secret field; send it under secrets")
        if k not in cfg:
            raise _bad(f"config.{k}: {provider} has no such field")
        if v is None:
            continue                                    # back to the default
        kind = cfg[k]["kind"]
        if kind == "integer" and (not isinstance(v, int) or isinstance(v, bool) or not 0 <= v <= 120):
            raise _bad(f"config.{k} is a whole number from 0 to 120")
        if kind == "boolean" and not isinstance(v, bool):
            raise _bad(f"config.{k} is true or false")
        if kind == "url" and (not isinstance(v, str) or not v.strip().lower().startswith(("https://", "http://"))):
            raise _bad(f"config.{k} is an http(s) URL")
        if kind == "text" and not isinstance(v, str):
            raise _bad(f"config.{k} is text")
    sent = body.get("secrets", {})
    if sent is None or not isinstance(sent, dict):
        raise _bad("secrets is an object of the provider's secret fields")
    for k, v in sent.items():
        if k not in secrets:
            raise _bad(f"secrets.{k}: {provider} has no such secret field")
        if v is not None and (not isinstance(v, str) or not v.strip()):
            raise _bad(f"secrets.{k} is a non-empty string, or null to remove it")
    return {"enabled": body.get("enabled"), "config": {k: (v.strip() if isinstance(v, str) else v) for k, v in config.items()},
            "secrets": {k: (v.strip() if isinstance(v, str) else None) for k, v in sent.items()}, "reason": reason.strip()}


def apply_update(s: Session, r: NewsSource, upd: dict, user_id: str | None) -> dict:
    """Merge a checked update into the row (409s first, so nothing changes when refused). Returns the audit detail: field
    names and on/off only, never a value."""
    provider, p = r.provider, PROVIDERS[r.provider]
    if upd["enabled"] is True and not p["available"]:
        raise Refused(409, "not_available", f"{p['label']} cannot be switched on yet: {CLIENT_DOCS_NOTE.lower()}")
    to_set = {k: v for k, v in upd["secrets"].items() if v is not None}
    to_remove = [k for k, v in upd["secrets"].items() if v is None and k in is_set(r)]
    names = set(is_set(r)) - set(to_remove) | set(to_set)
    secrets_change = bool(to_set or to_remove)
    if secrets_change and names and not secret_key_set():
        raise Refused(409, "no_secret_key", "NEWS_SECRET_KEY is not set (or not a valid key) on the server, so credentials cannot be stored")
    enabled = r.enabled if upd["enabled"] is None else upd["enabled"]
    missing = [k for k in required_secrets(provider) if k not in names]
    if enabled and missing:
        raise Refused(409, "missing_credentials", f"{p['label']} needs {', '.join(missing)} before it can be switched on")
    detail = {"provider": provider, "label": p["label"], "enabled": {"before": bool(r.enabled), "after": bool(enabled)},
              "config_changed": [], "secrets_set": sorted(to_set), "secrets_removed": sorted(to_remove)}
    if secrets_change:
        current = decrypt(r.secrets_enc)
        if current is None:                             # unreadable (the key changed): what was stored is lost anyway
            current = {}
            names = set(to_set)
        merged = {k: v for k, v in current.items() if k in names}
        merged.update(to_set)
        r.secrets_enc = encrypt(merged) if merged else None
        old4 = dict(r.secrets_last4 or {})
        r.secrets_last4 = {k: (last4(to_set[k]) if k in to_set else old4.get(k)) for k in secret_fields(provider) if k in merged}
    cfg = dict(r.config or {})
    for k, v in upd["config"].items():
        before = config_of(r).get(k)
        if v is None:
            cfg.pop(k, None)
        else:
            cfg[k] = v
        if {**p["defaults"], **cfg}.get(k) != before:
            detail["config_changed"].append(k)
    r.config = cfg
    r.enabled = bool(enabled)
    changed = detail["enabled"]["before"] != detail["enabled"]["after"] or detail["config_changed"] or secrets_change
    if changed:
        r.updated_at, r.updated_by = utcnow(), user_id
    detail["changed"] = bool(changed)
    return detail


def check_testable(r: NewsSource) -> None:
    p = PROVIDERS[r.provider]
    if not p["available"]:
        raise Refused(409, "not_available", f"{p['label']} cannot be tested yet: {CLIENT_DOCS_NOTE.lower()}")
    if not secret_key_set():
        raise Refused(409, "no_secret_key", "NEWS_SECRET_KEY is not set (or not a valid key) on the server, so stored credentials cannot be read")
    missing = [k for k in required_secrets(r.provider) if k not in is_set(r)]
    if missing:
        raise Refused(409, "missing_credentials", f"{p['label']} needs {', '.join(missing)} before it can be tested")


def test_message(provider: str) -> str:
    """The message the news worker pops for a connection test (the manual-run messages are a bare run id)."""
    return json.dumps({"type": "test", "provider": provider}, separators=(",", ":"))
