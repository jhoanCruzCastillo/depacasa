"""Matchmaking service: scores scraped records against user criteria."""

import re
import unicodedata
import logging
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_CANDIDATE_LIMIT = 500
_RERANK_LIMIT = 20

# ── Normalization ─────────────────────────────────────────────────────────────

def _normalize(s: str) -> str:
    """Lowercase + strip diacritical marks for accent-insensitive comparison."""
    return ''.join(
        c for c in unicodedata.normalize('NFD', s.lower())
        if unicodedata.category(c) != 'Mn'
    )


# ── Bedroom extraction ────────────────────────────────────────────────────────

_BED_KEY = re.compile(
    r'dorm|dormitorio|habitacion|bedroom|cuarto|recamara|alcoba|pieza',
    re.IGNORECASE,
)
_BATH_KEY = re.compile(r'ba[ñn]o|bathroom|bath|aseo|servicio', re.IGNORECASE)

_PAT_NUM_BED = re.compile(
    r'(\d+)\s*(?:dorm(?:itorio)?s?|hab(?:itacion(?:es)?)?|bedrooms?|cuartos?|ambientes?|recamaras?|alcobas?|piezas?)',
    re.IGNORECASE,
)
_PAT_BED_NUM = re.compile(
    r'(?:dorm(?:itorio)?s?|hab(?:itacion(?:es)?)?|bedrooms?|cuartos?|ambientes?|recamaras?|alcobas?|piezas?)'
    r'\s*[:\-\s]\s*(\d+)',
    re.IGNORECASE,
)
_PAT_NUM_BATH = re.compile(r'(\d+)\s*(?:ba[ñn]os?|bathrooms?|aseos?)', re.IGNORECASE)


_PRICE_KEY = re.compile(r'precio|price|costo|valor|monto|importe|usd|dolar|sol|pen', re.IGNORECASE)
_PRICE_WITH_CCY = re.compile(
    r'(?:us\$|usd|dolares?|d[oó]lares?|s\/\.?|soles?|pen)\s*([0-9][0-9\.,\s]{0,15})(?:\s*(k|mil|m|mm|millon(?:es)?))?',
    re.IGNORECASE,
)
_PRICE_BARE = re.compile(
    r'([0-9][0-9\.,\s]{3,15})(?:\s*(k|mil|m|mm|millon(?:es)?))?',
    re.IGNORECASE,
)


def _extract_bedroom_counts(data: dict) -> set[int]:
    """Recursively find bedroom counts in property data, excluding bathroom numbers."""
    counts: set[int] = set()

    def _scan_str(s: str) -> None:
        bath_spans = [m.span() for m in _PAT_NUM_BATH.finditer(s)]

        def _in_bath(pos: int) -> bool:
            return any(a <= pos < b for a, b in bath_spans)

        for m in _PAT_NUM_BED.finditer(s):
            if not _in_bath(m.start()):
                n = int(m.group(1))
                if 0 < n <= 10:
                    counts.add(n)
        for m in _PAT_BED_NUM.finditer(s):
            if not _in_bath(m.start()):
                n = int(m.group(1))
                if 0 < n <= 10:
                    counts.add(n)

    def _walk(obj, key: str = '') -> None:
        if _BATH_KEY.search(key):
            return
        if isinstance(obj, (int, float)):
            if _BED_KEY.search(key):
                n = int(obj)
                if 0 < n <= 10:
                    counts.add(n)
        elif isinstance(obj, str):
            _scan_str(obj)
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


def _parse_price_amount(raw: str, suffix: str | None = None) -> float | None:
    token = (raw or "").strip()
    if not token:
        return None
    token = re.sub(r"[^\d,.\s]", "", token).replace(" ", "")
    if not token:
        return None

    if "." in token and "," in token:
        token = token.replace(".", "").replace(",", "")
    elif "," in token:
        parts = token.split(",")
        token = "".join(parts) if len(parts[-1]) == 3 else token.replace(",", ".")
    elif "." in token:
        parts = token.split(".")
        token = "".join(parts) if len(parts[-1]) == 3 else token

    try:
        value = float(token)
    except ValueError:
        return None

    sfx = (suffix or "").lower()
    if sfx in {"k", "mil"}:
        value *= 1_000
    elif sfx in {"m", "mm", "millon", "millones"}:
        value *= 1_000_000
    if value < 1_000:
        return None
    return value


