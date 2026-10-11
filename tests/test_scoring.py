import pytest
from skimple.db import SessionLocal, engine
from skimple.ingredients import formula_hash, normalize_name
from skimple.models import (
    Base,
    Brand,
    ClaimPaper,
    FormulationIngredient,
    Ingredient,
    IngredientClaim,
    Paper,
    Product,
    ProductFormulation,
    SkinProfile,
    User,
)
from skimple.research import study_quality
from skimple.scoring import build_report


def test_formula_hash_preserves_order_and_normalizes_aliases():
    assert normalize_name(" Aqua ") == "Water"
    assert formula_hash(["Aqua", "Glycerin"]) == formula_hash(["Water", "Glycerin"])
    assert formula_hash(["Water", "Glycerin"]) != formula_hash(["Glycerin", "Water"])


def test_quality_weights_are_bounded():
    assert study_quality(1, 1, 1, 1, 1) == 100
    assert study_quality(0, 0, 0, 0, 0) == 0
    assert study_quality(1, 0, 0, 0, 0) == 35
    with pytest.raises(ValueError):
        study_quality(2, 0, 0, 0, 0)


def test_claim_requires_reviewed_verified_nonretracted_paper():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        brand = Brand(name="Example")
        db.add(brand)
        db.flush()
        product = Product(brand_id=brand.id, name="Cream", category="moisturizer")
        db.add(product)
        db.flush()
        formula = ProductFormulation(
            product_id=product.id, formula_hash="abc", raw_ingredient_text="Glycerin"
        )
        ingredient = Ingredient(inci_name="Glycerin")
        db.add_all([formula, ingredient])
        db.flush()
        db.add(
            FormulationIngredient(
                formulation_id=formula.id,
                position=1,
                ingredient_id=ingredient.id,
                raw_name="Glycerin",
            )
        )
        paper = Paper(
            pmid="123456",
            title="Example verified record",
            source_url="https://pubmed.ncbi.nlm.nih.gov/123456/",
            metadata_json={},
        )
        db.add(paper)
        db.flush()
        claim = IngredientClaim(
            ingredient_id=ingredient.id,
            outcome="hydration",
            effect="potential_benefit",
            confidence="limited",
            synthesis="Reviewer-approved statement",
            reviewed_by=None,
        )
        db.add(claim)
        db.flush()
        db.add(ClaimPaper(claim_id=claim.id, paper_id=paper.id, relation="supports", relevance=80))
        db.commit()
        assert build_report(db, formula.id, None)["ingredient_findings"] == []
        claim.reviewed_by = "reviewer"
        db.commit()
        found = build_report(db, formula.id, None)["ingredient_findings"]
        assert found[0]["papers"][0]["url"] == paper.source_url
        assert found[0]["papers"][0]["relation"] == "supports"
        user = User(visitor_key_hash="a" * 64)
        db.add(user)
        db.flush()
        profile = SkinProfile(
            user_id=user.id,
            questionnaire={
                "known_reactions": ["glycerine"],
                "goals": ["hydration"],
                "sensitivity": "high",
            },
            derived={},
        )
        db.add(profile)
        db.commit()
        assert (
            build_report(db, formula.id, profile)["compatibility"]["classification"]
            == "known_reaction_warning"
        )
        profile.questionnaire = {
            "known_reactions": [],
            "goals": ["hydration"],
            "sensitivity": "low",
        }
        claim.effect = "potential_harm"
        db.commit()
        assert (
            build_report(db, formula.id, profile)["compatibility"]["classification"]
            == "evidence_concern"
        )
        paper.is_retracted = True
        db.commit()
        assert build_report(db, formula.id, None)["ingredient_findings"] == []
