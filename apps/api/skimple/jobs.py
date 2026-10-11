import hashlib
import logging
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import sentry_sdk
from google.genai.errors import ClientError, ServerError
from redis import Redis
from rq import Queue, Retry, get_current_job
from sqlalchemy import delete, select

from skimple.catalog import catalog_candidates
from skimple.config import settings
from skimple.db import SessionLocal
from skimple.media import get_image
from skimple.models import (
    AnalysisRun,
    Brand,
    Product,
    ProductFormulation,
    ProductScan,
    ProductSentiment,
    Report,
    ReviewObservation,
    ReviewSource,
    SkinProfile,
)
from skimple.providers import (
    classify_review,
    extract_product,
    identify_front_product,
    lookup_product_ingredients,
    product_candidates,
    review_candidates,
    review_fingerprint,
)
from skimple.schemas import ProductIdentity
from skimple.scoring import build_report

log = logging.getLogger(__name__)
if settings().sentry_dsn:
    sentry_sdk.init(
        dsn=settings().sentry_dsn,
        traces_sample_rate=0.2,
        send_default_pii=False,
        max_request_body_size="never",
    )


def enqueue(queue: str, function, identifier: str) -> None:
    Queue(queue, connection=Redis.from_url(settings().redis_url)).enqueue(
        function,
        identifier,
        job_id=f"{queue}_{identifier}",
        job_timeout=180,
        retry=Retry(max=2, interval=[10, 20]),
        result_ttl=3600,
        failure_ttl=86400,
    )


def run_extraction(scan_id: str) -> None:
    with sentry_sdk.start_transaction(name="scan.extract", op="worker"):
        _run_extraction(scan_id)


def _run_extraction(scan_id: str) -> None:
    with SessionLocal() as db:
        scan = db.get(ProductScan, scan_id)
        if not scan or scan.status in {"NEEDS_CONFIRMATION", "CONFIRMED", "EXPIRED"}:
            return
        scan.status = "EXTRACTING"
        db.commit()
        try:
            if scan.back_key:
                with sentry_sdk.start_span(op="gemini.extract_product"):
                    extraction = extract_product(get_image(scan.front_key), get_image(scan.back_key))
            else:
                if scan.front_key:
                    with sentry_sdk.start_span(op="gemini.identify_product"):
                        identity = identify_front_product(get_image(scan.front_key))
                    preferred_url = ""
                else:
                    selected = scan.extraction or {}
                    preferred_url = str(selected.get("source_url") or "")
                    identity = ProductIdentity(
                        product_name=str(selected.get("selected_title") or "")
                    )
                scan.status = "IDENTIFYING"
                db.commit()
                with sentry_sdk.start_span(op="nimble.lookup_ingredients"):
                    extraction, source_url = lookup_product_ingredients(identity, preferred_url)
                scan.verification = {
                    "ingredient_source_url": source_url,
                    "note": "Ingredient list found on the web for this product and variant.",
                }
            scan.extraction = extraction.model_dump()
            scan.status = "IDENTIFYING" if scan.back_key else "NEEDS_CONFIRMATION"
            db.commit()
            if not scan.back_key:
                return
            with sentry_sdk.start_span(op="postgres.match_formulation"):
                known_candidates = catalog_candidates(db, extraction)
            try:
                with sentry_sdk.start_span(op="nimble.search_product"):
                    scan.verification = {
                        "candidates": known_candidates
                        + product_candidates(
                            extraction.brand, extraction.product_name, extraction.variant
                        ),
                        "note": "Packaging text requires user confirmation; web listings may describe other formulations.",
                    }
            except Exception:
                log.exception("Product verification unavailable for scan %s", scan_id)
                scan.verification = {
                    "candidates": known_candidates,
                    "note": "Web verification unavailable. Confirm against packaging.",
                }
            scan.status = "NEEDS_CONFIRMATION"
            db.commit()
        except Exception as exc:
            log.exception("Extraction failed for scan %s", scan_id)
            job = get_current_job()
            model_unavailable = isinstance(exc, ClientError) and exc.code == 404
            model_busy = isinstance(exc, ServerError) and exc.code in {503, 504}
            no_match = isinstance(exc, ValueError) and str(exc) in {
                "PRODUCT_IDENTITY_UNCLEAR", "INGREDIENTS_NOT_FOUND"
            }
            scan.status = "RETRYING" if job and job.retries_left and not (model_unavailable or no_match) else "FAILED"
            scan.error_code = ("MODEL_UNAVAILABLE" if model_unavailable else
                               "MODEL_BUSY" if model_busy else str(exc) if no_match else
                               "EXTRACTION_UNAVAILABLE")
            db.commit()
            if job and not (model_unavailable or no_match):
                raise


