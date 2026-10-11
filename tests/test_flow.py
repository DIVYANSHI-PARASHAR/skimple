import io
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from PIL import Image
from skimple import api, jobs
from skimple.db import SessionLocal, engine
from skimple.models import Base, ProductScan, ProductSentiment
from skimple.schemas import Extraction
from sqlalchemy import select


def image_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (500, 500), "white").save(buffer, format="JPEG")
    return buffer.getvalue()


def setup_function():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def test_scan_confirmation_and_private_report(monkeypatch):
    stored = {}
    monkeypatch.setattr(api, "put_image", lambda key, raw, mime: stored.update({key: (raw, mime)}))
    monkeypatch.setattr(api, "delete_image", lambda key: stored.pop(key, None))
    monkeypatch.setattr(api, "enqueue", lambda *args: None)
    monkeypatch.setattr(api, "enforce_rate_limit", lambda *args: None)
    monkeypatch.setattr(jobs, "get_image", lambda key: stored[key])
    monkeypatch.setattr(
        jobs,
        "extract_product",
        lambda front, back: Extraction(
            brand="Example",
            product_name="Daily Cream",
            variant="Unscented",
            raw_ingredient_text="Aqua, Glycerin",
            ingredients_in_order=["Aqua", "Glycerin"],
            uncertain_fields=[],
        ),
    )
    monkeypatch.setattr(jobs, "product_candidates", lambda *args: [])
    monkeypatch.setattr(jobs, "review_candidates", lambda *args: [])
    client = TestClient(api.app)
    auth = {"Authorization": "Bearer dev:alice", "Idempotency-Key": "scan-request-1"}
    picture = image_bytes()
    response = client.post(
        "/v1/scans",
        headers=auth,
        files={
            "front": ("front.jpg", picture, "image/jpeg"),
            "back": ("back.jpg", picture, "image/jpeg"),
        },
    )
    assert response.status_code == 202
    scan_id = response.json()["scan_id"]
    repeated = client.post(
        "/v1/scans",
        headers=auth,
        files={
            "front": ("front.jpg", picture, "image/jpeg"),
            "back": ("back.jpg", picture, "image/jpeg"),
        },
    )
    assert repeated.json()["scan_id"] == scan_id
    assert (
        client.post(
            f"/v1/scans/{scan_id}/confirm",
            headers=auth,
            json={
                "brand": "Example",
                "product_name": "Daily Cream",
                "raw_ingredient_text": "Aqua, Glycerin",
                "ingredients_in_order": ["Aqua", "Glycerin"],
            },
        ).status_code
        == 409
    )
    jobs.run_extraction(scan_id)
    assert client.get(f"/v1/scans/{scan_id}", headers=auth).json()["status"] == "NEEDS_CONFIRMATION"
    assert (
        client.get(f"/v1/scans/{scan_id}", headers={"Authorization": "Bearer dev:bob"}).status_code
        == 404
    )
    confirmed = client.post(
        f"/v1/scans/{scan_id}/confirm",
        headers=auth,
        json={
            "brand": "Example",
            "product_name": "Daily Cream",
            "variant": "Unscented",
            "raw_ingredient_text": "Aqua, Glycerin",
            "ingredients_in_order": ["Aqua", "Glycerin"],
        },
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["formulation_id"]
    assert (
        client.put(
            "/v1/me/skin-profile",
            headers=auth,
            json={
                "after_cleansing": "tight",
                "daytime_oiliness": "none",
                "sensitivity": "high",
                "known_reactions": ["Glycerin"],
                "goals": ["hydration"],
            },
        ).status_code
        == 200
    )
    analysis = client.post(
        "/v1/analyses",
        headers={**auth, "Idempotency-Key": "analysis-request-1"},
        json={"scan_id": scan_id},
    )
    assert analysis.status_code == 202
    analysis_id = analysis.json()["analysis_id"]
    repeated_analysis = client.post(
        "/v1/analyses",
        headers={**auth, "Idempotency-Key": "analysis-request-1"},
        json={"scan_id": scan_id},
    )
    assert repeated_analysis.json()["analysis_id"] == analysis_id
    jobs.run_analysis(analysis_id)
    state = client.get(f"/v1/analyses/{analysis_id}", headers=auth).json()
    assert state["status"] == "COMPLETED"
    report = client.get(f"/v1/reports/{state['report_id']}", headers=auth)
    assert report.status_code == 200
    assert report.json()["compatibility"]["classification"] == "known_reaction_warning"
    assert report.json()["compatibility"]["benefit_fit_score"] is None
    assert report.json()["ingredient_findings"] == []
    assert (
        client.get(
            f"/v1/reports/{state['report_id']}", headers={"Authorization": "Bearer dev:bob"}
        ).status_code
        == 404
    )

    def unavailable(*args):
        raise RuntimeError("Nimble temporarily unavailable")

    monkeypatch.setattr(jobs, "review_candidates", unavailable)
    cached = client.post(
        "/v1/analyses",
        headers={**auth, "Idempotency-Key": "analysis-request-2"},
        json={"scan_id": scan_id},
    )
    jobs.run_analysis(cached.json()["analysis_id"])
    assert (
        client.get(f"/v1/analyses/{cached.json()['analysis_id']}", headers=auth).json()["status"]
        == "COMPLETED"
    )
    with SessionLocal() as db:
        sentiment = db.get(ProductSentiment, confirmed.json()["formulation_id"])
        sentiment.refreshed_at = datetime.now(UTC) - timedelta(days=8)
        db.commit()
    partial = client.post(
        "/v1/analyses",
        headers={**auth, "Idempotency-Key": "analysis-request-3"},
        json={"scan_id": scan_id},
    )
    jobs.run_analysis(partial.json()["analysis_id"])
    partial_state = client.get(f"/v1/analyses/{partial.json()['analysis_id']}", headers=auth).json()
    assert partial_state["status"] == "PARTIAL"
    partial_report = client.get(f"/v1/reports/{partial_state['report_id']}", headers=auth).json()
    assert "could not be retrieved" in partial_report["compatibility"]["limitations"][-1]
    assert client.delete("/v1/me/data", headers=auth).json()["deleted"] is True
    assert not stored
    with SessionLocal() as db:
        assert db.scalar(select(ProductScan).where(ProductScan.id == scan_id)) is None


def test_invalid_image_rejected(monkeypatch):
    monkeypatch.setattr(api, "put_image", lambda *args: None)
    monkeypatch.setattr(api, "enforce_rate_limit", lambda *args: None)
    client = TestClient(api.app)
    response = client.post(
        "/v1/scans",
        headers={"Authorization": "Bearer dev:alice", "Idempotency-Key": "invalid-image"},
        files={
            "front": ("bad.jpg", b"not an image", "image/jpeg"),
            "back": ("bad.jpg", b"not an image", "image/jpeg"),
        },
    )
    assert response.status_code == 422
    with SessionLocal() as db:
        assert db.scalar(select(ProductScan)) is None
