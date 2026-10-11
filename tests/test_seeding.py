import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from skimple.api import app
from skimple.catalog import catalog_product
from skimple.db import SessionLocal, engine
from skimple.ingredients import formula_hash
from skimple.models import (
    Base,
    Brand,
    FormulationIngredient,
    IngredientClaim,
    OwnedProduct,
    Paper,
    Product,
    ProductFormulation,
    ReviewObservation,
    SavedProduct,
    StudyFinding,
    User,
)
from skimple.seeding import CatalogBundle, load_catalog, seed_catalog, seed_literature
from sqlalchemy import func, select

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = ROOT / "db/seeds/products.json"
PAPERS = ROOT / "db/research/papers.json"
VISITOR = {"X-Visitor-Key": "d" * 64}


def setup_function():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def seed():
    with SessionLocal.begin() as db:
        products = seed_catalog(db, load_catalog(PRODUCTS))
        literature = seed_literature(db, PAPERS)
    return products, literature


def test_real_catalog_is_repeatable_and_keeps_evidence_unpublished():
    products, literature = seed()
    assert products["products_created"] == products["formulations_created"] == 10
    assert literature == {"papers_created": 9, "study_findings_created": 10}
    repeated, repeated_literature = seed()
    assert not any(repeated.values()) and not any(repeated_literature.values())
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Brand)) == 8
        assert db.scalar(select(func.count()).select_from(Product)) == 10
        assert db.scalar(select(func.count()).select_from(Paper)) == 9
        assert db.scalar(select(func.count()).select_from(IngredientClaim)) == 0
        assert db.scalar(select(func.count()).select_from(ReviewObservation)) == 0
        assert not db.scalars(
            select(StudyFinding).where(StudyFinding.reviewed_by.is_not(None))
        ).all()
        for entry in load_catalog(PRODUCTS).products:
            row = catalog_product(db, entry.key)
            assert row["raw_ingredient_text"] == ", ".join(entry.ingredients)
            assert [i["position"] for i in row["ingredients"]] == list(
                range(1, len(entry.ingredients) + 1)
            )
            assert not row["expert_verified"]
            assert row["result"]["ingredient_findings"] == []
            assert row["result"]["review_signal"]["observation_count"] == 0
            assert all(p["status"] == "awaiting_scientific_review" for p in row["literature"])
        ordinary = catalog_product(db, "ordinary")
        assert ordinary["ingredients"][1]["disclosed_concentration"] == "10%"
        byoma = catalog_product(db, "byoma")
        assert any(i["raw_name"] == "1,2-Hexanediol" for i in byoma["ingredients"])
        assert (
            catalog_product(db, "ordinary-squalane")["ingredients"][0]["disclosed_concentration"]
            == "100%"
        )


def test_refreshed_extraction_replaces_stale_outcome_without_duplicates(tmp_path):
    seed()
    data = json.loads(PAPERS.read_text())
    data["papers"][0]["findings"][0]["study"]["outcome"] = "updated source outcome"
    path = tmp_path / "refreshed.json"
    path.write_text(json.dumps(data))
    with SessionLocal.begin() as db:
        assert seed_literature(db, path)["study_findings_created"] == 1
    with SessionLocal.begin() as db:
        assert db.scalar(select(func.count()).select_from(StudyFinding)) == 10
        assert seed_literature(db, path)["study_findings_created"] == 0


def test_catalog_api_profile_reactions_chat_and_saved_keys():
    seed()
    client = TestClient(app)
    rows = client.get("/v1/catalog", headers=VISITOR).json()["products"]
    assert len(rows) == 10
    assert {"byoma", "ordinary", "joseon", "cerave", "laroche", "cocokind"} <= {
        r["catalog_key"] for r in rows
    }
    assert client.get("/v1/catalog").status_code == 400
    assert client.get("/v1/catalog/missing", headers=VISITOR).status_code == 404
    for kind in ("owned", "saved"):
        assert client.put(f"/v1/me/{kind}/catalog:missing", headers=VISITOR).status_code == 404
        assert client.put(f"/v1/me/{kind}/catalog:byoma", headers=VISITOR).status_code == 200
        assert client.put(f"/v1/me/{kind}/catalog:byoma", headers=VISITOR).status_code == 200
        assert client.get(f"/v1/me/{kind}", headers=VISITOR).json()["product_keys"] == [
            "catalog:byoma"
        ]
    profile = {
        "after_cleansing": "tight",
        "daytime_oiliness": "none",
        "sensitivity": "high",
        "known_reactions": ["Niacinamide"],
        "goals": ["hydration"],
    }
    assert client.put("/v1/me/skin-profile", headers=VISITOR, json=profile).status_code == 200
    row = client.get("/v1/catalog/byoma", headers=VISITOR).json()
    assert row["result"]["compatibility"]["classification"] == "known_reaction_warning"
    assert row["result"]["compatibility"]["benefit_fit_score"] is None
    reply = client.post(
        "/v1/catalog/byoma/chat", headers=VISITOR, json={"question": "How do I apply it?"}
    ).json()
    assert reply["answer"].startswith("Brand directions:")
    reply = client.post(
        "/v1/catalog/byoma/chat", headers=VISITOR, json={"question": "What is the evidence?"}
    ).json()
    assert "no reviewed" in reply["answer"]


