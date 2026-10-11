from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from skimple.config import settings
from skimple.db import get_db
from skimple.models import User


@dataclass(frozen=True)
class Principal:
    subject: str


@lru_cache
def jwks_client() -> tuple[PyJWKClient, str]:
    issuer = settings().oidc_issuer.rstrip("/")
    if not issuer:
        raise RuntimeError("OIDC_ISSUER must be configured")
    import httpx

    discovery = httpx.get(f"{issuer}/.well-known/openid-configuration", timeout=10).json()
    verified_issuer = discovery.get("issuer", "")
    if verified_issuer.rstrip("/") != issuer:
        raise RuntimeError("OIDC issuer mismatch")
    return PyJWKClient(discovery["jwks_uri"]), verified_issuer


def principal(authorization: str | None = Header(None)) -> Principal:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required")
    token = authorization.removeprefix("Bearer ").strip()
    if settings().dev_auth_enabled and token.startswith("dev:"):
        subject = token[4:]
        if not subject or len(subject) > 200:
            raise HTTPException(401, "Invalid development token")
        return Principal(f"dev:{subject}")
    try:
        if not settings().oidc_audience:
            raise RuntimeError("OIDC_AUDIENCE must be configured")
        client, issuer = jwks_client()
        key = client.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256", "ES256"],
            audience=settings().oidc_audience,
            issuer=issuer,
        )
        return Principal(claims["sub"])
    except (jwt.PyJWTError, KeyError, RuntimeError, ValueError) as exc:
        raise HTTPException(401, "Invalid token") from exc


def current_user(p: Principal = Depends(principal), db: Session = Depends(get_db)) -> User:
    user = db.scalar(select(User).where(User.auth_subject == p.subject))
    if user is None:
        user = User(auth_subject=p.subject)
        db.add(user)
        try:
            db.commit()
            db.refresh(user)
        except IntegrityError:
            db.rollback()
            user = db.scalar(select(User).where(User.auth_subject == p.subject))
            if user is None:
                raise
    return user
