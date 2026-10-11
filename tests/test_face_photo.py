import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from skimple import api
from skimple.db import SessionLocal, engine
from skimple.models import Base, Consent, SkinPhotoAssessment, SkinProfile, User
from skimple.schemas import SkinObservations, VisibleObservation
from sqlalchemy import select

HEADERS = {"X-Visitor-Key": "f" * 64}
PROFILE = {
    "after_cleansing": "varies",
    "daytime_oiliness": "some",
    "sensitivity": "medium",
    "goals": ["hydration"],
    "known_reactions": ["Linalool"],
    "notes": "Prefer a soft finish.",
}


@pytest.fixture(autouse=True)
def face_services(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(api.settings(), "enable_face_photo", True)
    monkeypatch.setattr(api, "enforce_rate_limit", lambda *args: None)

    def no_storage(*args):
        pytest.fail("Face extraction must not store raw photos")

    monkeypatch.setattr(api, "put_image", no_storage)
    monkeypatch.setattr(
        api,
        "observe_skin",
        lambda photo: SkinObservations(
            image_quality="limited",
            observations=[
                VisibleObservation(
                    feature="apparent_shine",
                    description="Visible shine on the forehead.",
                    confidence="medium",
                )
            ],
            limitations=["Lighting may affect appearance."],
        ),
    )


def upload(client, **data):
    buffer = io.BytesIO()
    Image.new("RGB", (500, 500), "white").save(buffer, format="JPEG")
    return client.post(
        "/v1/me/skin-photo",
        headers=HEADERS,
        files={"photo": ("face.jpg", buffer.getvalue(), "image/jpeg")},
        data={"consent": "true", **data},
    )


def test_photo_context_is_saved_without_retaining_media():
    client = TestClient(api.app)
    assert client.put("/v1/me/skin-profile", headers=HEADERS, json=PROFILE).status_code == 200
    response = upload(client)
    assert response.status_code == 200
    result = response.json()
    assert result["media_retained"] is False
    assert result["observations"]["image_quality"] == "limited"
    saved = client.get("/v1/me/skin-profile", headers=HEADERS).json()
    assert saved["questionnaire"] == result["questionnaire"]
    assert saved["derived"]["basis"] == "questionnaire"
    assert saved["questionnaire"]["known_reactions"] == PROFILE["known_reactions"]
    assert saved["questionnaire"]["notes"] == PROFILE["notes"]
    assert "Visible shine" in saved["questionnaire"]["photo_observations"]
    assert "medium confidence" in saved["questionnaire"]["photo_observations"]
    assert "Lighting may affect appearance" in saved["questionnaire"]["photo_observations"]
    assert saved["questionnaire"]["photo_is_demo"] is False
    with SessionLocal() as db:
        assert db.scalar(select(SkinPhotoAssessment)) is None
        assert db.scalar(select(Consent)).granted is True
        user = db.scalar(select(User))
        chat = api.answer_about_result(db, user, {}, "What does my face photo show?")
        assert "Visible shine" in chat["answer"]
        assert "do not determine skin type" in chat["answer"]
        assert (
            "Visible shine"
            in api.answer_about_result(db, user, {}, "Would this suit my skin?")["answer"]
        )
        assert (
            "Visible shine"
            not in api.answer_about_result(db, user, {}, "Can you diagnose rosacea?")["answer"]
        )
    assert (
        client.get("/v1/me/skin-profile", headers={"X-Visitor-Key": "e" * 64}).json()[
            "questionnaire"
        ]
        is None
    )


def test_unsaved_questionnaire_is_saved_with_photo():
    import json

    client = TestClient(api.app)
    assert client.put("/v1/me/skin-profile", headers=HEADERS, json=PROFILE).status_code == 200
    draft = {
        **PROFILE,
        "after_cleansing": "tight",
        "goals": ["barrier"],
        "notes": "New unsaved answers",
    }
    response = upload(client, profile=json.dumps(draft))
    assert response.status_code == 200
    saved = response.json()["questionnaire"]
    assert saved["after_cleansing"] == "tight"
    assert saved["goals"] == ["barrier"]
    assert saved["notes"] == "New unsaved answers"
    assert saved["known_reactions"] == ["Linalool"]


def test_photo_only_does_not_infer_skin_type():
    result = upload(TestClient(api.app)).json()["questionnaire"]
    assert result["after_cleansing"] == "unsure"
    assert result["daytime_oiliness"] == "unsure"
    assert result["sensitivity"] == "unsure"
    assert result["goals"] == []


@pytest.mark.parametrize("data", [{"consent": "false"}, {"profile": "not json"}, {"profile": "{}"}])
def test_invalid_consent_or_profile_stops_before_extraction(monkeypatch, data):
    monkeypatch.setattr(api, "observe_skin", lambda *args: pytest.fail("Extraction called"))
    assert upload(TestClient(api.app), **data).status_code == 422
    with SessionLocal() as db:
        assert db.scalar(select(SkinProfile)) is None
        assert db.scalar(select(Consent)) is None


def test_disabled_feature_is_explicit(monkeypatch):
    monkeypatch.setattr(api.settings(), "enable_face_photo", False)
    monkeypatch.setattr(api, "observe_skin", lambda *args: pytest.fail("Extraction called"))
    response = upload(TestClient(api.app))
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"]


@pytest.mark.parametrize(
    "quality,observations",
    [
        ("unusable", []),
        ("limited", []),
        (
            "unusable",
            [
                VisibleObservation(
                    feature="visible_redness", confidence="low", description="Redness"
                )
            ],
        ),
    ],
)
def test_unreliable_extraction_preserves_previous_context(monkeypatch, quality, observations):
    client = TestClient(api.app)
    before = {**PROFILE, "photo_observations": "Previous observation"}
    client.put("/v1/me/skin-profile", headers=HEADERS, json=before)
    monkeypatch.setattr(
        api,
        "observe_skin",
        lambda *args: SkinObservations(image_quality=quality, observations=observations),
    )
    assert upload(client).status_code == 422
    assert (
        client.get("/v1/me/skin-profile", headers=HEADERS).json()["questionnaire"][
            "photo_observations"
        ]
        == "Previous observation"
    )


def test_provider_failure_preserves_profile_and_returns_retryable_error(monkeypatch):
    client = TestClient(api.app)
    client.put("/v1/me/skin-profile", headers=HEADERS, json=PROFILE)
    before = client.get("/v1/me/skin-profile", headers=HEADERS).json()

    def unavailable(*args):
        raise RuntimeError("Internal provider details")

    monkeypatch.setattr(api, "observe_skin", unavailable)
    response = upload(client)
    assert response.status_code == 503
    assert "try again" in response.json()["detail"]
    assert "Internal" not in response.json()["detail"]
    assert client.get("/v1/me/skin-profile", headers=HEADERS).json() == before


def test_delete_photo_clears_only_photo_context():
    client = TestClient(api.app)
    upload(client)
    client.put(
        "/v1/me/skin-profile",
        headers={"X-Visitor-Key": "e" * 64},
        json={**PROFILE, "photo_observations": "Other visitor"},
    )
    response = client.delete("/v1/me/skin-photo", headers=HEADERS)
    assert response.status_code == 200
    saved = client.get("/v1/me/skin-profile", headers=HEADERS).json()["questionnaire"]
    assert saved["photo_observations"] == ""
    assert saved["after_cleansing"] == "unsure"
    assert (
        client.get("/v1/me/skin-profile", headers={"X-Visitor-Key": "e" * 64}).json()[
            "questionnaire"
        ]["photo_observations"]
        == "Other visitor"
    )


@pytest.mark.parametrize(
    "format,mime", [("HEIF", "image/heic"), ("PNG", "image/png"), ("WEBP", "image/webp")]
)
def test_photo_formats_are_normalized_before_extraction(monkeypatch, format, mime):
    buffer = io.BytesIO()
    Image.new("RGB", (500, 600), "white").save(buffer, format=format)
    seen = []
    original = api.observe_skin

    def observe(photo):
        seen.append(photo)
        return original(photo)

    monkeypatch.setattr(api, "observe_skin", observe)
    response = TestClient(api.app).post(
        "/v1/me/skin-photo",
        headers=HEADERS,
        data={"consent": "true"},
        files={
            "photo": ("face.heic" if format == "HEIF" else "face.image", buffer.getvalue(), mime)
        },
    )
    assert response.status_code == 200
    raw, actual_mime = seen[0]
    assert actual_mime == "image/jpeg"
    with Image.open(io.BytesIO(raw)) as normalized:
        assert normalized.size == (500, 600)
        assert not normalized.getexif()


def test_photo_orientation_and_metadata_are_normalized(monkeypatch):
    buffer = io.BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "Private camera metadata"
    Image.new("RGB", (2400, 1200), "white").save(buffer, format="JPEG", exif=exif)
    original = api.observe_skin

    def observe(photo):
        with Image.open(io.BytesIO(photo[0])) as normalized:
            assert normalized.size == (1024, 2048)
            assert not normalized.getexif()
        assert b"Private camera metadata" not in photo[0]
        return original(photo)

    monkeypatch.setattr(api, "observe_skin", observe)
    response = TestClient(api.app).post(
        "/v1/me/skin-photo",
        headers=HEADERS,
        data={"consent": "true"},
        files={"photo": ("face.jpg", buffer.getvalue(), "image/jpeg")},
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "format,size,status", [("JPEG", (200, 500), 422), ("GIF", (500, 500), 415)]
)
def test_invalid_photo_stops_before_extraction(monkeypatch, format, size, status):
    buffer = io.BytesIO()
    Image.new("RGB", size, "white").save(buffer, format=format)
    monkeypatch.setattr(api, "observe_skin", lambda *args: pytest.fail("Extraction called"))
    response = TestClient(api.app).post(
        "/v1/me/skin-photo",
        headers=HEADERS,
        data={"consent": "true"},
        files={"photo": ("face.jpg", buffer.getvalue(), "image/jpeg")},
    )
    assert response.status_code == status


def test_face_provider_uses_bounded_retries_and_structured_observations(monkeypatch):
    from contextlib import contextmanager
    from types import SimpleNamespace

    from skimple import providers

    captured = {}

    def generate(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            text='{"image_quality":"unusable","observations":[],"limitations":["No face visible"]}'
        )

    @contextmanager
    def client():
        yield SimpleNamespace(models=SimpleNamespace(generate_content=generate))

    monkeypatch.setattr(providers, "gemini_client", client)
    result = providers.observe_skin((b"photo", "image/jpeg"))
    assert result.image_quality == "unusable"
    assert result.observations == []
    retry = captured["config"].http_options.retry_options
    assert retry.attempts == 3
    assert retry.max_delay == 2
    assert 503 in retry.http_status_codes
    assert captured["config"].response_schema is SkinObservations
    assert captured["contents"][1].inline_data.data == b"photo"
