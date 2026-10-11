import os
import tempfile
from pathlib import Path

os.environ["DATABASE_URL"] = (
    f"sqlite+pysqlite:///{Path(tempfile.gettempdir()) / 'skimple-test.sqlite3'}"
)
