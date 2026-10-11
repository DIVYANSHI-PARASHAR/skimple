"""Store products a visitor actually uses, separately from favorites.

Revision ID: 71d2f49a8c03
Revises: 6d5a8b4c2e10
"""

from alembic import op
import sqlalchemy as sa

revision = "71d2f49a8c03"
down_revision = "6d5a8b4c2e10"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "owned_products",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("product_key", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "product_key"),
    )


def downgrade():
    op.drop_table("owned_products")
