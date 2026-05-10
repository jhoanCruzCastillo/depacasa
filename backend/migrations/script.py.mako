"""Alembic script configuration - Initial setup"""

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    # This is handled by SQLAlchemy ORM through Base.metadata.create_all()
    pass


def downgrade() -> None:
    pass
