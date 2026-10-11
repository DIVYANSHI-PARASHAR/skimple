import pytest
from skimple.models import (
    Base,
    Brand,
    FormulationIngredient,
    Ingredient,
    Product,
    ProductFormulation,
)
from skimple.transfer import transfer_database
from sqlalchemy import create_engine, event, select, text


@pytest.fixture
def databases(tmp_path):
    engines = [create_engine(f"sqlite:///{tmp_path / name}") for name in ("source", "target")]
    for engine in engines:

        @event.listens_for(engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(engine)
        with engine.begin() as db:
            db.execute(text("CREATE TABLE alembic_version (version_num TEXT)"))
            db.execute(text("INSERT INTO alembic_version VALUES ('head')"))
    source, target = engines
    with source.begin() as db:
        db.execute(
            Ingredient.__table__.insert(),
            {"id": "local", "inci_name": "Water", "synonyms": ["Aqua"]},
        )
        db.execute(Brand.__table__.insert(), {"id": "brand", "name": "Example"})
        db.execute(
            Product.__table__.insert(), {"id": "product", "brand_id": "brand", "name": "Cream"}
        )
        db.execute(
            ProductFormulation.__table__.insert(),
            {
                "id": "formula",
                "product_id": "product",
                "formula_hash": "hash",
                "raw_ingredient_text": "Water",
            },
        )
        db.execute(
            FormulationIngredient.__table__.insert(),
            {
                "formulation_id": "formula",
                "position": 1,
                "ingredient_id": "local",
                "raw_name": "Water",
            },
        )
    with target.begin() as db:
        db.execute(
            Ingredient.__table__.insert(),
            {"id": "cloud", "inci_name": "Water", "synonyms": ["Eau"]},
        )
    yield source, target
    for engine in engines:
        engine.dispose()


def test_transfer_preserves_existing_ingredients_and_all_foreign_keys(databases):
    source, target = databases
    result = transfer_database(source, target, dry_run=False)
    assert result["tables"]["formulation_ingredients"] == {
        "source": 1,
        "inserted": 1,
        "verified": 1,
    }
    with target.connect() as db:
        ingredient = db.execute(select(Ingredient.__table__)).one()
        assert ingredient.id == "cloud" and ingredient.synonyms == ["Eau", "Aqua"]
        assert db.scalar(select(FormulationIngredient.ingredient_id)) == "cloud"
    assert all(
        t["inserted"] == 0
        for t in transfer_database(source, target, dry_run=False)["tables"].values()
    )
    with source.connect() as db:
        assert db.scalar(select(Ingredient.id)) == "local"


def test_dry_run_leaves_destination_unchanged(databases):
    source, target = databases
    transfer_database(source, target)
    with target.connect() as db:
        assert db.scalar(select(Product.id)) is None
        assert db.scalar(select(Ingredient.synonyms)) == ["Eau"]


def test_conflict_rolls_back_the_entire_import(databases):
    source, target = databases
    with target.begin() as db:
        db.execute(Brand.__table__.insert(), {"id": "brand", "name": "Example"})
        db.execute(
            Product.__table__.insert(), {"id": "product", "brand_id": "brand", "name": "Changed"}
        )
    with pytest.raises(ValueError, match="Conflicting existing record in products"):
        transfer_database(source, target, dry_run=False)
    with target.connect() as db:
        assert db.scalar(select(Ingredient.synonyms)) == ["Eau"]
        assert db.scalar(select(Product.name)) == "Changed"


def test_schema_mismatch_and_same_database_are_rejected(databases):
    source, target = databases
    with pytest.raises(ValueError, match="different databases"):
        transfer_database(source, source)
    with target.begin() as db:
        db.execute(text("UPDATE alembic_version SET version_num = 'old'"))
    with pytest.raises(ValueError, match="same revision"):
        transfer_database(source, target, dry_run=False)
