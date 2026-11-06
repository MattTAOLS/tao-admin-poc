"""Wave C comment threads (contract Thread, Comment). Internal to TAO: never in a partner response or notification.
A thread lives on the upload, so a correction (same upload, next version) keeps it; a corrected re-issue (new upload) also
lists the threads of the uploads it replaced. Comments are never deleted; an edit keeps the old text in the audit log."""
from sqlalchemy import select
from sqlalchemy.orm import Session
from .auth import TAO
from .models import AppUser, Thread, Comment, SetrepUpload, Finding, Extraction
from . import notify, people, views, review


def author(s: Session, user_id: str | None) -> dict | None:
    if user_id is None:
        return None
    u = s.get(AppUser, user_id)
    return {"id": user_id, "name": u.name if u else user_id}


def comment_dict(s: Session, c: Comment) -> dict:
    return {"id": c.id, "thread_id": c.thread_id, "author": author(s, c.author_id), "body": c.body, "mentions": list(c.mentions or []),
            "created_at": views.iso(c.created_at), "edited_at": views.iso(c.edited_at)}


def anchor(t: Thread) -> dict:
    out = {"finding_id": t.finding_id} if t.finding_id else {"pointer": t.pointer}
    out["rule_id"] = t.rule_id
    return out


def thread_dict(s: Session, t: Thread) -> dict:
    comments = s.scalars(select(Comment).where(Comment.thread_id == t.id).order_by(Comment.created_at, Comment.id)).all()
    return {"id": t.id, "upload_id": t.upload_id, "anchor": anchor(t), "status": t.status, "version": t.version,
            "created_by": author(s, t.created_by), "created_at": views.iso(t.created_at), "resolved_by": author(s, t.resolved_by),
            "resolved_at": views.iso(t.resolved_at), "comments": [comment_dict(s, c) for c in comments]}


def upload_chain(s: Session, u: SetrepUpload) -> list[str]:
    """The upload and every upload it replaced (a re-issue chain), newest first."""
    ids, cur, seen = [], u, set()
    while cur is not None and cur.id not in seen:
        ids.append(cur.id); seen.add(cur.id)
        cur = s.get(SetrepUpload, cur.replaces_upload_id) if cur.replaces_upload_id else None
    return ids


def threads_of(s: Session, u: SetrepUpload, status: str | None = None) -> list[Thread]:
    q = select(Thread).where(Thread.upload_id.in_(upload_chain(s, u)))
    if status:
        q = q.where(Thread.status == status)
    rows = s.scalars(q.order_by(Thread.created_at, Thread.id)).all()
    return sorted(rows, key=lambda t: t.status != "open")                 # open first, each group oldest first


def check_anchor(s: Session, u: SetrepUpload, finding_id: str | None, pointer: str | None) -> tuple[str | None, str | None, str | None]:
    """(finding_id, pointer, rule_id); 422 invalid when the finding is not on this upload or the pointer not in its extraction."""
    if (finding_id is None) == (pointer is None):
        raise people.Refused(422, "invalid", "anchor needs exactly one of finding_id or pointer")
    if finding_id is not None:
        f = s.get(Finding, finding_id) if views_is_uuid(finding_id) else None
        ex = s.get(Extraction, f.extraction_id) if f is not None else None
        if ex is None or ex.upload_id != u.id:
            raise people.Refused(422, "invalid", "that finding is not on this upload")
        return f.id, None, f.rule_id
    ex = views.latest_extraction(s, u.id)
    if ex is None or review._walk(ex.deal, pointer) is None:
        raise people.Refused(422, "invalid", f"{pointer} is not a value in this upload's extraction")
    return None, pointer, None


def views_is_uuid(v: str) -> bool:
    from .auth import UUID
    return bool(UUID.match(v or ""))


def check_mentions(s: Session, ids: list[str]) -> list[str]:
    """Active TAO users only (422 bad_mention); duplicates dropped, order kept."""
    out = []
    for i in dict.fromkeys(ids):
        u = s.get(AppUser, i) if views_is_uuid(i) else None
        if u is None or u.status != "active" or u.role not in TAO:
            raise people.Refused(422, "bad_mention", "mentions name active TAO users only")
        out.append(u.id)
    return out


def _where(s: Session, t: Thread) -> str:
    up = s.get(SetrepUpload, t.upload_id)
    on = t.rule_id or t.pointer or "a finding"
    return f"{notify._deal_name(s, up.deal_slug)} · {notify.month_label(up.collection_period)}, {on}"


def _preview(body: str) -> str:
    return body if len(body) <= 280 else body[:277] + "..."


def notify_comment(s: Session, t: Thread, c: Comment, by: AppUser, new_mentions: list[str], reply: bool) -> None:
    """Mentions: each newly mentioned person once (not the author). Replies: the thread's other people (starter and earlier
    authors) who were not just mentioned. TAO users only, by construction."""
    up = s.get(SetrepUpload, t.upload_id)
    fields = dict(body=_preview(c.body), upload_id=up.id, deal_slug=up.deal_slug, collection_period=up.collection_period, thread_id=t.id)
    link = notify.review_link(up.id, t.id)
    told = set()
    for uid in new_mentions:
        if uid == by.id:
            continue
        notify.create(s, s.get(AppUser, uid), "mention", f"{by.name} mentioned you: {_where(s, t)}", link, **fields)
        told.add(uid)
    if not reply:
        return
    people_in = [t.created_by] + list(s.scalars(select(Comment.author_id).where(Comment.thread_id == t.id, Comment.id != c.id)).all())
    for uid in dict.fromkeys(people_in):
        if uid == by.id or uid in told:
            continue
        u = s.get(AppUser, uid)
        if u is not None and u.role in TAO:
            notify.create(s, u, "reply", f"{by.name} replied: {_where(s, t)}", link, **fields)
