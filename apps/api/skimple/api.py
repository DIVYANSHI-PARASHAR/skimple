import logging
import re
from urllib.parse import urlparse

import sentry_sdk
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Json
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from skimple.catalog import catalog_product
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
    OwnedProduct,
    Product,
    ProductFormulation,
    ProductScan,
    Report,
    SavedProduct,
    SkinPhotoAssessment,
    SkinProfile,
    User,
)
from skimple.providers import observe_skin, search_products
from skimple.schemas import (
    AnalysisRequest,
    ChatRequest,
    ConfirmRequest,
    FeedbackRequest,
    ProfileRequest,
    SearchSelection,
)
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
    back: UploadFile | None = File(None),
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
    back_data, back_mime = validated_image(back) if back else (None, None)
    scan = ProductScan(user_id=user.id, idempotency_key=idempotency_key, front_key="", back_key="")
    db.add(scan)
    db.flush()
    scan.front_key = f"scans/{user.id}/{scan.id}/front"
    scan.back_key = f"scans/{user.id}/{scan.id}/back" if back else ""
    try:
        put_image(scan.front_key, front_data, front_mime)
        if back:
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
            if not key:
                continue
            try:
                delete_image(key)
            except Exception:
                log.warning("Unable to remove failed scan object %s", key, exc_info=True)
        raise HTTPException(503, "Scan storage or queue unavailable") from exc
    return {"scan_id": scan.id, "status": scan.status}


@app.get("/v1/products/search")
def product_search(q: str, user: User = Depends(current_user)):
    query = q.strip()
    if len(query) < 3 or len(query) > 120:
        raise HTTPException(422, "Enter at least three characters to search")
    enforce_rate_limit(user.id, "product_search", 120)
    try:
        return {"products": search_products(query)}
    except Exception as exc:
        log.exception("Nimble product search unavailable")
        raise HTTPException(503, "Product search is temporarily unavailable") from exc


@app.post("/v1/scans/from-search", status_code=202)
def create_scan_from_search(
    body: SearchSelection,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=8, max_length=255),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    url = urlparse(body.source_url)
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        raise HTTPException(422, "Invalid product source")
    existing = db.scalar(
        select(ProductScan).where(
            ProductScan.user_id == user.id, ProductScan.idempotency_key == idempotency_key
        )
    )
    if existing:
        return {"scan_id": existing.id, "status": existing.status}
    enforce_rate_limit(user.id, "scan", 20)
    scan = ProductScan(
        user_id=user.id,
        idempotency_key=idempotency_key,
        front_key="",
        back_key="",
        extraction={"selected_title": body.title.strip(), "source_url": body.source_url},
    )
    db.add(scan)
    db.commit()
    try:
        enqueue("scans", run_extraction, scan.id)
    except Exception as exc:
        db.delete(scan)
        db.commit()
        raise HTTPException(503, "Product lookup queue unavailable") from exc
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
    profile = save_skin_profile(db, user, body)
    db.commit()
    return {"profile_version": profile.version, "derived": profile.derived}


def save_skin_profile(db: Session, user: User, body: ProfileRequest) -> SkinProfile:
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
    return profile


@app.get("/v1/me/skin-profile")
def get_profile(user: User = Depends(current_user), db: Session = Depends(get_db)):
    profile = db.get(SkinProfile, user.id)
    return {
        "questionnaire": profile.questionnaire if profile else None,
        "derived": profile.derived if profile else None,
    }