def test_legacy_bookmarks_and_owned_products_are_merged_without_duplicates():
    with SessionLocal.begin() as db:
        user = User(visitor_key_hash="e" * 64)
        db.add(user)
        db.flush()
        for model in (SavedProduct, OwnedProduct):
            db.add_all(
                [
                    model(user_id=user.id, product_key="demo:byoma"),
                    model(user_id=user.id, product_key="catalog:byoma"),
                    model(user_id=user.id, product_key="demo:unrelated"),
                ]
            )
    products, _ = seed()
    assert products["legacy_keys_migrated"] == 2
    with SessionLocal() as db:
        for model in (SavedProduct, OwnedProduct):
            assert set(db.scalars(select(model.product_key))) == {"catalog:byoma", "demo:unrelated"}


def test_changed_formula_creates_a_version_and_keeps_original():
    seed()
    with SessionLocal() as db:
        original = catalog_product(db, "byoma")
    bundle = load_catalog(PRODUCTS)
    bundle.products = [bundle.products[0].model_copy(update={"ingredients": ["Water", "Glycerin"]})]
    with SessionLocal.begin() as db:
        result = seed_catalog(db, bundle)
        assert result["products_created"] == 0 and result["formulations_created"] == 1
    with SessionLocal() as db:
        latest = catalog_product(db, "byoma")
        assert latest["version"] == 2
        old = db.get(ProductFormulation, original["formulation_id"])
        assert old.formula_hash == formula_hash([i["raw_name"] for i in original["ingredients"]])
        assert db.scalar(
            select(func.count())
            .select_from(FormulationIngredient)
            .where(FormulationIngredient.formulation_id == old.id)
        ) == len(original["ingredients"])


def test_retracted_records_are_hidden_and_cannot_be_unretracted_by_seed():
    seed()
    with SessionLocal.begin() as db:
        paper = db.scalar(select(Paper).where(Paper.pmid == "16766489"))
        paper.is_retracted = True
    seed()
    with SessionLocal() as db:
        assert "16766489" not in {p["pmid"] for p in catalog_product(db, "ordinary")["literature"]}


def test_dry_run_transaction_rolls_back_all_rows():
    with SessionLocal.begin() as db:
        seed_catalog(db, load_catalog(PRODUCTS))
        seed_literature(db, PAPERS)
        db.rollback()
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Product)) == 0
        assert db.scalar(select(func.count()).select_from(Paper)) == 0


def test_source_refresh_invalidates_unreviewed_extractions_only(tmp_path):
    seed()
    with SessionLocal.begin() as db:
        paper = db.scalar(select(Paper).where(Paper.pmid == "32356369"))
        finding = db.scalars(select(StudyFinding).where(StudyFinding.paper_id == paper.id)).first()
        finding.reviewed_by = "Test reviewer"
        reviewed_id = finding.id
    data = json.loads(PAPERS.read_text())
    record = next(r for r in data["papers"] if r["pmid"] == "32356369")
    record["abstract"] = "Updated source abstract."
    record["findings"] = []
    refreshed = tmp_path / "refreshed.json"
    refreshed.write_text(json.dumps(data))
    with SessionLocal.begin() as db:
        seed_literature(db, refreshed)
    with SessionLocal() as db:
        rows = db.scalars(select(StudyFinding).where(StudyFinding.paper_id == paper.id)).all()
        assert [r.id for r in rows] == [reviewed_id]
        assert rows[0].reviewed_by == "Test reviewer"


def test_existing_expert_formula_approval_is_preserved():
    seed()
    with SessionLocal.begin() as db:
        row = catalog_product(db, "byoma")
        formula = db.get(ProductFormulation, row["formulation_id"])
        formula.source = "verified_catalog"
        formula.verified_by = "Test reviewer"
    seed()
    with SessionLocal() as db:
        assert catalog_product(db, "byoma")["expert_verified"]


@pytest.mark.parametrize(
    "change",
    [
        {"source_url": "http://example.org"},
        {"ingredients": ["Water", "Abbreviated demo list"]},
        {"ingredients": [""]},
        {"concentrations": {"Absent": "10%"}},
    ],
)
def test_placeholder_or_unsourced_formulas_are_rejected(change):
    data = load_catalog(PRODUCTS).model_dump(mode="json")
    data["products"][0].update(change)
    with pytest.raises(ValidationError):
        CatalogBundle.model_validate(data)
