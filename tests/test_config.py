import pytest
from pydantic import ValidationError
from skimple.config import Settings


def test_database_url_has_no_implicit_local_fallback(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None)