def _extract_price_values(data: dict) -> list[float]:
    prices: list[float] = []

    def _add_candidate(v):
        if isinstance(v, (int, float)):
            num = float(v)
            if num >= 1_000:
                prices.append(num)
            return
        if not isinstance(v, str):
            return

        text = v.strip()
        if not text:
            return

        found = False
        for m in _PRICE_WITH_CCY.finditer(text):
            parsed = _parse_price_amount(m.group(1), m.group(2))
            if parsed:
                prices.append(parsed)
                found = True
        if found:
            return

        for m in _PRICE_BARE.finditer(text):
            parsed = _parse_price_amount(m.group(1), m.group(2))
            if parsed:
                prices.append(parsed)

    def _walk(obj, key: str = "") -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                _walk(v, k)
            return
        if isinstance(obj, list):
            for item in obj:
                _walk(item, key)
            return

        key_hint = bool(_PRICE_KEY.search(key or ""))
        if key_hint:
            _add_candidate(obj)
        elif isinstance(obj, str) and _PRICE_WITH_CCY.search(obj):
            _add_candidate(obj)

    _walk(data)
    return sorted({round(p, 2) for p in prices})


# ── SQL (level-2 records + LATERAL JOIN for parent data) ─────────────────────

_LATERAL_BASE = """
SELECT sr.id, sr.data, COALESCE(pd.parent_text, '') AS parent_text
FROM scraped_records sr
JOIN url_nodes un ON sr.url_node_id = un.id
LEFT JOIN LATERAL (
    SELECT psr.data::text AS parent_text
    FROM scraped_records psr
    WHERE psr.url_node_id = un.parent_id
    ORDER BY psr.scraped_at DESC
    LIMIT 1
) pd ON true
WHERE un.parent_id IS NOT NULL
"""


# ── Main API ──────────────────────────────────────────────────────────────────