def run_analysis(analysis_id: str) -> None:
    with sentry_sdk.start_transaction(name="scan.analyze", op="worker"):
        _run_analysis(analysis_id)


def _run_analysis(analysis_id: str) -> None:
    with SessionLocal() as db:
        run = db.get(AnalysisRun, analysis_id)
        if not run or run.status in {"COMPLETED", "PARTIAL"}:
            return
        run.status = "REVIEW_ANALYSIS"
        db.commit()
        try:
            formula = db.get(ProductFormulation, run.formulation_id)
            product = db.get(Product, formula.product_id)
            brand = db.get(Brand, product.brand_id)
            identity = f"{brand.name} {product.name} {formula.variant}"
            review_error = False
            cache = db.get(ProductSentiment, formula.id)
            policy = hashlib.sha256(
                settings().review_allowed_domains.strip().lower().encode()
            ).hexdigest()
            refreshed_at = cache.refreshed_at if cache else None
            if refreshed_at and refreshed_at.tzinfo is None:
                refreshed_at = refreshed_at.replace(tzinfo=UTC)
            cache_fresh = bool(
                cache
                and cache.source_policy == policy
                and refreshed_at > datetime.now(UTC) - timedelta(days=7)
            )
            try:
                if not cache_fresh:
                    db.execute(
                        delete(ReviewObservation).where(
                            ReviewObservation.formulation_id == formula.id
                        )
                    )
                    _refresh_reviews(db, formula, brand.name, product.name, identity)
                    source_count = len(
                        {
                            r.source_domain
                            for r in db.scalars(
                                select(ReviewObservation).where(
                                    ReviewObservation.formulation_id == formula.id
                                )
                            ).all()
                        }
                    )
                    if cache:
                        cache.refreshed_at = datetime.now(UTC)
                        cache.source_policy = policy
                        cache.source_count = source_count
                    else:
                        db.add(
                            ProductSentiment(
                                formulation_id=formula.id,
                                refreshed_at=datetime.now(UTC),
                                source_policy=policy,
                                source_count=source_count,
                            )
                        )
                    db.commit()
            except Exception:
                log.exception("Review processing unavailable for analysis %s", analysis_id)
                db.rollback()
                review_error = True
            run.status = "SCORING"
            db.commit()
            profile = db.get(SkinProfile, run.user_id)
            with sentry_sdk.start_span(op="scoring.compute_compatibility"):
                result = build_report(db, formula.id, profile)
            if review_error:
                result["review_signal"]["note"] = (
                    "Review refresh unavailable; any existing observations may be stale."
                )
                result["compatibility"]["limitations"].append(
                    "Current product reviews could not be retrieved."
                )
            report = Report(user_id=run.user_id, analysis_id=run.id, result=result)
            db.add(report)
            db.flush()
            run.report_id = report.id
            run.status = "PARTIAL" if review_error else "COMPLETED"
            db.commit()
        except Exception:
            log.exception("Analysis failed %s", analysis_id)
            db.rollback()
            run = db.get(AnalysisRun, analysis_id)
            job = get_current_job()
            run.status = "RETRYING" if job and job.retries_left else "FAILED"
            run.error_code = "ANALYSIS_UNAVAILABLE"
            db.commit()
            if job:
                raise


def _refresh_reviews(db, formula, brand_name: str, product_name: str, identity: str) -> None:
    with sentry_sdk.start_span(op="nimble.search_reviews"):
        sources = review_candidates(brand_name, product_name, formula.variant)
    for source in sources:
        url = str(source.get("url", ""))
        domain = (urlparse(url).hostname or "").lower()
        permission = db.get(ReviewSource, domain)
        if not permission or permission.permission_status != "approved":
            continue
        content = str(source.get("content", ""))
        if not content:
            continue
        with sentry_sdk.start_span(op="gemini.classify_review_aspects"):
            classified = classify_review(content, identity)
        for finding in classified.findings:
            if not finding.explicitly_about_product:
                continue
            fingerprint = review_fingerprint(formula.id, url, finding.aspect, finding.sentiment)
            if db.scalar(
                select(ReviewObservation).where(ReviewObservation.fingerprint == fingerprint)
            ):
                continue
            db.add(
                ReviewObservation(
                    formulation_id=formula.id,
                    source_domain=domain,
                    source_url=url,
                    fingerprint=fingerprint,
                    aspect=finding.aspect,
                    sentiment=finding.sentiment,
                    self_reported_skin=finding.self_reported_skin,
                )
            )
