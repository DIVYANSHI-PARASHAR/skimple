"""Transactional, repeatable imports of sourced catalog data and staged literature.

No claims, expert approvals, review permissions, users or reports are fabricated.
"""

import json
from datetime import date
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from skimple.ingredients import formula_hash, normalize_name
from skimple.models import (
    Brand,
    FormulationIngredient,
    Ingredient,
    OwnedProduct,
    Paper,
    Product,
    ProductFormulation,
    SavedProduct,
    StudyFinding,
)
from skimple.research import ExtractedStudy


class CatalogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,109}$")
    brand: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=255)
    category: Literal["cleanser", "serum", "moisturizer", "sunscreen", "exfoliant"]
    region: str = Field(min_length=2, max_length=80)
    variant: str = Field(min_length=1, max_length=255)
    source_url: str = Field(max_length=500)
    source_type: Literal["official_manufacturer", "authorized_retailer"]
    retrieved_on: date
    ingredients: list[str] = Field(min_length=1, max_length=200)
    concentrations: dict[str, str] = Field(default_factory=dict)
    additional_sources: list[str] = Field(default_factory=list)
    summary: str = Field(min_length=1)
    usage: str = Field(min_length=1)
    notes: str = ""

    @model_validator(mode="after")
    def validate_source_and_formula(self):
        for url in [self.source_url, *self.additional_sources]:
            parsed = urlparse(url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username:
                raise ValueError("Catalog sources must be public HTTPS URLs")
        if self.retrieved_on > date.today():
            raise ValueError("Source retrieval cannot be in the future")
        if any(not name.strip() or len(name) > 255 for name in self.ingredients):
            raise ValueError("Ingredients must be nonempty names of at most 255 characters")
        if any(word in " ".join(self.ingredients).lower() for word in ("demo", "abbreviated")):
            raise ValueError("Placeholder formulas cannot be seeded")
        if not set(self.concentrations) <= set(self.ingredients):
            raise ValueError("Concentrations must name ingredients present in the formula")
        if any(len(value) > 100 for value in self.concentrations.values()):
            raise ValueError("Concentration is too long")
        return self


class CatalogBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    researched_on: date
    products: list[CatalogEntry] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_keys(self):
        if len({p.key for p in self.products}) != len(self.products):
            raise ValueError("Duplicate catalog keys")
        return self


def load_catalog(path: Path) -> CatalogBundle:
    return CatalogBundle.model_validate_json(path.read_text())


def _ingredient(db: Session, raw: str) -> Ingredient:
    name = normalize_name(raw)
    ingredient = db.scalar(
        select(Ingredient).where(func.lower(Ingredient.inci_name) == name.lower())
    )
    if ingredient is None:
        ingredient = Ingredient(inci_name=name)
        db.add(ingredient)
        db.flush()
    return ingredient


def seed_catalog(db: Session, bundle: CatalogBundle) -> dict:
    """Caller owns the transaction; changed formulas get a new immutable version."""
    counts = {"products_created": 0, "formulations_created": 0, "legacy_keys_migrated": 0}
    for entry in bundle.products:
        brand = db.scalar(select(Brand).where(func.lower(Brand.name) == entry.brand.lower()))
        if brand is None:
            official_url = (
                entry.additional_sources[0] if entry.additional_sources else entry.source_url
            )
            brand = Brand(name=entry.brand, official_domain=urlparse(official_url).hostname)
            db.add(brand)
            db.flush()
        product = db.scalar(select(Product).where(Product.catalog_key == entry.key))
        if product and product.brand_id != brand.id:
            raise ValueError(f"Catalog key {entry.key} already belongs to a different brand")
        if product is None:
            # Adopt a matching shared product without replacing scans or private reports.
            product = db.scalar(
                select(Product).where(
                    Product.brand_id == brand.id,
                    Product.name == entry.name,
                    Product.catalog_key.is_(None),
                    Product.barcode.is_(None),
                )
            )
        if product is None:
            product = Product(brand_id=brand.id, name=entry.name, category=entry.category)
            db.add(product)
            counts["products_created"] += 1
        product.catalog_key = entry.key
        product.name = entry.name
        product.category = entry.category
        db.flush()
        digest = formula_hash(entry.ingredients)
        formula = db.scalar(
            select(ProductFormulation).where(
                ProductFormulation.product_id == product.id,
                ProductFormulation.variant == entry.variant,
                ProductFormulation.region == entry.region,
                ProductFormulation.formula_hash == digest,
            )
        )
        if formula is None:
            version = (
                db.scalar(
                    select(func.max(ProductFormulation.version)).where(
                        ProductFormulation.product_id == product.id,
                        ProductFormulation.variant == entry.variant,
                        ProductFormulation.region == entry.region,
                    )
                )
                or 0
            )
            formula = ProductFormulation(
                product_id=product.id,
                variant=entry.variant,
                region=entry.region,
                formula_hash=digest,
                raw_ingredient_text=", ".join(entry.ingredients),
                source=entry.source_type,
                verification_url=entry.source_url,
                version=version + 1,
            )
            db.add(formula)
            db.flush()
            counts["formulations_created"] += 1
        # Preserve expert approval on a previously verified identical formula.
        if formula.source != "verified_catalog":
            formula.source = entry.source_type
            formula.verification_url = entry.source_url
        formula.source_metadata = entry.model_dump(mode="json", exclude={"ingredients"})
        existing = db.scalars(
            select(FormulationIngredient)
            .where(
                FormulationIngredient.formulation_id == formula.id,
            )
            .order_by(FormulationIngredient.position)
        ).all()
        if existing and formula_hash([row.raw_name for row in existing]) != digest:
            raise ValueError(f"Stored ingredient order disagrees with formula hash: {entry.key}")
        for item, raw in zip(existing, entry.ingredients):
            item.disclosed_concentration = entry.concentrations.get(raw)
        if not existing:
            for position, raw in enumerate(entry.ingredients, 1):
                ingredient = _ingredient(db, raw)
                db.add(
                    FormulationIngredient(
                        formulation_id=formula.id,
                        position=position,
                        ingredient_id=ingredient.id,
                        raw_name=raw,
                        disclosed_concentration=entry.concentrations.get(raw),
                    )
                )
        for model in (SavedProduct, OwnedProduct):
            for legacy in db.scalars(select(model).where(model.product_key == f"demo:{entry.key}")):
                key = f"catalog:{entry.key}"
                if not db.get(model, (legacy.user_id, key)):
                    db.add(
                        model(user_id=legacy.user_id, product_key=key, created_at=legacy.created_at)
                    )
                db.delete(legacy)
                counts["legacy_keys_migrated"] += 1
    db.flush()
    return counts


def seed_literature(db: Session, path: Path) -> dict:
    """Import verified PubMed snapshots and explicitly unreviewed abstract extractions."""
    data = json.loads(path.read_text())
    counts = {"papers_created": 0, "study_findings_created": 0}
    for record in data["papers"]:
        pmid = record["pmid"]
        if not pmid.isdigit() or record["source_url"] != f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/":
            raise ValueError("Invalid PubMed identity in literature snapshot")
        if not record["title"].strip():
            raise ValueError("Paper title is required")
        enrichment = record.get("openalex", {})
        paper = db.scalar(select(Paper).where(Paper.pmid == pmid))
        if paper is None:
            paper = Paper(
                pmid=pmid,
                doi=record.get("doi"),
                title=record["title"],
                journal=record.get("journal"),
                year=record.get("year"),
                source_url=record["source_url"],
                openalex_id=enrichment.get("openalex_id"),
                is_retracted=record.get("is_retracted", False)
                or enrichment.get("is_retracted", False),
                metadata_json={
                    "abstract": record.get("abstract", ""),
                    "source_retrieved_on": record["retrieved_on"],
                    "authors": record.get("authors", []),
                    "openalex_status": record.get("openalex_status", "not_requested"),
                    "cited_by_count": enrichment.get("cited_by_count"),
                    "fwci": enrichment.get("fwci"),
                    "search_method": data["method"],
                    "extractor_model_version": record.get("extractor_model_version"),
                    "extraction_source_check": record.get("source_check", {}),
                },
            )
            db.add(paper)
            db.flush()
            counts["papers_created"] += 1
        else:
            if paper.metadata_json.get("abstract") != record.get("abstract", ""):
                db.execute(
                    delete(StudyFinding).where(
                        StudyFinding.paper_id == paper.id, StudyFinding.reviewed_by.is_(None)
                    )
                )
            paper.metadata_json = {
                **paper.metadata_json,
                "abstract": record.get("abstract", ""),
                "source_retrieved_on": record["retrieved_on"],
                "authors": record.get("authors", []),
                "openalex_status": record.get("openalex_status", "not_requested"),
                "cited_by_count": enrichment.get("cited_by_count"),
                "fwci": enrichment.get("fwci"),
                "extractor_model_version": record.get("extractor_model_version"),
                "extraction_source_check": record.get("source_check", {}),
            }
            if record.get("is_retracted") or enrichment.get("is_retracted"):
                paper.is_retracted = True
        expected = {
            (entry["ingredient"], entry["study"]["outcome"]) for entry in record.get("findings", [])
        }
        for staged, name in db.execute(
            select(StudyFinding, Ingredient.inci_name)
            .join(Ingredient, StudyFinding.ingredient_id == Ingredient.id)
            .where(StudyFinding.paper_id == paper.id, StudyFinding.reviewed_by.is_(None))
        ):
            if (name, staged.outcome) not in expected:
                db.delete(staged)
        for entry in record.get("findings", []):
            finding = ExtractedStudy.model_validate(entry["study"])
            ingredient = _ingredient(db, entry["ingredient"])
            existing = db.scalar(
                select(StudyFinding).where(
                    StudyFinding.paper_id == paper.id,
                    StudyFinding.ingredient_id == ingredient.id,
                    StudyFinding.outcome == finding.outcome,
                )
            )
            if existing:
                if not existing.reviewed_by:
                    for key, value in finding.model_dump(
                        exclude={"topical_human_relevance"}
                    ).items():
                        setattr(existing, key, value)
                    existing.extractor_model_version = record.get(
                        "extractor_model_version", "codex-abstract-extraction-v1"
                    )
                continue
            db.add(
                StudyFinding(
                    paper_id=paper.id,
                    ingredient_id=ingredient.id,
                    **finding.model_dump(exclude={"topical_human_relevance"}),
                    extractor_model_version=record.get(
                        "extractor_model_version", "codex-abstract-extraction-v1"
                    ),
                    reviewed_by=None,
                )
            )
            counts["study_findings_created"] += 1
    db.flush()
    return counts
