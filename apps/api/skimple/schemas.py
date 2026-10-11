from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Extraction(BaseModel):
    brand: str = ""
    product_name: str = ""
    variant: str = ""
    size: str = ""
    barcode_if_visible: str = ""
    raw_ingredient_text: str = ""
    ingredients_in_order: list[str] = Field(default_factory=list)
    language: str = ""
    uncertain_fields: list[str] = Field(default_factory=list)
    incomplete_ingredients: bool = False


class ProductIdentity(BaseModel):
    brand: str = ""
    product_name: str = ""
    variant: str = ""
    uncertain: bool = False


class WebIngredientEvidence(BaseModel):
    source_url: str = ""
    brand: str = ""
    product_name: str = ""
    variant: str = ""
    raw_ingredient_text: str = ""
    ingredients_in_order: list[str] = Field(default_factory=list)
    exact_product_match: bool = False
    complete_list: bool = False


class SearchSelection(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    source_url: str = Field(min_length=8, max_length=1000)


class ConfirmRequest(BaseModel):
    brand: str = Field(min_length=1, max_length=200)
    product_name: str = Field(min_length=1, max_length=255)
    variant: str = Field(default="", max_length=255)
    region: str = Field(default="unknown", max_length=80)
    category: str = Field(default="other", max_length=100)
    barcode: str = Field(default="", max_length=80)
    raw_ingredient_text: str = Field(min_length=2, max_length=20000)
    ingredients_in_order: list[str] = Field(min_length=1, max_length=300)

    @field_validator("ingredients_in_order")
    @classmethod
    def valid_names(cls, value: list[str]) -> list[str]:
        if any(not name.strip() or len(name) > 255 for name in value):
            raise ValueError("Ingredient names must be nonempty and at most 255 characters")
        return value


class ProfileRequest(BaseModel):
    after_cleansing: Literal["tight", "comfortable", "oily", "varies", "unsure"]
    daytime_oiliness: Literal["none", "some", "high", "varies", "unsure"]
    dry_areas: list[str] = Field(default_factory=list, max_length=10)
    oily_areas: list[str] = Field(default_factory=list, max_length=10)
    sensitivity: Literal["low", "medium", "high", "unsure"]
    known_reactions: list[str] = Field(default_factory=list, max_length=30)
    reported_sensitivities: list[str] = Field(default_factory=list, max_length=30)
    goals: list[
        Literal["hydration", "blemishes", "tone", "barrier", "texture", "sun_protection", "other"]
    ] = Field(default_factory=list)
    routine: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=2000)
    photo_observations: str = Field(default="", max_length=1000)
    photo_is_demo: bool = False


class AnalysisRequest(BaseModel):
    scan_id: str


class FeedbackRequest(BaseModel):
    helpful: bool
    note: str = Field(default="", max_length=1000)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)


class ReviewFinding(BaseModel):
    aspect: Literal[
        "hydration", "pilling", "stickiness", "breakouts", "irritation", "fragrance", "other"
    ]
    sentiment: Literal["positive", "negative", "mixed", "neutral"]
    self_reported_skin: str | None = None
    explicitly_about_product: bool


class ReviewClassification(BaseModel):
    findings: list[ReviewFinding]


class VisibleObservation(BaseModel):
    feature: Literal["apparent_shine", "visible_flaking", "visible_redness", "visible_blemishes"]
    confidence: Literal["low", "medium", "high"]
    description: str = Field(max_length=200)


class SkinObservations(BaseModel):
    observations: list[VisibleObservation] = Field(default_factory=list, max_length=4)
    image_quality: Literal["adequate", "limited", "unusable"]
    limitations: list[str] = Field(default_factory=list)
