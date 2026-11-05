"""SQLAlchemy models for db/migrations/001_init.sql (+ 002). Column names match the SQL exactly so the same
models run against PostgreSQL (compose) and SQLite (tests)."""
import uuid, datetime as dt
from sqlalchemy import String, Text, Integer, Float, Numeric, Date, DateTime, ForeignKey, JSON, Uuid, UniqueConstraint, Index, text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

Json = JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql")
# SQLite stores the same dashed text PostgreSQL prints, so raw SQL (worker/validate) can match ids the API returns.
Id = Uuid(as_uuid=False).with_variant(String(36), "sqlite")
ACTIVE_UPLOAD = "status not in ('rejected', 'extraction_failed', 'published')"      # 006


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def new_id():
    return str(uuid.uuid4())


def money(p=18, s=2):
    return Numeric(p, s, asdecimal=False)


class Base(DeclarativeBase):
    pass


class Partner(Base):
    __tablename__ = "partner"
    slug: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="active")


class Program(Base):
    __tablename__ = "program"
    slug: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    partner_slug: Mapped[str] = mapped_column(Text, ForeignKey("partner.slug"))
    currency: Mapped[str] = mapped_column(Text, default="CAD")
    limit: Mapped[float] = mapped_column("limit", money())
    warehouse_limit: Mapped[float | None] = mapped_column(money(), nullable=True)


class ProgramPartner(Base):
    """004: the partners who see a program (program.partner_slug stays as the first one)."""
    __tablename__ = "program_partner"
    program_slug: Mapped[str] = mapped_column(Text, ForeignKey("program.slug", ondelete="CASCADE"), primary_key=True)
    partner_slug: Mapped[str] = mapped_column(Text, ForeignKey("partner.slug"), primary_key=True)


class Deal(Base):
    __tablename__ = "deal"
    slug: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    program_slug: Mapped[str] = mapped_column(Text, ForeignKey("program.slug"))
    servicer: Mapped[str] = mapped_column(Text)
    template_id: Mapped[str] = mapped_column(Text)


class CovenantDefinition(Base):
    __tablename__ = "covenant_definition"
    # 007: superseded rows are kept for history; every read takes the current ones (superseded_at is null).
    __table_args__ = (Index("covenant_definition_current", "deal_slug", "legal_ref", "effective_from",
                            sqlite_where=text("superseded_at is null"), postgresql_where=text("superseded_at is null")),)
    id: Mapped[str] = mapped_column(Id, primary_key=True, default=new_id)
    deal_slug: Mapped[str] = mapped_column(Text, ForeignKey("deal.slug"))
    legal_ref: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    threshold: Mapped[float | None] = mapped_column(Numeric(20, 6, asdecimal=False), nullable=True)   # 003
    threshold_rule: Mapped[dict | None] = mapped_column(Json, nullable=True)
    watch_buffer_pct: Mapped[float] = mapped_column(Numeric(6, 4, asdecimal=False), default=0.1)
    effective_from: Mapped[dt.date] = mapped_column(Date)
    unit: Mapped[str | None] = mapped_column(Text, nullable=True)            # 004: fraction | ratio | currency
    source: Mapped[str | None] = mapped_column(Text, nullable=True)
    superseded_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)   # 007
    # 009: seed rows may be superseded by a later seed run, ui rows never (risk R11); a correction points at the row it replaced
    origin: Mapped[str] = mapped_column(Text, default="seed", server_default=text("'seed'"))
    supersedes_id: Mapped[str | None] = mapped_column(Id, ForeignKey("covenant_definition.id"), nullable=True)
    changed_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)      # null for seed rows


class SetrepUpload(Base):
    __tablename__ = "setrep_upload"
    # 002: one active (not rejected / failed) upload per deal and period; rejected ones may repeat.
    __table_args__ = (Index("setrep_upload_active_period", "deal_slug", "collection_period", unique=True,
                            sqlite_where=text(ACTIVE_UPLOAD), postgresql_where=text(ACTIVE_UPLOAD)),
                      Index("ix_setrep_upload_status", "status"))
    id: Mapped[str] = mapped_column(Id, primary_key=True, default=new_id)
    deal_slug: Mapped[str] = mapped_column(Text, ForeignKey("deal.slug"))
    collection_period: Mapped[str] = mapped_column(Text)
    reporting_period: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_name: Mapped[str] = mapped_column(Text)
    file_path: Mapped[str] = mapped_column(Text)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_by: Mapped[str] = mapped_column(Text)
    uploaded_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    status: Mapped[str] = mapped_column(Text, default="received")
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    replaces_upload_id: Mapped[str | None] = mapped_column(Id, ForeignKey("setrep_upload.id"), nullable=True)   # 006


class Extraction(Base):
    __tablename__ = "extraction"
    id: Mapped[str] = mapped_column(Id, primary_key=True, default=new_id)
    upload_id: Mapped[str] = mapped_column(Id, ForeignKey("setrep_upload.id"))
    pass_: Mapped[int] = mapped_column("pass", Integer)
    meta: Mapped[dict] = mapped_column(Json)
    deal: Mapped[dict] = mapped_column(Json)
    sources: Mapped[dict] = mapped_column(Json)
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 4, asdecimal=False), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())


