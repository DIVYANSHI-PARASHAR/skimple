import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from skimple import api, jobs, providers
from skimple.db import SessionLocal, engine
from skimple.models import Base, ProductScan
from skimple.schemas import Extraction, ProductIdentity


def setup_function():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def picture() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (500, 500), "white").save(buffer, format="JPEG")
    return buffer.getvalue()


def test_front_photo_looks_up_web_ingredients(monkeypatch):
    stored = {}
    monkeypatch.setattr(api, "put_image", lambda key, raw, mime: stored.update({key: (raw, mime)}))
    monkeypatch.setattr(api, "enqueue", lambda *args: None)
    monkeypatch.setattr(api, "enforce_rate_limit", lambda *args: None)
    monkeypatch.setattr(jobs, "get_image", lambda key: stored[key])
    monkeypatch.setattr(jobs, "identify_front_product", lambda image: ProductIdentity(
        brand="Neutrogena", product_name="Hydro Boost", variant="Water Gel"
    ))
    monkeypatch.setattr(jobs, "lookup_product_ingredients", lambda identity, preferred_url: (
        Extraction(brand=identity.brand, product_name=identity.product_name,
                   variant=identity.variant, raw_ingredient_text="Water, Glycerin",
                   ingredients_in_order=["Water", "Glycerin"]),
        "https://example.com/water-gel",
    ))
    headers = {"X-Visitor-Key": "a" * 64, "Idempotency-Key": "front-only-1"}
    client = TestClient(api.app)
    result = client.post("/v1/scans", headers=headers,
                         files={"front": ("front.jpg", picture(), "image/jpeg")})
    assert result.status_code == 202
    scan_id = result.json()["scan_id"]
    jobs.run_extraction(scan_id)
    status = client.get(f"/v1/scans/{scan_id}", headers=headers).json()
    assert status["status"] == "NEEDS_CONFIRMATION"
    assert status["extraction"]["variant"] == "Water Gel"
    assert status["extraction"]["ingredients_in_order"] == ["Water", "Glycerin"]
    assert status["verification"]["ingredient_source_url"] == "https://example.com/water-gel"
    with SessionLocal() as db:
        assert db.get(ProductScan, scan_id).back_key == ""


def test_selected_search_result_looks_up_web_ingredients(monkeypatch):
    monkeypatch.setattr(api, "enqueue", lambda *args: None)
    monkeypatch.setattr(api, "enforce_rate_limit", lambda *args: None)
    monkeypatch.setattr(api, "search_products", lambda query: [{
        "title": "Neutrogena Hydro Boost Water Gel",
        "source_url": "https://example.com/water-gel",
        "image_url": "https://example.com/water-gel.jpg",
    }])
    seen = {}

    def lookup(identity, preferred_url):
        seen["preferred_url"] = preferred_url
        seen["selected_title"] = identity.product_name
        return (Extraction(brand="Neutrogena", product_name="Hydro Boost",
                           variant="Water Gel", raw_ingredient_text="Water, Glycerin",
                           ingredients_in_order=["Water", "Glycerin"]), preferred_url)

    monkeypatch.setattr(jobs, "lookup_product_ingredients", lookup)
    client = TestClient(api.app)
    headers = {"X-Visitor-Key": "b" * 64, "Idempotency-Key": "selected-search-1"}
    suggestions = client.get("/v1/products/search?q=Neutrogena", headers=headers)
    assert suggestions.status_code == 200
    selected = suggestions.json()["products"][0]
    assert selected["image_url"].endswith("water-gel.jpg")
    result = client.post("/v1/scans/from-search", headers=headers,
                         json={"title": selected["title"], "source_url": selected["source_url"]})
    assert result.status_code == 202
    scan_id = result.json()["scan_id"]
    jobs.run_extraction(scan_id)
    assert seen["preferred_url"] == selected["source_url"]
    assert seen["selected_title"] == selected["title"]
    assert client.get(f"/v1/scans/{scan_id}", headers=headers).json()["status"] == "NEEDS_CONFIRMATION"
    repeated = client.post("/v1/scans/from-search", headers=headers,
                           json={"title": selected["title"], "source_url": selected["source_url"]})
    assert repeated.json()["scan_id"] == scan_id


def test_search_selection_rejects_non_https_source(monkeypatch):
    monkeypatch.setattr(api, "enforce_rate_limit", lambda *args: None)
    response = TestClient(api.app).post(
        "/v1/scans/from-search",
        headers={"X-Visitor-Key": "c" * 64, "Idempotency-Key": "invalid-source-1"},
        json={"title": "Some product", "source_url": "http://example.com/product"},
    )
    assert response.status_code == 422


def test_published_list_fallback_keeps_variants_separate():
    sources = [{
        "url": "https://example.com/water-gel",
        "title": "Neutrogena Hydro Boost Water Gel ingredients (Explained)",
        "description": (
            "Neutrogena Hydro Boost Water Gel ingredients explained: Water, Dimethicone, "
            "Glycerin, Phenoxyethanol, Sodium Hyaluronate, Blue 1 Neutrogena makes skincare."
        ),
        "content": "",
    }]
    water_gel = ProductIdentity(brand="Neutrogena", product_name="Hydro Boost", variant="Water Gel")
    extraction, source = providers._published_ingredient_list(sources, water_gel, "")
    assert extraction.ingredients_in_order[-1] == "Blue 1"
    assert source == sources[0]["url"]
    gel_cream = ProductIdentity(brand="Neutrogena", product_name="Hydro Boost", variant="Gel-Cream")
    assert providers._published_ingredient_list(sources, gel_cream, "") is None


