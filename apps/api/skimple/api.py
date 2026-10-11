import logging
from datetime import UTC, datetime, timedelta

import sentry_sdk
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from skimple.config import settings
from skimple.db import get_db
from skimple.ingredients import formula_hash, normalize_name
from skimple.jobs import enqueue, run_analysis, run_extraction
from skimple.limits import enforce_rate_limit
from skimple.media import delete_image, put_image, validated_image
from skimple.models import (
    AnalysisRun,
    Brand,
    Consent,
    Feedback,
    FormulationIngredient,
    Ingredient,
    Product,
    ProductFormulation,
    ProductScan,
    Report,
    SkinPhotoAssessment,
    SkinProfile,
    User,
    uid,
)
from skimple.providers import observe_skin
from skimple.schemas import AnalysisRequest, ConfirmRequest, FeedbackRequest, ProfileRequest
from skimple.visitor import current_user

log = logging.getLogger(__name__)

if settings().sentry_dsn:
    sentry_sdk.init(
        dsn=settings().sentry_dsn,
        traces_sample_rate=0.2,
        send_default_pii=False,
        max_request_body_size="never",
    )

app = FastAPI(title="Skimple API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in settings().allowed_origins.split(",")],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["X-Visitor-Key", "Content-Type", "Idempotency-Key", "sentry-trace", "baggage"],
    expose_headers=["sentry-trace", "baggage"],
)


def owned(db: Session, model, identifier: str, user: User):
    item = db.get(model, identifier)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "Not found")
    return item


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/v1/scans", status_code=202)
def create_scan(
    front: UploadFile = File(...),
    back: UploadFile = File(...),
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=8, max_length=255),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    existing = db.scalar(
        select(ProductScan).where(
            ProductScan.user_id == user.id, ProductScan.idempotency_key == idempotency_key
        )
    )
    if existing:
        return {"scan_id": existing.id, "status": existing.status}
    enforce_rate_limit(user.id, "scan", 20)
    front_data, front_mime = validated_image(front)
    back_data, back_mime = validated_image(back)
    scan = ProductScan(user_id=user.id, idempotency_key=idempotency_key, front_key="", back_key="")
    db.add(scan)
    db.flush()
    scan.front_key = f"scans/{user.id}/{scan.id}/front"
    scan.back_key = f"scans/{user.id}/{scan.id}/back"
    try:
        put_image(scan.front_key, front_data, front_mime)
        put_image(scan.back_key, back_data, back_mime)
        db.commit()
        enqueue("scans", run_extraction, scan.id)
    except Exception as exc:
        db.rollback()
        persisted = db.get(ProductScan, scan.id)
        if persisted:
            db.delete(persisted)
            db.commit()
        for key in (scan.front_key, scan.back_key):
            try:
                delete_image(key)
            except Exception:
                log.warning("Unable to remove failed scan object %s", key, exc_info=True)
        raise HTTPException(503, "Scan storage or queue unavailable") from exc
    return {"scan_id": scan.id, "status": scan.status}


