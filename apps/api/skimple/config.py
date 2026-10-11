from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://skimple:skimple@localhost:5432/skimple"
    redis_url: str = "redis://localhost:6379/0"
    s3_endpoint_url: str | None = None
    s3_bucket: str = "skimple-media"
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_region: str = "us-east-1"
    s3_image_ttl_hours: int = 24
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    nimble_api_key: str = ""
    openalex_api_key: str = ""
    pubmed_api_key: str = ""
    sentry_dsn: str = ""
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173"
    review_allowed_domains: str = ""
    enable_face_photo: bool = False


@lru_cache
def settings() -> Settings:
    return Settings()
