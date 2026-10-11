import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


def uid() -> str:
    return str(uuid.uuid4())


def now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    auth_subject: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Consent(Base):
    __tablename__ = "consents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    scope: Mapped[str] = mapped_column(String(80))
    version: Mapped[str] = mapped_column(String(30))
    granted: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SkinProfile(Base):
    __tablename__ = "skin_profiles"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    questionnaire: Mapped[dict] = mapped_column(JSON_TYPE)
    derived: Mapped[dict] = mapped_column(JSON_TYPE)
    version: Mapped[str] = mapped_column(String(30), default="v1")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class SkinPhotoAssessment(Base):
    __tablename__ = "skin_photo_assessments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    media_key: Mapped[str] = mapped_column(String(500))
    observations: Mapped[dict] = mapped_column(JSON_TYPE, default=dict)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Brand(Base):
    __tablename__ = "brands"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    official_domain: Mapped[str | None] = mapped_column(String(255))


class Product(Base):
    __tablename__ = "products"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str | None] = mapped_column(String(100))
    barcode: Mapped[str | None] = mapped_column(String(80), index=True)
    __table_args__ = (UniqueConstraint("brand_id", "name", "barcode"),)


class ProductFormulation(Base):
    __tablename__ = "product_formulations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    variant: Mapped[str] = mapped_column(String(255), default="")
    region: Mapped[str] = mapped_column(String(80), default="unknown")
    formula_hash: Mapped[str] = mapped_column(String(64), index=True)
    raw_ingredient_text: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(60), default="user_confirmed_packaging")
    verified_by: Mapped[str | None] = mapped_column(String(255))
    verification_url: Mapped[str | None] = mapped_column(String(500))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint("product_id", "variant", "region", "formula_hash"),)


class Ingredient(Base):
    __tablename__ = "ingredients"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    inci_name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    synonyms: Mapped[list] = mapped_column(JSON_TYPE, default=list)


class FormulationIngredient(Base):
    __tablename__ = "formulation_ingredients"
    formulation_id: Mapped[str] = mapped_column(
        ForeignKey("product_formulations.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    ingredient_id: Mapped[str] = mapped_column(ForeignKey("ingredients.id"), index=True)
    raw_name: Mapped[str] = mapped_column(String(255))
    disclosed_concentration: Mapped[str | None] = mapped_column(String(100))


class ProductScan(Base):
    __tablename__ = "product_scans"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(255))
    front_key: Mapped[str] = mapped_column(String(500))
    back_key: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(40), default="CREATED", index=True)
    extraction: Mapped[dict | None] = mapped_column(JSON_TYPE)
    verification: Mapped[dict | None] = mapped_column(JSON_TYPE)
    formulation_id: Mapped[str | None] = mapped_column(ForeignKey("product_formulations.id"))
    error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (
        Index("ix_scans_user_created", "user_id", "created_at"),
        UniqueConstraint("user_id", "idempotency_key"),
    )


class Paper(Base):
    __tablename__ = "papers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    pmid: Mapped[str | None] = mapped_column(String(40), unique=True)
    doi: Mapped[str | None] = mapped_column(String(255), unique=True)
    openalex_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    title: Mapped[str] = mapped_column(Text)
    year: Mapped[int | None] = mapped_column(Integer)
    journal: Mapped[str | None] = mapped_column(String(255))
    source_url: Mapped[str] = mapped_column(String(500))
    metadata_json: Mapped[dict] = mapped_column(JSON_TYPE, default=dict)
    is_retracted: Mapped[bool] = mapped_column(Boolean, default=False)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class IngredientClaim(Base):
    __tablename__ = "ingredient_claims"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    ingredient_id: Mapped[str] = mapped_column(ForeignKey("ingredients.id"), index=True)
    outcome: Mapped[str] = mapped_column(String(100))
    effect: Mapped[str] = mapped_column(String(40))
    confidence: Mapped[str] = mapped_column(String(40))
    synthesis: Mapped[str] = mapped_column(Text)
    version: Mapped[str] = mapped_column(String(30), default="v1")
    reviewed_by: Mapped[str | None] = mapped_column(String(255))
    __table_args__ = (UniqueConstraint("ingredient_id", "outcome", "version"),)


class StudyFinding(Base):
    __tablename__ = "study_findings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"), index=True)
    ingredient_id: Mapped[str] = mapped_column(ForeignKey("ingredients.id"), index=True)
    outcome: Mapped[str] = mapped_column(String(100))
    route: Mapped[str] = mapped_column(String(40))
    design: Mapped[str] = mapped_column(String(80))
    population: Mapped[str] = mapped_column(Text)
    concentration: Mapped[str | None] = mapped_column(String(100))
    sample_size: Mapped[int | None] = mapped_column(Integer)
    effect_direction: Mapped[str] = mapped_column(String(30))
    limitations: Mapped[list] = mapped_column(JSON_TYPE, default=list)
    extractor_model_version: Mapped[str] = mapped_column(String(100))
    reviewed_by: Mapped[str | None] = mapped_column(String(255))
    __table_args__ = (UniqueConstraint("paper_id", "ingredient_id", "outcome"),)


class ClaimPaper(Base):
    __tablename__ = "claim_papers"
    claim_id: Mapped[str] = mapped_column(
        ForeignKey("ingredient_claims.id", ondelete="CASCADE"), primary_key=True
    )
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"), primary_key=True)
    relation: Mapped[str] = mapped_column(String(30))
    relevance: Mapped[int] = mapped_column(Integer)


class ReviewSource(Base):
    __tablename__ = "review_sources"
    domain: Mapped[str] = mapped_column(String(255), primary_key=True)
    permission_status: Mapped[str] = mapped_column(String(30), default="unverified")
    notes: Mapped[str | None] = mapped_column(Text)


class ReviewObservation(Base):
    __tablename__ = "review_observations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    formulation_id: Mapped[str] = mapped_column(ForeignKey("product_formulations.id"), index=True)
    source_domain: Mapped[str] = mapped_column(ForeignKey("review_sources.domain"))
    source_url: Mapped[str] = mapped_column(String(500))
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    aspect: Mapped[str] = mapped_column(String(80))
    sentiment: Mapped[str] = mapped_column(String(30))
    self_reported_skin: Mapped[str | None] = mapped_column(String(80))
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ProductSentiment(Base):
    __tablename__ = "product_sentiment"
    formulation_id: Mapped[str] = mapped_column(
        ForeignKey("product_formulations.id", ondelete="CASCADE"), primary_key=True
    )
    refreshed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    source_policy: Mapped[str] = mapped_column(String(500))
    source_count: Mapped[int] = mapped_column(Integer, default=0)


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    scan_id: Mapped[str] = mapped_column(ForeignKey("product_scans.id"))
    formulation_id: Mapped[str] = mapped_column(ForeignKey("product_formulations.id"))
    idempotency_key: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(40), default="CREATED")
    error_code: Mapped[str | None] = mapped_column(String(80))
    report_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key"),)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analysis_runs.id"), unique=True)
    result: Mapped[dict] = mapped_column(JSON_TYPE)
    analysis_version: Mapped[str] = mapped_column(String(30), default="v1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Feedback(Base):
    __tablename__ = "recommendation_feedback"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"))
    helpful: Mapped[bool] = mapped_column(Boolean)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
