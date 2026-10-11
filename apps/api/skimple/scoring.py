from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from skimple.ingredients import normalize_name
from skimple.models import (
    Brand,
    ClaimPaper,
    FormulationIngredient,
    Ingredient,
    IngredientClaim,
    Paper,
    Product,
    ProductFormulation,
    ProductSentiment,
    ReviewObservation,
    SkinProfile,
)

ANALYSIS_VERSION = "v1"
GOAL_OUTCOMES = {
    "hydration": {"hydration", "skin_barrier_support"},
    "barrier": {"skin_barrier_support", "transepidermal_water_loss"},
    "blemishes": {"acne_related_outcomes"},
    "tone": {"hyperpigmentation"},
    "texture": {"skin_texture"},
}


def build_report(
    db: Session,
    formulation_id: str,
    profile: SkinProfile | None,
    *,
    include_alternatives: bool = True,
) -> dict:
    rows = db.execute(
        select(FormulationIngredient, Ingredient)
        .join(Ingredient)
        .where(FormulationIngredient.formulation_id == formulation_id)
        .order_by(FormulationIngredient.position)
    ).all()
    names = [ingredient.inci_name for _, ingredient in rows]
    questionnaire = profile.questionnaire if profile else {}
    goals = set(questionnaire.get("goals", []))
    reactions = {
        normalize_name(name).casefold() for name in questionnaire.get("known_reactions", [])
    }
    matched_reactions = [name for name in names if name.casefold() in reactions]
    findings = []
    for _, ingredient in rows:
        claims = db.scalars(
            select(IngredientClaim).where(
                IngredientClaim.ingredient_id == ingredient.id,
                IngredientClaim.reviewed_by.is_not(None),
            )
        ).all()
        for claim in claims:
            links = db.scalars(select(ClaimPaper).where(ClaimPaper.claim_id == claim.id)).all()
            verified = [(db.get(Paper, link.paper_id), link.relation) for link in links]
            verified = [
                (paper, relation)
                for paper, relation in verified
                if paper and not paper.is_retracted
            ]
            if not verified:
                continue
            findings.append(
                {
                    "ingredient": ingredient.inci_name,
                    "outcome": claim.outcome,
                    "effect": claim.effect,
                    "evidence_confidence": claim.confidence,
                    "claim_id": claim.id,
                    "paper_ids": [paper.id for paper, _ in verified],
                    "papers": [
                        {
                            "id": paper.id,
                            "title": paper.title,
                            "year": paper.year,
                            "url": paper.source_url,
                            "pmid": paper.pmid,
                            "doi": paper.doi,
                            "relation": relation,
                        }
                        for paper, relation in verified
                    ],
                    "synthesis": claim.synthesis,
                }
            )
    useful = [
        f
        for f in findings
        if f["effect"] == "potential_benefit"
        and any(f["outcome"] in GOAL_OUTCOMES.get(goal, set()) for goal in goals)
    ]
    concerning = [f for f in findings if f["effect"] in {"potential_harm", "irritation_risk"}]
    benefit_score = min(100, 20 * len(useful)) if goals and findings else None
    limitations = ["Ingredient concentrations and final formula behavior are not verified."]
    if not profile:
        limitations.append("No skin questionnaire was provided.")
    if not findings:
        limitations.append(
            "No reviewed, source-linked ingredient claims are available for this formula."
        )
    if matched_reactions:
        classification = "known_reaction_warning"
        concern = "known_reaction"
    elif concerning:
        classification = "evidence_concern"
        concern = "evidence_supported_risk"
    elif not profile or not findings:
        classification = "uncertain"
        concern = "uncertain"
    else:
        classification = "possibly_suitable" if useful else "uncertain"
        concern = "higher" if questionnaire.get("sensitivity") == "high" else "uncertain"
    confidence = (
        "moderate"
        if any(f["evidence_confidence"] in {"strong", "moderate"} for f in findings)
        else "limited"
    )
    observations = db.scalars(
        select(ReviewObservation).where(ReviewObservation.formulation_id == formulation_id)
    ).all()
    aspects = Counter((r.aspect, r.sentiment) for r in observations)
    sources = sorted({r.source_domain for r in observations})
    review_cache = db.get(ProductSentiment, formulation_id)
    alternatives = []
    if include_alternatives and profile:
        current = db.get(ProductFormulation, formulation_id)
        current_product = db.get(Product, current.product_id) if current else None
        if current_product and current_product.category not in {None, "other"}:
            candidates = db.execute(
                select(ProductFormulation, Product, Brand)
                .join(Product, ProductFormulation.product_id == Product.id)
                .join(Brand, Product.brand_id == Brand.id)
                .where(
                    Product.category == current_product.category,
                    ProductFormulation.source == "verified_catalog",
                    ProductFormulation.id != formulation_id,
                )
                .limit(20)
            ).all()
            for candidate, product, brand in candidates:
                candidate_report = build_report(
                    db, candidate.id, profile, include_alternatives=False
                )
                compatibility = candidate_report["compatibility"]
                if (
                    compatibility["known_reaction_ingredients"]
                    or not candidate_report["ingredient_findings"]
                    or compatibility["benefit_fit_score"] is None
                    or compatibility["benefit_fit_score"] <= (benefit_score or 0)
                ):
                    continue
                alternatives.append(
                    {
                        "formulation_id": candidate.id,
                        "brand": brand.name,
                        "product_name": product.name,
                        "variant": candidate.variant,
                        "category": product.category,
                        "benefit_fit_score": compatibility["benefit_fit_score"],
                        "confidence": compatibility["confidence"],
                        "reason": "A verified formula in the same category with reviewed, source-linked claims.",
                        "limitations": compatibility["limitations"],
                    }
                )
            alternatives.sort(key=lambda a: a["benefit_fit_score"] or 0, reverse=True)
    return {
        "formulation_id": formulation_id,
        "compatibility": {
            "classification": classification,
            "benefit_fit_score": benefit_score,
            "irritation_concern": concern,
            "confidence": confidence,
            "known_reaction_ingredients": matched_reactions,
            "limitations": limitations,
        },
        "ingredient_findings": findings,
        "review_signal": {
            "observation_count": len(observations),
            "source_count": len(sources),
            "last_refreshed": review_cache.refreshed_at.isoformat() if review_cache else None,
            "sources": sources,
            "source_urls": sorted({r.source_url for r in observations})[:10],
            "aspects": [
                {"aspect": a, "sentiment": s, "count": count} for (a, s), count in aspects.items()
            ],
            "note": "Reviews are self-reported experiences, not clinical evidence.",
        },
        "alternatives": alternatives[:3],
        "analysis_version": ANALYSIS_VERSION,
        "disclaimer": "Educational information only. This is not a diagnosis or treatment recommendation.",
    }
