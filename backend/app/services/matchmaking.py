"""Matchmaking service: scores scraped records against user criteria."""

import logging
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# How many candidate records to pull from DB before in-memory scoring
_CANDIDATE_LIMIT = 300


async def find_matches(db: Session, criteria: dict, top_n: int) -> list[str]:
    """Return ordered list of ScrapedRecord UUID strings matching criteria.

    Returns up to top_n * 5 candidates to allow pagination via 'ver más'.
    """
    try:
        location = (criteria.get("location") or "").strip()
        keywords = list(criteria.get("keywords") or []) + list(criteria.get("features") or [])
        keywords = [k for k in keywords if k and len(k) > 2]

        if location:
            rows = db.execute(
                text(
                    "SELECT id, data::text FROM scraped_records "
                    "WHERE data::text ILIKE :loc "
                    "ORDER BY scraped_at DESC LIMIT :lim"
                ),
                {"loc": f"%{location}%", "lim": _CANDIDATE_LIMIT},
            ).fetchall()
        else:
            rows = db.execute(
                text(
                    "SELECT id, data::text FROM scraped_records "
                    "ORDER BY scraped_at DESC LIMIT :lim"
                ),
                {"lim": _CANDIDATE_LIMIT},
            ).fetchall()

        if not rows:
            return []

        bedrooms = criteria.get("bedrooms")
        scored: list[tuple[str, int]] = []

        for row in rows:
            record_id = str(row[0])
            data_text = (row[1] or "").lower()
            score = 0

            for term in keywords:
                if term.lower() in data_text:
                    score += 1

            if location and location.lower() in data_text:
                score += 3

            if bedrooms:
                for variant in (str(bedrooms), f"{bedrooms} hab", f"{bedrooms}hab", f"{bedrooms} dorm"):
                    if variant in data_text:
                        score += 2
                        break

            scored.append((record_id, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return [rid for rid, _ in scored[: top_n * 5]]

    except Exception as e:
        logger.error(f"Matchmaking error: {e}", exc_info=True)
        return []


def get_record_data(db: Session, record_id: str) -> dict | None:
    try:
        row = db.execute(
            text("SELECT data FROM scraped_records WHERE id = :id"),
            {"id": record_id},
        ).fetchone()
        return dict(row[0]) if row else None
    except Exception as e:
        logger.error(f"Error fetching record {record_id}: {e}")
        return None
