"""Copy a local database without replacing existing TigerData records.

Only starter ingredients may have different IDs: their synonyms are merged and
all incoming foreign keys are translated. Other conflicts abort the transaction.
"""

import argparse
import json
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import Engine

from skimple.models import Base


def transfer_database(source: Engine, target: Engine, *, dry_run: bool = True) -> dict:
    if source.url == target.url:
        raise ValueError("Source and destination must be different databases")
    counts = {}
    ingredient_ids = {}
    with source.connect() as src, target.begin() as dst:
        if src.dialect.name == "postgresql":
            src = src.execution_options(isolation_level="REPEATABLE READ")
            src.execute(text("SET TRANSACTION READ ONLY"))
        if dst.dialect.name == "postgresql":
            # Prevent concurrent writers while checking and importing the snapshot.
            names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
            dst.execute(text(f"LOCK TABLE {names} IN SHARE ROW EXCLUSIVE MODE"))
        source_revision = src.scalar(text("SELECT version_num FROM alembic_version"))
        if source_revision != dst.scalar(text("SELECT version_num FROM alembic_version")):
            raise ValueError("Migrate both databases to the same revision before transferring")
        for table in Base.metadata.sorted_tables:
            rows = [dict(row) for row in src.execute(select(table)).mappings()]
            inserted = 0
            for row in rows:
                for column in table.columns:
                    if any(fk.target_fullname == "ingredients.id" for fk in column.foreign_keys):
                        row[column.name] = ingredient_ids[row[column.name]]
                if table.name == "ingredients":
                    existing = (
                        dst.execute(select(table).where(table.c.inci_name == row["inci_name"]))
                        .mappings()
                        .first()
                    )
                    source_id = row["id"]
                    if existing:
                        row["id"] = existing["id"]
                        row["synonyms"] = list(
                            dict.fromkeys(existing["synonyms"] + row["synonyms"])
                        )
                        dst.execute(
                            table.update()
                            .where(table.c.id == row["id"])
                            .values(synonyms=row["synonyms"])
                        )
                    ingredient_ids[source_id] = row["id"]
                predicate = [column == row[column.name] for column in table.primary_key]
                existing = dst.execute(select(table).where(*predicate)).mappings().first()
                if existing is None:
                    dst.execute(table.insert().values(**row))
                    inserted += 1
                elif dict(existing) != row:
                    raise ValueError(f"Conflicting existing record in {table.name}; nothing copied")
            # Verify values and relationships, not just row counts, before committing.
            for row in rows:
                predicate = [column == row[column.name] for column in table.primary_key]
                copied = dst.execute(select(table).where(*predicate)).mappings().one()
                if dict(copied) != row:
                    raise ValueError(f"Verification failed in {table.name}; nothing copied")
            counts[table.name] = {"source": len(rows), "inserted": inserted, "verified": len(rows)}
        if dry_run:
            dst.rollback()
    return {"dry_run": dry_run, "revision": source_revision, "tables": counts}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-env-file", type=Path, required=True)
    parser.add_argument("--target-env-file", type=Path, default=Path(".env"))
    parser.add_argument("--apply", action="store_true", help="Commit the verified import")
    args = parser.parse_args()
    source = create_engine(dotenv_values(args.source_env_file)["DATABASE_URL"])
    target = create_engine(dotenv_values(args.target_env_file)["DATABASE_URL"])
    try:
        print(json.dumps(transfer_database(source, target, dry_run=not args.apply), indent=2))
    finally:
        source.dispose()
        target.dispose()


if __name__ == "__main__":
    main()
