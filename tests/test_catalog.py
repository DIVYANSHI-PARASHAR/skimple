from skimple.catalog import catalog_candidates
from skimple.db import SessionLocal, engine
from skimple.ingredients import formula_hash
from skimple.models import Base, Brand, Product, ProductFormulation
from skimple.schemas import Extraction


def test_known_formula_is_candidate_but_requires_user_confirmation():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        brand = Brand(name="Example")
        db.add(brand)
        db.flush()
        product = Product(brand_id=brand.id, name="Daily Cream", category="moisturizer")
        db.add(product)
        db.flush()
        formula = ProductFormulation(
            product_id=product.id,
            variant="Unscented",
            region="US",
            formula_hash=formula_hash(["Water", "Glycerin"]),
            raw_ingredient_text="Water, Glycerin",
        )
        db.add(formula)
        db.commit()
        extraction = Extraction(
            brand="Example",
            product_name="Daily Cream",
            variant="Unscented",
            ingredients_in_order=["Aqua", "Glycerin"],
        )
        candidates = catalog_candidates(db, extraction)
        assert candidates[0]["formulation_id"] == formula.id
        assert candidates[0]["match_confidence"] == 1
        assert "previously confirmed" in candidates[0]["description"]
