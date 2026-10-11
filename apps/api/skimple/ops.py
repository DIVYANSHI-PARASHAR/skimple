"""Operator commands for approved sources, verified catalog entries and media expiry."""

import argparse
import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import select

from skimple.config import settings
from skimple.db import SessionLocal
from skimple.media import delete_image
from skimple.models import (
    Ingredient,
    ProductFormulation,
    ProductScan,
    ReviewSource,
    SkinPhotoAssessment,
)


def approve_review_source(domain: str, notes: str) -> None:
    if not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", domain) or not notes.strip():
        raise ValueError("Provide a domain and the documented content-use permission")
    with SessionLocal() as db:
        source = db.get(ReviewSource, domain)
        if source:
            source.permission_status = "approved"
            source.notes = notes
        else:
            db.add(ReviewSource(domain=domain, permission_status="approved", notes=notes))
        db.commit()


def verify_formulation(formulation_id: str, reviewer: str, source_url: str) -> None:
    if not reviewer.strip() or urlparse(source_url).scheme != "https":
        raise ValueError("Reviewer identity and HTTPS verification URL are required")
    with SessionLocal() as db:
        formula = db.get(ProductFormulation, formulation_id)
        if formula is None:
            raise ValueError("Formulation not found")
        formula.source = "verified_catalog"
        formula.verified_by = reviewer
        formula.verification_url = source_url
        db.commit()


def seed_ingredients(path: Path) -> int:
    entries = json.loads(path.read_text())
    with SessionLocal() as db:
        count = 0
        for entry in entries:
            if not db.scalar(select(Ingredient).where(Ingredient.inci_name == entry["inci_name"])):
                db.add(Ingredient(inci_name=entry["inci_name"], synonyms=entry.get("synonyms", [])))
                count += 1
        db.commit()
        return count


def purge_expired_media() -> dict:
    cutoff = datetime.now(UTC) - timedelta(hours=settings().s3_image_ttl_hours)
    scans_removed = 0
    photos_removed = 0
    with SessionLocal() as db:
        scans = db.scalars(select(ProductScan).where(ProductScan.created_at < cutoff)).all()
        for scan in scans:
            for key in (scan.front_key, scan.back_key):
                if key:
                    delete_image(key)
            if scan.front_key or scan.back_key:
                scans_removed += 1
            scan.front_key = ""
            scan.back_key = ""
            if scan.status in {"CREATED", "EXTRACTING", "IDENTIFYING"}:
                scan.status = "EXPIRED"
        photos = db.scalars(
            select(SkinPhotoAssessment).where(SkinPhotoAssessment.expires_at < datetime.now(UTC))
        ).all()
        for photo in photos:
            delete_image(photo.media_key)
            db.delete(photo)
            photos_removed += 1
        db.commit()
    return {"scan_images_removed": scans_removed, "face_photos_removed": photos_removed}


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    source = commands.add_parser("approve-review-source")
    source.add_argument("domain")
    source.add_argument("--permission-note", required=True)
    formula = commands.add_parser("verify-formulation")
    formula.add_argument("formulation_id")
    formula.add_argument("--reviewer", required=True)
    formula.add_argument("--source-url", required=True)
    seed = commands.add_parser("seed-ingredients")
    seed.add_argument("path", type=Path)
    commands.add_parser("purge-expired-media")
    args = parser.parse_args()
    if args.command == "approve-review-source":
        approve_review_source(args.domain, args.permission_note)
    elif args.command == "verify-formulation":
        verify_formulation(args.formulation_id, args.reviewer, args.source_url)
    elif args.command == "seed-ingredients":
        print(seed_ingredients(args.path))
    else:
        print(purge_expired_media())


if __name__ == "__main__":
    main()