async def find_matches(
    db: Session,
    criteria: dict,
    top_n: int,
    excluded_ids: set[str] | None = None,
    raw_description: str = "",
) -> list[str]:
    """Return ordered list of ScrapedRecord UUID strings matching criteria.

    Returns [] when no records pass the strict location+bedroom filter so the
    caller can show a specific "no results" message instead of wrong results.
    """
    try:
        import json

        location = (criteria.get("location") or "").strip()
        loc_norm = _normalize(location) if location else ""
        keywords = list(criteria.get("keywords") or []) + list(criteria.get("features") or [])
        keywords = [_normalize(k) for k in keywords if k and len(k) > 2]
        bedrooms: int | None = criteria.get("bedrooms")
        min_price = criteria.get("min_price")
        max_price = criteria.get("max_price")
        min_price = float(min_price) if isinstance(min_price, (int, float)) else None
        max_price = float(max_price) if isinstance(max_price, (int, float)) else None
        has_price_filter = min_price is not None or max_price is not None
        excluded = excluded_ids or set()

        rows = db.execute(
            text(_LATERAL_BASE + "ORDER BY sr.scraped_at DESC LIMIT :lim"),
            {"lim": _CANDIDATE_LIMIT},
        ).fetchall()

        logger.info(
            "matchmaking: location=%r bedrooms=%s min_price=%s max_price=%s keywords=%s candidates=%d",
            location, bedrooms, min_price, max_price, keywords[:5], len(rows),
        )

        if not rows:
            return []

        # Each entry: {id, loc_ok, bed_match, kw_score, total, data, parent}
        # bed_match: 1=exact  0=unknown/adjacent  -1=mismatch
        entries: list[dict] = []

        for row in rows:
            record_id = str(row[0])
            if record_id in excluded:
                continue

            raw = row[1]
            data_dict: dict = dict(raw) if isinstance(raw, dict) else {}
            parent_text: str = row[2] or ""

            child_json = json.dumps(data_dict, ensure_ascii=False)
            child_norm = _normalize(child_json)
            # parent_text is used only for Claude re-ranking context, NOT for location
            # because all Lima projects share the same listing-page parent, making
            # parent location data unreliable (it bleeds across unrelated projects).
            kw_norm = child_norm   # keyword search on child only

            # Location score — child data only (each child embeds its own description)
            loc_ok = False
            loc_score = 0
            if location:
                if loc_norm in child_norm:
                    loc_ok = True
                    loc_score = 20
                else:
                    loc_score = -30

            # Keyword score
            kw_score = sum(1 for kw in keywords if kw in kw_norm)

            # Bedroom score + match category
            # bed_match: 1=exact  0=unknown  -1=any mismatch (adjacent or far)
            bed_match = 0   # unknown (no bedroom info in child data)
            bed_score = 0
            if bedrooms:
                bed_counts = _extract_bedroom_counts(data_dict)
                if bed_counts:
                    if bedrooms in bed_counts:
                        bed_match, bed_score = 1, 10     # exact → shown first
                    elif any(abs(b - bedrooms) == 1 for b in bed_counts):
                        bed_match, bed_score = -1, -5    # adjacent → excluded from strict filter, light penalty
                    else:
                        bed_match, bed_score = -1, -20   # far mismatch → excluded, heavy penalty

            # Price score + strict match category
            # price_match: 1=in range, 0=unknown price, -1=known out of range
            price_match = 0
            price_score = 0
            best_price: float | None = None
            if has_price_filter:
                prices = _extract_price_values(data_dict)
                if prices:
                    best_price = min(prices)
                    too_low = min_price is not None and best_price < min_price
                    too_high = max_price is not None and best_price > max_price
                    if too_low or too_high:
                        price_match, price_score = -1, -20
                    else:
                        price_match, price_score = 1, 8

            entries.append({
                "id": record_id,
                "loc_ok": loc_ok,
                "bed_match": bed_match,
                "price_match": price_match,
                "price": best_price,
                "total": loc_score + kw_score + bed_score + price_score,
                "data": data_dict,
                "parent": parent_text[:300],
            })

        if not entries:
            return []

        # ── Step 1: filter by location (when specified) ───────────────────────
        if location:
            loc_entries = [e for e in entries if e["loc_ok"]]
            if not loc_entries:
                logger.info("matchmaking: no records found for location '%s'", location)
                return []
            entries = loc_entries

        if has_price_filter:
            in_budget = [e for e in entries if e["price_match"] == 1]
            if in_budget:
                entries = in_budget
            else:
                logger.info(
                    "matchmaking: no records found in price range min=%s max=%s",
                    min_price, max_price,
                )
                return []

        # ── Step 2: strict bedroom filter (when specified) ────────────────────
        # Only discard known mismatches when exact/unknown alternatives exist.
        if bedrooms:
            good = [e for e in entries if e["bed_match"] >= 0]   # exact or unknown
            if good:
                entries = good   # prefer correct/unknown over known mismatch
            else:
                # All remaining records have a known bedroom mismatch → no results.
                logger.info(
                    "matchmaking: all location-matched records have bedroom mismatch "
                    "(want %d)", bedrooms,
                )
                return []

        # ── Step 3: rank by total score ───────────────────────────────────────
        entries.sort(key=lambda e: e["total"], reverse=True)
        top_slice = entries[:_RERANK_LIMIT]

        # ── Step 4: Claude re-ranking ─────────────────────────────────────────
        if top_slice and (location or bedrooms or has_price_filter):
            try:
                from app.services.claude_service import rerank_properties
                pairs = [
                    (e["id"], {**e["data"], "_parent_desc": e["parent"]})
                    for e in top_slice
                ]
                reranked = await rerank_properties(criteria, raw_description, pairs)
                seen = set(reranked)
                tail = [e["id"] for e in entries[_RERANK_LIMIT:] if e["id"] not in seen]
                return (reranked + tail)[: top_n * 5]
            except Exception as exc:
                logger.warning("Claude re-ranking failed, using scored order: %s", exc)

        return [e["id"] for e in entries[: top_n * 5]]

    except Exception as e:
        logger.error("Matchmaking error: %s", e, exc_info=True)
        return []


def get_record_data(db: Session, record_id: str) -> dict | None:
    try:
        child = db.execute(
            text(
                """
                SELECT sr.data, sr.source_url, un.parent_id
                FROM scraped_records sr
                JOIN url_nodes un ON sr.url_node_id = un.id
                WHERE sr.id = :id
                """
            ),
            {"id": record_id},
        ).fetchone()
        if not child:
            return None

        child_data = dict(child[0]) if isinstance(child[0], dict) else {}
        source_url = child[1]
        parent_id = child[2]

        parent_data: dict = {}
        if parent_id and source_url:
            parent = db.execute(
                text(
                    """
                    SELECT srp.data
                    FROM scraped_records srp
                    WHERE srp.url_node_id = :parent_id
                      AND srp.data->>'url_propiedad' = :source_url
                    ORDER BY srp.scraped_at DESC
                    LIMIT 1
                    """
                ),
                {"parent_id": parent_id, "source_url": source_url},
            ).fetchone()
            if parent and isinstance(parent[0], dict):
                parent_data = dict(parent[0])

        # Child values prevail over parent values when keys repeat.
        merged = {**parent_data, **child_data}
        return merged
    except Exception as e:
        logger.error("Error fetching record %s: %s", record_id, e)
        return None
