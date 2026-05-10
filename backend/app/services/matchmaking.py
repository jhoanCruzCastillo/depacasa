"""Matchmaking service: scores scraped records against user criteria."""

import re
import logging
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_CANDIDATE_LIMIT = 300

# ── Bedroom extraction ────────────────────────────────────────────────────────

# Keys that suggest a field contains bedroom info
_BED_KEY = re.compile(
    r'dorm|dormitorio|habitacion|bedroom|cuarto|ambiente|recamara|alcoba|pieza',
    re.IGNORECASE,
)

# "2 dorms", "3 habitaciones", "2 dormitorios", "1 cuarto", "2 ambientes"
_PAT_NUM_WORD = re.compile(
    r'(\d+)\s*'
    r'(?:dorm(?:itorio)?s?|hab(?:itacion(?:es)?)?|bedrooms?|cuartos?|ambientes?|recamaras?|alcobas?|piezas?)',
    re.IGNORECASE,
)

# "dormitorios: 2", "habitaciones - 3", "dorms 2"
_PAT_WORD_NUM = re.compile(
    r'(?:dorm(?:itorio)?s?|hab(?:itacion(?:es)?)?|bedrooms?|cuartos?|ambientes?|recamaras?|alcobas?|piezas?)'
    r'\s*[:\-\s]\s*(\d+)',
    re.IGNORECASE,
)


def _extract_bedroom_counts(data: dict) -> set[int]:
    """Recursively find all bedroom counts mentioned in a property data dict.

    Handles nested structures like 'modelos' arrays/strings that mix
    bedrooms, bathrooms and m2 in a single string.
    """
    counts: set[int] = set()

    def _scan_str(s: str) -> None:
        for m in _PAT_NUM_WORD.finditer(s):
            n = int(m.group(1))
            if 0 < n <= 10:
                counts.add(n)
        for m in _PAT_WORD_NUM.finditer(s):
            n = int(m.group(1))
            if 0 < n <= 10:
                counts.add(n)

    def _walk(obj, key: str = '') -> None:
        if isinstance(obj, (int, float)):
            if _BED_KEY.search(key):
                n = int(obj)
                if 0 < n <= 10:
                    counts.add(n)
        elif isinstance(obj, str):
            _scan_str(obj)
            # If the KEY itself is bedroom-related, also pull bare digits from the value
            if _BED_KEY.search(key):
                for m in re.finditer(r'\b(\d+)\b', obj):
                    n = int(m.group(1))
                    if 0 < n <= 10:
                        counts.add(n)
        elif isinstance(obj, list):
            for item in obj:
                _walk(item, key)
        elif isinstance(obj, dict):
            for k, v in obj.items():
                _walk(v, k)

    _walk(data)
    return counts


# ── Main API ──────────────────────────────────────────────────────────────────

async def find_matches(
    db: Session,
    criteria: dict,
    top_n: int,
    excluded_ids: set[str] | None = None,
) -> list[str]:
    """Return ordered list of ScrapedRecord UUID strings matching criteria.

    excluded_ids: record IDs to skip (e.g. already seen / low-rated by this user).
    Returns up to top_n * 5 so the user can paginate with 'ver más'.
    """
    try:
        location = (criteria.get("location") or "").strip()
        keywords = list(criteria.get("keywords") or []) + list(criteria.get("features") or [])
        keywords = [k for k in keywords if k and len(k) > 2]
        bedrooms: int | None = criteria.get("bedrooms")
        excluded = excluded_ids or set()

        # Only level-2 records (child nodes: parent_id IS NOT NULL)
        level2_join = (
            "JOIN url_nodes un ON sr.url_node_id = un.id "
            "WHERE un.parent_id IS NOT NULL"
        )

        if location:
            rows = db.execute(
                text(
                    f"SELECT sr.id, sr.data FROM scraped_records sr "
                    f"{level2_join} AND sr.data::text ILIKE :loc "
                    "ORDER BY sr.scraped_at DESC LIMIT :lim"
                ),
                {"loc": f"%{location}%", "lim": _CANDIDATE_LIMIT},
            ).fetchall()
        else:
            rows = db.execute(
                text(
                    f"SELECT sr.id, sr.data FROM scraped_records sr "
                    f"{level2_join} "
                    "ORDER BY sr.scraped_at DESC LIMIT :lim"
                ),
                {"lim": _CANDIDATE_LIMIT},
            ).fetchall()

        if not rows:
            return []

        scored: list[tuple[str, int]] = []

        for row in rows:
            record_id = str(row[0])
            if record_id in excluded:
                continue

            raw = row[1]
            data_dict: dict = dict(raw) if isinstance(raw, dict) else {}

            import json
            data_text = json.dumps(data_dict, ensure_ascii=False).lower()
            score = 0

            # Keyword hits
            for term in keywords:
                if term.lower() in data_text:
                    score += 1

            # Location bonus
            if location and location.lower() in data_text:
                score += 3

            # Bedroom scoring (smart extraction)
            if bedrooms:
                found = _extract_bedroom_counts(data_dict)
                if found:
                    if bedrooms in found:
                        score += 5          # exact match
                    elif any(abs(b - bedrooms) == 1 for b in found):
                        score += 1          # adjacent (e.g. wants 2, has 2-3)
                    else:
                        score -= 4          # clear mismatch → push to bottom
                # No bedroom info found → neutral (0), don't penalise

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
