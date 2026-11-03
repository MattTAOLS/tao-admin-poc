"""SQLAlchemy models for db/migrations/001_init.sql (+ 002). Column names match the SQL exactly so the same
models run against PostgreSQL (compose) and SQLite (tests)."""
import uuid, datetime as dt
from sqlalchemy import String, Text, Integer, Numeric, Date, DateTime, ForeignKey, JSON, Uuid, UniqueConstraint, Index, text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

Json = JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql")
# SQLite stores the same dashed text PostgreSQL prints, so raw SQL (worker/validate) can match ids the API returns.
Id = Uuid(as_uuid=False).with_variant(String(36), "sqlite")
ACTIVE_UPLOAD = "status not in ('rejected', 'extraction_failed')"


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


class Deal(Base):
    __tablename__ = "deal"
    slug: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    program_slug: Mapped[str] = mapped_column(Text, ForeignKey("program.slug"))
    servicer: Mapped[str] = mapped_column(Text)
    template_id: Mapped[str] = mapped_column(Text)


class CovenantDefinition(Base):
    __tablename__ = "covenant_definition"
    id: Mapped[str] = mapped_column(Id, primary_key=True, default=new_id)
    deal_slug: Mapped[str] = mapped_column(Text, ForeignKey("deal.slug"))
    legal_ref: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    threshold: Mapped[float | None] = mapped_column(Numeric(20, 6, asdecimal=False), nullable=True)   # 003
    threshold_rule: Mapped[dict | None] = mapped_column(Json, nullable=True)
    watch_buffer_pct: Mapped[float] = mapped_column(Numeric(6, 4, asdecimal=False), default=0.1)
    effective_from: Mapped[dt.date] = mapped_column(Date)
    source: Mapped[str | None] = mapped_column(Text, nullable=True)


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
