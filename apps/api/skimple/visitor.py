import hashlib
import re

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from skimple.db import get_db
from skimple.models import User


def current_user(
    visitor_key: str | None = Header(None, alias="X-Visitor-Key"),
    db: Session = Depends(get_db),
) -> User:
    """Keep one anonymous browser's private data separate from other visitors."""
    if not visitor_key or not re.fullmatch(r"[0-9a-f]{64}", visitor_key):
        raise HTTPException(400, "A browser visitor key is required")
    key_hash = hashlib.sha256(bytes.fromhex(visitor_key)).hexdigest()
    user = db.scalar(select(User).where(User.visitor_key_hash == key_hash))
    if user is None:
        user = User(visitor_key_hash=key_hash)
        db.add(user)
        try:
            db.commit()
            db.refresh(user)
        except IntegrityError:
            db.rollback()
            user = db.scalar(select(User).where(User.visitor_key_hash == key_hash))
            if user is None:
                raise
    return user
