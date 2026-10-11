from difflib import SequenceMatcher

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from skimple.ingredients import formula_hash
from skimple.models import (
    Brand,
    FormulationIngredient,
    Ingredient,
    Paper,
    Product,
    ProductFormulation,
    SkinProfile,
    StudyFinding,
)
from skimple.schemas import Extraction
from skimple.scoring import build_report


def catalog_product(db: Session, key: str, profile: SkinProfile | None = None) -> dict | None:
    row = db.execute(
        select(ProductFormulation, Product, Brand)
        .join(Product, ProductFormulation.product_id == Product.id)
        .join(Brand, Product.brand_id == Brand.id)
        .where(
            Product.catalog_key == key,
            ProductFormulation.source.in_(
                ["official_manufacturer", "authorized_retailer", "verified_catalog"]
            ),
        )
        .order_by(ProductFormulation.created_at.desc(), ProductFormulation.version.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    formula, product, brand = row
    report = build_report(db, formula.id, profile, include_alternatives=False)
    ingredients = db.execute(
        select(FormulationIngredient, Ingredient)
        .join(Ingredient)
        .where(FormulationIngredient.formulation_id == formula.id)
        .order_by(FormulationIngredient.position)
    ).all()
    literature = db.execute(
        select(StudyFinding, Paper, Ingredient)
        .join(Paper, StudyFinding.paper_id == Paper.id)
        .join(Ingredient, StudyFinding.ingredient_id == Ingredient.id)
        .where(
            StudyFinding.ingredient_id.in_([ingredient.id for _, ingredient in ingredients]),
            Paper.is_retracted.is_(False),
        )
        .order_by(Paper.year.desc(), Paper.pmid, Ingredient.inci_name)
    ).all()
    return {
        "catalog_key": key,
        "product_id": product.id,
        "formulation_id": formula.id,
        "brand": brand.name,
        "product_name": product.name,
        "category": product.category,
        "variant": formula.variant,
        "region": formula.region,
        "version": formula.version,
        "raw_ingredient_text": formula.raw_ingredient_text,
        "ingredients": [
            {
                "position": item.position,
                "raw_name": item.raw_name,
                "inci_name": ingredient.inci_name,
                "disclosed_concentration": item.disclosed_concentration,
            }
            for item, ingredient in ingredients
        ],
        "source": formula.source,
        "source_url": formula.verification_url,
        "expert_verified": bool(formula.verified_by and formula.source == "verified_catalog"),
        "source_metadata": formula.source_metadata,
        "literature": [
            {
                "ingredient": ingredient.inci_name,
                "title": paper.title,
                "year": paper.year,
                "pmid": paper.pmid,
                "doi": paper.doi,
                "url": paper.source_url,
                "outcome": finding.outcome,
                "design": finding.design,
                "population": finding.population,
                "sample_size": finding.sample_size,
                "concentration": finding.concentration,
                "effect_direction": finding.effect_direction,
                "limitations": finding.limitations,
                "status": "reviewed" if finding.reviewed_by else "awaiting_scientific_review",
            }
            for finding, paper, ingredient in literature
        ],
        "result": report,
    }


def catalog_candidates(db: Session, extraction: Extraction) -> list[dict]:
    if not extraction.brand.strip() or not extraction.product_name.strip():
        return []
    rows = db.execute(
        select(ProductFormulation, Product, Brand)
        .join(Product, ProductFormulation.product_id == Product.id)
        .join(Brand, Product.brand_id == Brand.id)
        .where(func.lower(Brand.name) == extraction.brand.strip().lower())
        .limit(100)
    ).all()
    extracted_hash = (
        formula_hash(extraction.ingredients_in_order) if extraction.ingredients_in_order else None
    )
    candidates = []
    for formula, product, brand in rows:
        name_similarity = SequenceMatcher(
            None, product.name.casefold(), extraction.product_name.strip().casefold()
        ).ratio()
        variant_similarity = SequenceMatcher(
            None, formula.variant.casefold(), extraction.variant.strip().casefold()
        ).ratio()
        score = (
            0.7 * name_similarity
            + 0.15 * variant_similarity
            + 0.15 * (formula.formula_hash == extracted_hash)
        )
        if score < 0.6:
            continue
        candidates.append(
            {
                "title": f"{brand.name} {product.name} {formula.variant}".strip(),
                "url": formula.verification_url or "",
                "source": "catalog",
                "description": f"{formula.region} formulation · "
                + {
                    "verified_catalog": "expert verified",
                    "official_manufacturer": "manufacturer ingredient list",
                    "authorized_retailer": "authorized retailer ingredient list",
                }.get(formula.source, "previously confirmed by a user"),
                "match_confidence": round(score, 2),
                "formulation_id": formula.id,
            }
        )
    return sorted(candidates, key=lambda item: item["match_confidence"], reverse=True)[:5]
