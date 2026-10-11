import os
import tempfile
import uuid
from pathlib import Path

import pytest
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

os.environ["DATABASE_URL"] = (
    f"sqlite+pysqlite:///{Path(tempfile.gettempdir()) / 'skimple-test.sqlite3'}"
)

# Opt in to exercising the same suite on TigerData. Never drop application tables:
# all test connections see only this run's temporary schema.
postgres = None
schema = None
if os.environ.get("SKIMPLE_TEST_POSTGRES") == "1":
    url = make_url(
        os.environ.get("SKIMPLE_TEST_DATABASE_URL")
        or dotenv_values(Path(__file__).resolve().parents[1] / ".env")["DATABASE_URL"]
    )
    if url.get_backend_name() != "postgresql":
        raise ValueError("SKIMPLE_TEST_POSTGRES requires a PostgreSQL DATABASE_URL in .env")
    schema = f"skimple_test_{uuid.uuid4().hex}"
    postgres = create_engine(url)
    with postgres.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    test_url = url.update_query_dict({"options": f"-csearch_path={schema}"})
    os.environ["DATABASE_URL"] = test_url.render_as_string(hide_password=False)


@pytest.fixture(scope="session", autouse=True)
def cleanup_postgres_schema():
    yield
    if postgres is not None:
        from skimple.db import engine

        engine.dispose()
        with postgres.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        postgres.dispose()