def test_explicit_nimble_list_does_not_need_model(monkeypatch):
    url = "https://incidecoder.com/products/neutrogena-hydro-boost-water-gel"
    monkeypatch.setattr(providers, "nimble_search", lambda *args, **kwargs: [{
        "url": url,
        "title": "Neutrogena Hydro Boost Water Gel ingredients (Explained)",
        "description": (
            "Neutrogena Hydro Boost Water Gel ingredients explained: Water, Dimethicone, "
            "Glycerin, Phenoxyethanol, Sodium Hyaluronate, Blue 1 Products Ingredients Decode"
        ),
        "content": "",
    }])
    monkeypatch.setattr(providers, "gemini_client", lambda: (_ for _ in ()).throw(AssertionError("model called")))
    extraction, source = providers.lookup_product_ingredients(
        ProductIdentity(product_name="Neutrogena Hydro Boost Water Gel"), url
    )
    assert source == url
    assert extraction.ingredients_in_order[-1] == "Blue 1"


def test_selected_retailer_listing_can_use_matching_ingredient_source():
    source = {
        "url": "https://incidecoder.com/products/neutrogena-hydro-boost-water-gel",
        "title": "Neutrogena Hydro Boost Water Gel ingredients (Explained)",
        "description": (
            "Neutrogena Hydro Boost Water Gel ingredients explained: Water, Dimethicone, "
            "Glycerin, Phenoxyethanol, Sodium Hyaluronate, Blue 1 Products Ingredients Decode"
        ),
        "content": "",
    }
    extraction, source_url = providers._published_ingredient_list(
        [source],
        ProductIdentity(product_name="Neutrogena Hydro Boost Water Gel - Shop Facial moisturizer at H-E-B"),
        "https://www.heb.com/product-detail/neutrogena-hydro-boost-water-gel/10239012",
    )
    assert source_url == source["url"]
    assert extraction.product_name == "Hydro Boost Water Gel"


def test_selected_page_with_conflicting_variant_is_rejected():
    source = {
        "url": "https://example.com/water-gel-fragrance-free",
        "title": "Hydro Boost Water Gel Face Moisturizer",
        "description": "Neutrogena Hydro Boost Gel Cream Fragrance Free is a gentle moisturizer.",
    }
    assert providers._variant_conflict(
        "Hydro Boost Water Gel Face Moisturizer",
        source["url"], source,
    )


def test_conflicting_selected_page_stops_before_model(monkeypatch):
    url = "https://example.com/water-gel-fragrance-free"
    monkeypatch.setattr(providers, "nimble_search", lambda *args, **kwargs: [{
        "url": url,
        "title": "Hydro Boost Water Gel Face Moisturizer",
        "description": "Neutrogena Hydro Boost Gel Cream Fragrance Free moisturizer.",
        "content": "",
    }])
    monkeypatch.setattr(providers, "gemini_client", lambda: (_ for _ in ()).throw(AssertionError("model called")))
    with pytest.raises(ValueError, match="INGREDIENTS_NOT_FOUND"):
        providers.lookup_product_ingredients(
            ProductIdentity(product_name="Hydro Boost Water Gel Face Moisturizer | NEUTROGENA"), url
        )


def test_retailer_listing_recovers_brand_and_full_ingredient_section(monkeypatch):
    selected_url = (
        "https://www.iherb.com/pr/beauty-of-joseon-dynasty-cream-1-69-fl-oz-50-ml/106490"
        "?srsltid=tracking"
    )
    queries = []

    def search(query, **kwargs):
        queries.append(query)
        return [{
            "url": selected_url.split("?", 1)[0],
            "title": "Beauty of Joseon, Dynasty Cream, 1.69 fl oz (50 ml)",
            "description": "Dynasty Cream moisturizer with rice and ginseng.",
            "content": (
                "### Other ingredients\n\nWater, Oryza Sativa (Rice) Bran Water, Glycerin, "
                "Niacinamide, Squalane, Ceramide NP.\n\n### Warnings\nFor external use only."
            ),
        }]

    monkeypatch.setattr(providers, "nimble_search", search)
    monkeypatch.setattr(providers, "gemini_client", lambda: (_ for _ in ()).throw(AssertionError("model called")))
    extraction, source = providers.lookup_product_ingredients(
        ProductIdentity(product_name="Dynasty Cream, 1.69 fl oz (50 ml)"), selected_url
    )
    assert queries == ["site:www.iherb.com Beauty of Joseon Dynasty Cream ingredients"]
    assert extraction.brand == "Beauty of Joseon"
    assert extraction.product_name == "Dynasty Cream"
    assert extraction.ingredients_in_order[-1] == "Ceramide NP"
    assert source == selected_url.split("?", 1)[0]
