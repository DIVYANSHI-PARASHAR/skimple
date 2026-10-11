from difflib import SequenceMatcher

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from skimple.ingredients import formula_hash
from skimple.models import Brand, Product, ProductFormulation
from skimple.schemas import Extraction


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
                "description": f"{formula.region} formulation · {'expert verified' if formula.source == 'verified_catalog' else 'previously confirmed by a user'}",
                "match_confidence": round(score, 2),
                "formulation_id": formula.id,
            }
        )
    return sorted(candidates, key=lambda item: item["match_confidence"], reverse=True)[:5]