@app.get("/v1/scans/{scan_id}")
def get_scan(scan_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    scan = owned(db, ProductScan, scan_id, user)
    return {
        "scan_id": scan.id,
        "status": scan.status,
        "extraction": scan.extraction,
        "verification": scan.verification,
        "formulation_id": scan.formulation_id,
        "error_code": scan.error_code,
    }


@app.post("/v1/scans/{scan_id}/confirm")
def confirm_scan(
    scan_id: str,
    body: ConfirmRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    scan = owned(db, ProductScan, scan_id, user)
    if scan.status == "CONFIRMED":
        return {"scan_id": scan.id, "formulation_id": scan.formulation_id, "status": scan.status}
    if scan.status != "NEEDS_CONFIRMATION":
        raise HTTPException(409, "Scan is not ready for confirmation")
    with sentry_sdk.start_span(op="scan.confirm_formulation"):
        brand = db.scalar(select(Brand).where(Brand.name == body.brand.strip()))
        if not brand:
            brand = Brand(name=body.brand.strip())
            db.add(brand)
            db.flush()
        product = db.scalar(
            select(Product).where(
                Product.brand_id == brand.id,
                Product.name == body.product_name.strip(),
                Product.barcode == (body.barcode or None),
            )
        )
        if not product:
            product = Product(
                brand_id=brand.id,
                name=body.product_name.strip(),
                category=body.category,
                barcode=body.barcode or None,
            )
            db.add(product)
            db.flush()
        digest = formula_hash(body.ingredients_in_order)
        formula = db.scalar(
            select(ProductFormulation).where(
                ProductFormulation.product_id == product.id,
                ProductFormulation.variant == body.variant,
                ProductFormulation.region == body.region,
                ProductFormulation.formula_hash == digest,
            )
        )
        if not formula:
            formula = ProductFormulation(
                product_id=product.id,
                variant=body.variant,
                region=body.region,
                formula_hash=digest,
                raw_ingredient_text=body.raw_ingredient_text,
            )
            db.add(formula)
            db.flush()
            for position, raw_name in enumerate(body.ingredients_in_order, start=1):
                canonical = normalize_name(raw_name)
                ingredient = db.scalar(select(Ingredient).where(Ingredient.inci_name == canonical))
                if not ingredient:
                    ingredient = Ingredient(inci_name=canonical)
                    db.add(ingredient)
                    db.flush()
                db.add(
                    FormulationIngredient(
                        formulation_id=formula.id,
                        position=position,
                        ingredient_id=ingredient.id,
                        raw_name=raw_name.strip(),
                    )
                )
        scan.formulation_id = formula.id
        scan.status = "CONFIRMED"
        db.commit()
    return {"scan_id": scan.id, "formulation_id": formula.id, "status": scan.status}


@app.put("/v1/me/skin-profile")
def put_profile(
    body: ProfileRequest, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    profile = db.get(SkinProfile, user.id)
    derived = {
        "basis": "questionnaire",
        "confidence": "limited" if body.after_cleansing == "unsure" else "moderate",
    }
    if profile:
        profile.questionnaire = body.model_dump()
        profile.derived = derived
    else:
        profile = SkinProfile(user_id=user.id, questionnaire=body.model_dump(), derived=derived)
        db.add(profile)
    db.commit()
    return {"profile_version": profile.version, "derived": derived}


@app.get("/v1/me/skin-profile")
def get_profile(user: User = Depends(current_user), db: Session = Depends(get_db)):
    profile = db.get(SkinProfile, user.id)
    return {
        "questionnaire": profile.questionnaire if profile else None,
        "derived": profile.derived if profile else None,
    }


@app.post("/v1/me/skin-photo")
def add_skin_photo(
    photo: UploadFile = File(...),
    consent: bool = Form(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if not settings().enable_face_photo:
        raise HTTPException(
            503, "Facial image pilot is unavailable pending representative evaluation"
        )
    if not consent:
        raise HTTPException(422, "Explicit face-photo consent is required")
    enforce_rate_limit(user.id, "face_photo", 5)
    raw, mime = validated_image(photo)
    assessment_id = uid()
    key = f"face/{user.id}/{assessment_id}"
    try:
        put_image(key, raw, mime)
        with sentry_sdk.start_span(op="gemini.observe_visible_features"):
            observations = observe_skin((raw, mime))
        assessment = SkinPhotoAssessment(
            id=assessment_id,
            user_id=user.id,
            media_key=key,
            observations=observations.model_dump(),
            expires_at=datetime.now(UTC) + timedelta(hours=settings().s3_image_ttl_hours),
        )
        db.add(assessment)
        db.add(Consent(user_id=user.id, scope="face_photo_observation", version="v1", granted=True))
        db.commit()
    except Exception as exc:
        db.rollback()
        delete_image(key)
        raise HTTPException(503, "Photo assessment unavailable") from exc
    return {
        "assessment_id": assessment.id,
        "observations": observations.model_dump(),
        "expires_at": assessment.expires_at,
        "note": "Visible observations only; no diagnosis or skin physiology measurement.",
    }


@app.delete("/v1/me/skin-photo")
def delete_skin_photo(user: User = Depends(current_user), db: Session = Depends(get_db)):
    photos = db.scalars(
        select(SkinPhotoAssessment).where(SkinPhotoAssessment.user_id == user.id)
    ).all()
    for photo in photos:
        delete_image(photo.media_key)
        db.delete(photo)
    db.add(Consent(user_id=user.id, scope="face_photo_observation", version="v1", granted=False))
    db.commit()
    return {"deleted": len(photos)}


@app.post("/v1/analyses", status_code=202)
def create_analysis(
    body: AnalysisRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=8, max_length=255),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    scan = owned(db, ProductScan, body.scan_id, user)
    if scan.status != "CONFIRMED" or not scan.formulation_id:
        raise HTTPException(409, "Confirm the exact formulation first")
    existing = db.scalar(
        select(AnalysisRun).where(
            AnalysisRun.user_id == user.id, AnalysisRun.idempotency_key == idempotency_key
        )
    )
    if existing:
        if existing.scan_id != scan.id:
            raise HTTPException(409, "Idempotency key belongs to another scan")
        return {
            "analysis_id": existing.id,
            "status": existing.status,
            "report_id": existing.report_id,
        }
    enforce_rate_limit(user.id, "analysis", 30)
    run = AnalysisRun(
        user_id=user.id,
        scan_id=scan.id,
        formulation_id=scan.formulation_id,
        idempotency_key=idempotency_key,
    )
    db.add(run)
    db.commit()
    try:
        enqueue("analyses", run_analysis, run.id)
    except Exception as exc:
        run.status = "FAILED"
        run.error_code = "QUEUE_UNAVAILABLE"
        db.commit()
        raise HTTPException(503, "Analysis queue unavailable") from exc
    return {"analysis_id": run.id, "status": run.status, "report_id": None}


@app.get("/v1/analyses/{analysis_id}")
def get_analysis(
    analysis_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    run = owned(db, AnalysisRun, analysis_id, user)
    return {
        "analysis_id": run.id,
        "status": run.status,
        "report_id": run.report_id,
        "error_code": run.error_code,
    }


@app.get("/v1/reports/{report_id}")
def get_report(report_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    report = owned(db, Report, report_id, user)
    return {"report_id": report.id, "created_at": report.created_at, **report.result}


@app.get("/v1/reports/{report_id}/alternatives")
def get_alternatives(
    report_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    report = owned(db, Report, report_id, user)
    return {"alternatives": report.result.get("alternatives", [])}


@app.post("/v1/reports/{report_id}/feedback")
def post_feedback(
    report_id: str,
    body: FeedbackRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    owned(db, Report, report_id, user)
    db.add(
        Feedback(user_id=user.id, report_id=report_id, helpful=body.helpful, note=body.note or None)
    )
    db.commit()
    return {"saved": True}


@app.delete("/v1/me/data")
def delete_me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    scans = db.scalars(select(ProductScan).where(ProductScan.user_id == user.id)).all()
    photos = db.scalars(
        select(SkinPhotoAssessment).where(SkinPhotoAssessment.user_id == user.id)
    ).all()
    for key in [k for scan in scans for k in (scan.front_key, scan.back_key)] + [
        p.media_key for p in photos
    ]:
        if key:
            delete_image(key)
    for model in (
        Feedback,
        Report,
        AnalysisRun,
        ProductScan,
        SkinPhotoAssessment,
        SkinProfile,
        Consent,
    ):
        db.execute(delete(model).where(model.user_id == user.id))
    db.delete(user)
    db.commit()
    return {"deleted": True}
