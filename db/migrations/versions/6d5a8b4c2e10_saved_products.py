"""Save shelf items for anonymous visitors.

Revision ID: 6d5a8b4c2e10
Revises: 97c163ab86f5
"""

from alembic import op
import sqlalchemy as sa

revision = "6d5a8b4c2e10"
down_revision = "97c163ab86f5"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "saved_products",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("product_key", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "product_key"),
    )


def downgrade():
    op.drop_table("saved_products")
