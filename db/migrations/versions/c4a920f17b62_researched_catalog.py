"""Stable catalog keys and sourced product dossiers.

Revision ID: c4a920f17b62
Revises: 71d2f49a8c03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c4a920f17b62"
down_revision = "71d2f49a8c03"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("products", sa.Column("catalog_key", sa.String(110), nullable=True))
    op.create_index("ix_products_catalog_key", "products", ["catalog_key"], unique=True)
    op.add_column(
        "product_formulations",
        sa.Column(
            "source_metadata",
            sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade():
    op.drop_column("product_formulations", "source_metadata")
    op.drop_index("ix_products_catalog_key", table_name="products")
    op.drop_column("products", "catalog_key")
