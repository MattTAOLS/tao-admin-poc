"""The client's paid-source credentials (decision E8). The API stores them in news_source.secrets_enc as a Fernet token
over a JSON object of the provider's secret fields, encrypted with NEWS_SECRET_KEY from .env. The worker decrypts them
for one run and keeps them in memory only: never logged, never written back, never in a run error (scrub)."""
import json

REDACTED = "[redacted]"


class CredentialError(Exception):
    pass


def decrypt(token, key):
    """dict of secret fields. CredentialError (with no secret in its message) on a missing key or a bad token."""
    if not token:
        return {}
    if not key:
        raise CredentialError("NEWS_SECRET_KEY is not set, so the stored credentials cannot be read")
    from cryptography.fernet import Fernet, InvalidToken
    try:
        f = Fernet(key.encode("utf-8") if isinstance(key, str) else key)
    except (ValueError, TypeError):
        raise CredentialError("NEWS_SECRET_KEY is not a valid Fernet key") from None
    try:
        data = json.loads(f.decrypt(token.encode("utf-8") if isinstance(token, str) else token))
    except InvalidToken:
        raise CredentialError("the stored credentials cannot be decrypted with this NEWS_SECRET_KEY; "
                              "enter them again in System settings") from None
    except ValueError:
        raise CredentialError("the stored credentials are not a JSON object") from None
    if not isinstance(data, dict):
        raise CredentialError("the stored credentials are not a JSON object")
    return {str(k): str(v) for k, v in data.items() if v not in (None, "")}


def scrub(message, secrets):
    """Replace every secret value (and its URL-encoded form) in a message. Values shorter than 4 characters are
    ignored: they cannot be told apart from ordinary text and are not real keys."""
    import urllib.parse
    text = str(message)
    for s in sorted({str(v) for v in (secrets or ()) if v and len(str(v)) >= 4}, key=len, reverse=True):
        for form in {s, urllib.parse.quote(s, safe=""), urllib.parse.quote_plus(s)}:
            text = text.replace(form, REDACTED)
    return text
