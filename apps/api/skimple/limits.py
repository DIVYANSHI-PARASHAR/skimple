from fastapi import HTTPException
from redis import Redis

from skimple.config import settings


def enforce_rate_limit(user_id: str, action: str, max_per_hour: int) -> None:
    redis = Redis.from_url(settings().redis_url)
    key = f"rate:{action}:{user_id}"
    try:
        count = redis.incr(key)
        if count == 1:
            redis.expire(key, 3600)
    except Exception as exc:
        raise HTTPException(503, "Rate-limit service unavailable") from exc
    if count > max_per_hour:
        raise HTTPException(429, "Hourly request limit reached")