@app.delete("/v1/me/skin-profile")
def delete_profile(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(delete(SkinProfile).where(SkinProfile.user_id == user.id))
    db.commit()
    return {"deleted": True}


def valid_product_key(product_key: str) -> str:
    if not re.fullmatch(r"(?:demo:|report:|catalog:)[A-Za-z0-9_-]{1,110}", product_key):
        raise HTTPException(422, "Invalid product key")
    return product_key


@app.get("/v1/me/saved")
def get_saved(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {
        "product_keys": db.scalars(
            select(SavedProduct.product_key).where(SavedProduct.user_id == user.id)
        ).all()
    }


@app.put("/v1/me/saved/{product_key}")
def save_product(
    product_key: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    product_key = valid_product_key(product_key)
    if product_key.startswith("report:"):
        owned(db, Report, product_key.removeprefix("report:"), user)
    if product_key.startswith("catalog:") and not catalog_product(db, product_key[8:]):
        raise HTTPException(404, "Catalog product not found")
    if not db.get(SavedProduct, (user.id, product_key)):
        db.add(SavedProduct(user_id=user.id, product_key=product_key))
        db.commit()
    return {"saved": True}


@app.delete("/v1/me/saved/{product_key}")
def unsave_product(
    product_key: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    product_key = valid_product_key(product_key)
    db.execute(
        delete(SavedProduct).where(
            SavedProduct.user_id == user.id, SavedProduct.product_key == product_key
        )
    )
    db.commit()
    return {"saved": False}


@app.get("/v1/me/owned")
def get_owned_products(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {
        "product_keys": db.scalars(
            select(OwnedProduct.product_key).where(OwnedProduct.user_id == user.id)
        ).all()
    }


@app.put("/v1/me/owned/{product_key}")
def add_owned_product(
    product_key: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    product_key = valid_product_key(product_key)
    if product_key.startswith("report:"):
        owned(db, Report, product_key.removeprefix("report:"), user)
    if product_key.startswith("catalog:") and not catalog_product(db, product_key[8:]):
        raise HTTPException(404, "Catalog product not found")
    if not db.get(OwnedProduct, (user.id, product_key)):
        db.add(OwnedProduct(user_id=user.id, product_key=product_key))
        db.commit()
    return {"owned": True}


@app.delete("/v1/me/owned/{product_key}")
def remove_owned_product(
    product_key: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    product_key = valid_product_key(product_key)
    db.execute(
        delete(OwnedProduct).where(
            OwnedProduct.user_id == user.id, OwnedProduct.product_key == product_key
        )
    )
    db.commit()
    return {"owned": False}


@app.post("/v1/me/skin-photo")
def add_skin_photo(
    photo: UploadFile = File(...),
    consent: bool = Form(...),
    profile: Json[ProfileRequest] | None = Form(None),
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
    raw, mime = validated_image(photo, normalize=True)
    try:
        with sentry_sdk.start_span(op="gemini.observe_visible_features"):
            observations = observe_skin((raw, mime))
    except Exception as exc:
        raise HTTPException(
            503, "Photo observation is temporarily unavailable. Please try again."
        ) from exc
    if observations.image_quality == "unusable" or not observations.observations:
        raise HTTPException(
            422,
            "No reliable visible observations could be extracted. Try a clearer, well-lit face photo.",
        )
    existing = db.get(SkinProfile, user.id)
    context = profile or (
        ProfileRequest.model_validate(existing.questionnaire)
        if existing
        else ProfileRequest(
            after_cleansing="unsure", daytime_oiliness="unsure", sensitivity="unsure"
        )
    )
    text = f"Photo observations ({observations.image_quality} image quality): " + " ".join(
        f"{item.description} ({item.confidence} confidence)" for item in observations.observations
    )
    if observations.limitations:
        text += " Limitations: " + " ".join(observations.limitations)
    context = context.model_copy(update={"photo_observations": text[:1000], "photo_is_demo": False})
    saved = save_skin_profile(db, user, context)
    db.add(Consent(user_id=user.id, scope="face_photo_observation", version="v1", granted=True))
    db.commit()
    return {
        "observations": observations.model_dump(),
        "questionnaire": saved.questionnaire,
        "derived": saved.derived,
        "media_retained": False,
        "note": "Visible observations only; no diagnosis or skin physiology measurement.",
    }


@app.delete("/v1/me/skin-photo")
def delete_skin_photo(user: User = Depends(current_user), db: Session = Depends(get_db)):
    photos = db.scalars(
        select(SkinPhotoAssessment).where(SkinPhotoAssessment.user_id == user.id)
    ).all()
    for photo in photos:
        if photo.media_key:
            delete_image(photo.media_key)
        db.delete(photo)
    profile = db.get(SkinProfile, user.id)
    if profile:
        profile.questionnaire = {
            **profile.questionnaire,
            "photo_observations": "",
            "photo_is_demo": False,
        }
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


@app.get("/v1/me/reports")
def list_my_reports(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Report, AnalysisRun, ProductFormulation, Product, Brand)
        .join(AnalysisRun, Report.analysis_id == AnalysisRun.id)
        .join(ProductFormulation, AnalysisRun.formulation_id == ProductFormulation.id)
        .join(Product, ProductFormulation.product_id == Product.id)
        .join(Brand, Product.brand_id == Brand.id)
        .where(Report.user_id == user.id)
        .order_by(Report.created_at.desc())
        .limit(50)
    ).all()
    return {
        "reports": [
            {
                "report_id": report.id,
                "created_at": report.created_at,
                "brand": brand.name,
                "product_name": product.name,
                "category": product.category or "other",
                "variant": formula.variant,
                "raw_ingredient_text": formula.raw_ingredient_text,
                "result": report.result,
            }
            for report, _, formula, product, brand in rows
        ]
    }


@app.post("/v1/reports/{report_id}/chat")
def chat_about_report(
    report_id: str,
    body: ChatRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    report = owned(db, Report, report_id, user)
    return answer_about_result(db, user, report.result, body.question)


@app.get("/v1/catalog")
def list_catalog(user: User = Depends(current_user), db: Session = Depends(get_db)):
    keys = db.scalars(
        select(Product.catalog_key)
        .where(Product.catalog_key.is_not(None))
        .order_by(Product.catalog_key)
        .limit(50)
    ).all()
    profile = db.get(SkinProfile, user.id)
    return {"products": [row for key in keys if (row := catalog_product(db, key, profile))]}


@app.get("/v1/catalog/{catalog_key}")
def get_catalog_product(
    catalog_key: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = catalog_product(db, catalog_key, db.get(SkinProfile, user.id))
    if row is None:
        raise HTTPException(404, "Catalog product not found")
    return row


@app.post("/v1/catalog/{catalog_key}/chat")
def chat_about_catalog(
    catalog_key: str,
    body: ChatRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = get_catalog_product(catalog_key, user, db)
    if re.search(r"\b(use|apply|routine)\b", body.question, re.IGNORECASE) and not re.search(
        r"diagnos|eczema|rosacea|cancer|prescri|allerg|pregnan", body.question, re.IGNORECASE
    ):
        return {
            "answer": row["source_metadata"].get("usage", "Follow the product label."),
            "source": row["source_url"],
        }
    return answer_about_result(db, user, row["result"], body.question)


def answer_about_result(db: Session, user: User, result: dict, question: str) -> dict:
    question = question.strip().lower()
    findings = result.get("ingredient_findings", [])
    reviews = result.get("review_signal", {})
    fit = result.get("compatibility", {})
    profile = db.get(SkinProfile, user.id)
    photo_context = (profile.questionnaire.get("photo_observations", "") if profile else "").strip()
    if re.search(r"diagnos|eczema|rosacea|cancer|prescri|allerg|pregnan", question):
        answer = "This report cannot assess a medical condition, pregnancy, or medicine interaction. Please ask a qualified clinician or pharmacist."
        source = "Report scope"
    elif re.search(r"\b(photo|face|visible|observations?)\b", question):
        answer = (
            f"Your saved photo context: {photo_context} These are visible observations only; they do not determine skin type or diagnose a condition."
            if photo_context
            else "No photo observations are saved. You can add a face photo with consent, or share your skin preferences in the questionnaire."
        )
        source = "Your saved photo context"
    elif re.search(r"ingredient|science|paper|research|evidence", question):
        if findings:
            answer = " ".join(f"{f['ingredient']}: {f['synthesis']}" for f in findings[:3])
            source = "Reviewed ingredient claims and linked papers"
        else:
            answer = "This formula has no reviewed, source-linked ingredient claims yet. Its ingredient list alone cannot establish how the finished product performs."
            source = "Ingredient evidence status"
    elif re.search(r"review|people|say|pilling|sticky|feel", question):
        count = reviews.get("observation_count", 0)
        aspects = reviews.get("aspects", [])
        answer = (
            f"There are {count} permitted review observations in this report. "
            + (
                "The recorded themes are "
                + ", ".join(f"{a['aspect']} ({a['sentiment']}, {a['count']})" for a in aspects[:5])
                + ". "
                if aspects
                else "There is no reliable review theme to summarize yet. "
            )
            + "Reviews describe personal experiences, not clinical proof."
        )
        source = "Permitted product review observations"
    elif re.search(r"skin|suit|fit|good|dry|oily|sensitive|custom", question):
        classification = fit.get("classification", "uncertain").replace("_", " ")
        limitations = fit.get("limitations", [])
        answer = f"The report's compatibility result is {classification}. " + " ".join(
            limitations[:2]
        )
        source = "Your questionnaire and report compatibility result"
        if photo_context:
            answer += f" Your saved photo context: {photo_context} Photo observations do not determine skin type or product compatibility."
            source += " + visible photo context"
    else:
        answer = (
            "This report can help with ingredient evidence, permitted review themes, and your skin fit. "
            + " ".join(fit.get("limitations", [])[:2])
        )
        source = "Product report"
    note = (profile.questionnaire.get("notes", "") if profile else "").strip()
    if note and not re.search(r"diagnos|eczema|rosacea|cancer|prescri|allerg|pregnan", question):
        answer += f" Your saved skin note: {note}"
        source += " + your saved skin note"
    return {"answer": answer, "source": source}


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
        SavedProduct,
        OwnedProduct,
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
