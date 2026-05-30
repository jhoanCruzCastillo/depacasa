"""Preference helpers for flat user_preferences schema."""

from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.user_preference import UserPreference

PRIORITY_REQUIRED = "REQUIRED"
PRIORITY_OPTIONAL = "OPTIONAL"


def priority_to_mode(priority: str | None) -> str:
    return "obligatorio" if priority == PRIORITY_REQUIRED else "preferencia"


def mode_to_priority(mode: str | None) -> str:
    return PRIORITY_REQUIRED if str(mode or "").strip().lower() == "obligatorio" else PRIORITY_OPTIONAL


def _parse_nearby(raw: list | None) -> list[dict]:
    """Normalize nearby_places regardless of old (list[str]) or new (list[dict]) format."""
    result: list[dict] = []
    seen: set[str] = set()
    for item in raw or []:
        if isinstance(item, dict):
            name = str(item.get("name") or "").strip()
            priority = item.get("priority") or PRIORITY_OPTIONAL
        else:
            name = str(item or "").strip()
            priority = PRIORITY_OPTIONAL
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        result.append({"name": name, "priority": priority})
    return result


def _clean_terms(values: list | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in values or []:
        value = str(raw or "").strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def criteria_from_preference(pref: "UserPreference") -> dict:
    """Build a matchmaking criteria dict from a UserPreference row."""
    out: dict = {}

    if pref.ubicacion:
        out["location"] = pref.ubicacion
        out["location_mode"] = priority_to_mode(pref.ubicacion_priority)

    if pref.m2 is not None:
        out["area_exact"] = pref.m2
        out["area_mode"] = priority_to_mode(pref.m2_priority)

    if pref.bedrooms is not None:
        out["bedrooms"] = pref.bedrooms
        out["bedrooms_mode"] = priority_to_mode(pref.bedrooms_priority)

    if pref.bathrooms is not None:
        out["bathrooms"] = pref.bathrooms
        out["bathrooms_mode"] = priority_to_mode(pref.bathrooms_priority)

    if pref.min_price is not None:
        out["min_price"] = pref.min_price
    if pref.max_price is not None:
        out["max_price"] = pref.max_price
    if pref.min_price is not None or pref.max_price is not None:
        is_required = (
            pref.min_price_priority == PRIORITY_REQUIRED
            or pref.max_price_priority == PRIORITY_REQUIRED
        )
        out["budget_mode"] = "obligatorio" if is_required else "preferencia"

    nearby_items = _parse_nearby(pref.nearby_places)
    if nearby_items:
        nearby = [item["name"] for item in nearby_items]
        has_required = any(item["priority"] == PRIORITY_REQUIRED for item in nearby_items)
        out["nearby_zones"] = nearby
        out["nearby_zones_mode"] = "obligatorio" if has_required else "preferencia"
        near_terms = [f"cerca de {term}" for term in nearby]
        out["features"] = _clean_terms(near_terms)
        out["keywords"] = _clean_terms(near_terms)

    common_items = _parse_nearby(pref.common_areas)
    if common_items:
        ca_names = [item["name"] for item in common_items]
        has_required_ca = any(item["priority"] == PRIORITY_REQUIRED for item in common_items)
        out["common_areas"] = ca_names
        out["common_areas_mode"] = "obligatorio" if has_required_ca else "preferencia"
        out["keywords"] = _clean_terms(list(out.get("keywords") or []) + ca_names)
        out["features"] = _clean_terms(list(out.get("features") or []) + ca_names)

    if pref.property_type:
        out["property_type"] = pref.property_type
        out["property_type_mode"] = priority_to_mode(pref.property_type_priority)
        out["keywords"] = _clean_terms(list(out.get("keywords") or []) + [pref.property_type])

    if not out.get("features"):
        out.pop("features", None)
    if not out.get("keywords"):
        out.pop("keywords", None)

    return {k: v for k, v in out.items() if v not in (None, "", [], {})}


def update_preference_from_criteria(pref: "UserPreference", criteria: dict) -> None:
    """Write matchmaking criteria fields into a UserPreference row (in place)."""
    if criteria.get("location"):
        pref.ubicacion = criteria["location"]
        pref.ubicacion_priority = mode_to_priority(criteria.get("location_mode"))

    if criteria.get("pais"):
        pref.pais = str(criteria["pais"]).strip()

    # area_exact takes precedence; fall back to area_min then area_max.
    # Use next() with truthiness check so 0 is treated as "not set".
    area = next(
        (v for v in [criteria.get("area_exact"), criteria.get("area_min"), criteria.get("area_max")] if v),
        None,
    )
    if area:
        pref.m2 = float(area)
        pref.m2_priority = mode_to_priority(criteria.get("area_mode"))

    if criteria.get("bedrooms") is not None:
        pref.bedrooms = int(criteria["bedrooms"])
        pref.bedrooms_priority = mode_to_priority(criteria.get("bedrooms_mode"))

    if criteria.get("bathrooms") is not None:
        pref.bathrooms = int(criteria["bathrooms"])
        pref.bathrooms_priority = mode_to_priority(criteria.get("bathrooms_mode"))

    if criteria.get("min_price") is not None:
        pref.min_price = float(criteria["min_price"])
        pref.min_price_priority = mode_to_priority(criteria.get("budget_mode"))

    if criteria.get("max_price") is not None:
        pref.max_price = float(criteria["max_price"])
        pref.max_price_priority = mode_to_priority(criteria.get("budget_mode"))

    nearby = _clean_terms(criteria.get("nearby_zones") or [])
    if nearby:
        priority = mode_to_priority(criteria.get("nearby_zones_mode"))
        pref.nearby_places = [{"name": n, "priority": priority} for n in nearby]

    common_areas_raw = _clean_terms(criteria.get("common_areas") or [])
    if common_areas_raw:
        priority_ca = mode_to_priority(criteria.get("common_areas_mode"))
        pref.common_areas = [{"name": n, "priority": priority_ca} for n in common_areas_raw]

    if criteria.get("property_type"):
        pref.property_type = criteria["property_type"]
        pref.property_type_priority = mode_to_priority(criteria.get("property_type_mode"))


def summarize_preference(pref: "UserPreference") -> str:
    """Return a short human-readable summary of saved preferences."""
    parts: list[str] = []

    if pref.direccion:
        parts.append(f"dirección: {pref.direccion}")
    if pref.ubicacion:
        parts.append(f"ubicación: {pref.ubicacion}")
    if pref.pais:
        parts.append(f"país: {pref.pais}")

    if pref.m2 is not None:
        parts.append(f"{int(pref.m2)} m²")

    if pref.bedrooms is not None:
        hab = "dormitorio" if pref.bedrooms == 1 else "dormitorios"
        parts.append(f"{pref.bedrooms} {hab}")

    if pref.bathrooms is not None:
        btxt = "baño" if pref.bathrooms == 1 else "baños"
        parts.append(f"{pref.bathrooms} {btxt}")

    def _fmt_price(v: float) -> str:
        return f"S/ {int(v):,}".replace(",", ".")

    if pref.min_price is not None and pref.max_price is not None:
        parts.append(f"presupuesto {_fmt_price(pref.min_price)}–{_fmt_price(pref.max_price)}")
    elif pref.max_price is not None:
        parts.append(f"hasta {_fmt_price(pref.max_price)}")
    elif pref.min_price is not None:
        parts.append(f"desde {_fmt_price(pref.min_price)}")

    nearby_items = _parse_nearby(pref.nearby_places)
    if nearby_items:
        labels = [
            f"{item['name']}{'*' if item['priority'] == PRIORITY_REQUIRED else ''}"
            for item in nearby_items[:2]
        ]
        parts.append("cerca de: " + ", ".join(labels))

    if pref.property_type:
        parts.append(f"tipo: {pref.property_type}")

    return ", ".join(parts) if parts else "sin criterios guardados todavía"
