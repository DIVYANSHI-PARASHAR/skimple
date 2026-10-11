import io
from datetime import UTC, datetime, timedelta

import boto3
from botocore.config import Config
from fastapi import HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from skimple.config import settings

MAX_IMAGE_BYTES = 10 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 25_000_000


def client():
    s = settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint_url,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
        region_name=s.s3_region,
        config=Config(signature_version="s3v4"),
    )


def validated_image(upload: UploadFile) -> tuple[bytes, str]:
    raw = upload.file.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds 10 MB")
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.verify()
        with Image.open(io.BytesIO(raw)) as image:
            if image.width < 400 or image.height < 400:
                raise HTTPException(422, "Image must be at least 400 × 400 pixels")
            mime = Image.MIME.get(image.format)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(422, "Invalid image") from exc
    if mime not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(415, "Use JPEG, PNG, or WebP")
    return raw, mime


def put_image(key: str, raw: bytes, mime: str) -> None:
    client().put_object(
        Bucket=settings().s3_bucket,
        Key=key,
        Body=raw,
        ContentType=mime,
        Metadata={
            "expires-at": (
                datetime.now(UTC) + timedelta(hours=settings().s3_image_ttl_hours)
            ).isoformat()
        },
    )


def get_image(key: str) -> tuple[bytes, str]:
    result = client().get_object(Bucket=settings().s3_bucket, Key=key)
    return result["Body"].read(), result["ContentType"]


def delete_image(key: str) -> None:
    client().delete_object(Bucket=settings().s3_bucket, Key=key)