class Finding(Base):
    __tablename__ = "finding"
    __table_args__ = (Index("ix_finding_extraction", "extraction_id"),)
    id: Mapped[str] = mapped_column(Id, primary_key=True, default=new_id)
    extraction_id: Mapped[str] = mapped_column(Id, ForeignKey("extraction.id"))
    rule_id: Mapped[str] = mapped_column(Text)
    layer: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(Text)
    message: Mapped[str] = mapped_column(Text)
    fields: Mapped[list | None] = mapped_column(Json, nullable=True)
    targets: Mapped[list | None] = mapped_column(Json, nullable=True)        # 005: pointers use_ours / use_report write to
    our_value: Mapped[object | None] = mapped_column(Json, nullable=True)
    report_value: Mapped[object | None] = mapped_column(Json, nullable=True)
    difference: Mapped[float | None] = mapped_column(Numeric(asdecimal=False), nullable=True)
    tolerance: Mapped[float | None] = mapped_column(Numeric(asdecimal=False), nullable=True)
    unit: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    context: Mapped[dict | None] = mapped_column(Json, nullable=True)
    status: Mapped[str] = mapped_column(Text, default="open")
    resolution: Mapped[dict | None] = mapped_column(Json, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())


class ReviewAction(Base):
    __tablename__ = "review_action"
    __table_args__ = (Index("review_action_at", "at"),)                               # 008
    id: Mapped[str] = mapped_column(Id, primary_key=True, default=new_id)
    upload_id: Mapped[str | None] = mapped_column(Id, ForeignKey("setrep_upload.id"), nullable=True)
    finding_id: Mapped[str | None] = mapped_column(Id, ForeignKey("finding.id"), nullable=True)
    actor_role: Mapped[str] = mapped_column(Text)
    actor_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    action: Mapped[str] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[dict | None] = mapped_column(Json, nullable=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())


class Publication(Base):
    __tablename__ = "publication"
    __table_args__ = (UniqueConstraint("deal_slug", "collection_period"),)
    id: Mapped[str] = mapped_column(Id, primary_key=True, default=new_id)
    upload_id: Mapped[str] = mapped_column(Id, ForeignKey("setrep_upload.id"))
    deal_slug: Mapped[str] = mapped_column(Text, ForeignKey("deal.slug"))
    collection_period: Mapped[str] = mapped_column(Text)
    published_by: Mapped[str] = mapped_column(Text)
    published_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    deal: Mapped[dict] = mapped_column(Json)
    rollup_version: Mapped[int] = mapped_column(Integer, default=1)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))                  # 009
    correction_id: Mapped[str | None] = mapped_column(Id, nullable=True)
    version_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class PublicationVersion(Base):
    """009: an earlier version of a publication, copied here before the publication is overwritten."""
    __tablename__ = "publication_version"
    __table_args__ = (UniqueConstraint("publication_id", "version"),)
    id: Mapped[str] = mapped_column(Id, primary_key=True, default=new_id)
    publication_id: Mapped[str] = mapped_column(Id, ForeignKey("publication.id"))
    version: Mapped[int] = mapped_column(Integer)
    upload_id: Mapped[str] = mapped_column(Id, ForeignKey("setrep_upload.id"))
    deal: Mapped[dict] = mapped_column(Json)
    published_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    published_by: Mapped[str] = mapped_column(Text)
    correction_id: Mapped[str | None] = mapped_column(Id, nullable=True)
    version_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())


PENDING = "status = 'needs_review'"


class Correction(Base):
    """009: a change to a published report without a new PDF. `deal` is the corrected deal object."""
    __tablename__ = "correction"
    __table_args__ = (Index("correction_status", "status"),
                      Index("correction_one_pending", "upload_id", unique=True, sqlite_where=text(PENDING), postgresql_where=text(PENDING)))
    id: Mapped[str] = mapped_column(Id, primary_key=True, default=new_id)
    upload_id: Mapped[str] = mapped_column(Id, ForeignKey("setrep_upload.id"))
    publication_id: Mapped[str] = mapped_column(Id, ForeignKey("publication.id"))
    status: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    note_to_partners: Mapped[str | None] = mapped_column(Text, nullable=True)
    deal: Mapped[dict] = mapped_column(Json)
    findings: Mapped[list | None] = mapped_column(Json, nullable=True)
    finding_counts: Mapped[dict | None] = mapped_column(Json, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    created_by: Mapped[str] = mapped_column(Text)
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class ValueEdit(Base):
    """009: one TAO Admin change to an extracted number. Review edits have no correction_id; a correction's edits do."""
    __tablename__ = "value_edit"
    __table_args__ = (Index("value_edit_upload", "upload_id"),)
    id: Mapped[str] = mapped_column(Id, primary_key=True, default=new_id)
    upload_id: Mapped[str] = mapped_column(Id, ForeignKey("setrep_upload.id"))
    correction_id: Mapped[str | None] = mapped_column(Id, ForeignKey("correction.id"), nullable=True)
    pointer: Mapped[str] = mapped_column(Text)
    old_value: Mapped[float] = mapped_column(Float)
    new_value: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(Text)
    source_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor_role: Mapped[str] = mapped_column(Text)
    actor_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    reverted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reverted_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    revert_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
