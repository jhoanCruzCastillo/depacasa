"""Preference V2 and consolidated context helpers."""

from __future__ import annotations

from copy import deepcopy


ALLOWED_MODES = {"preferencia", "obligatorio"}


def normalize_mode(value: str | None, default: str = "preferencia") -> str:
    raw = str(value or "").strip().lower()
    return raw if raw in ALLOWED_MODES else default


def _default_numeric_value() -> dict:
    return {"tipo": "exacto", "exacto": None, "min": None, "max": None}


def default_preferences_v2() -> dict:
    return {
        "ubicacion": {"modo": "preferencia", "valor": None},
        "zonas_cercanas": {"modo": "preferencia", "valor": []},
        "areas_comunes": {"modo": "preferencia", "valor": []},
        "habitaciones": {"modo": "preferencia", "valor": _default_numeric_value()},
        "banos": {"modo": "preferencia", "valor": _default_numeric_value()},
        "metros_cuadrados": {"modo": "preferencia", "valor": _default_numeric_value()},
    }


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


def _numeric_from_criteria(exact: int | float | None, minimum: int | float | None, maximum: int | float | None) -> dict:
    payload = _default_numeric_value()
    if exact is not None:
        try:
            payload["exacto"] = int(exact)
            payload["tipo"] = "exacto"
            return payload
        except Exception:
            return payload

    has_min = minimum is not None
    has_max = maximum is not None
    if has_min or has_max:
        payload["tipo"] = "rango"
        if has_min:
            try:
                payload["min"] = int(minimum)  # type: ignore[arg-type]
            except Exception:
                payload["min"] = None
        if has_max:
            try:
                payload["max"] = int(maximum)  # type: ignore[arg-type]
            except Exception:
                payload["max"] = None
    return payload


def build_preferences_v2_from_criteria(criteria: dict | None, previous: dict | None = None) -> dict:
    c = criteria or {}
    pref = deepcopy(previous) if isinstance(previous, dict) else default_preferences_v2()

    location = (c.get("location") or "").strip()
    nearby = _clean_terms(c.get("nearby_zones") or [])
    common_areas = _clean_terms(c.get("common_areas") or [])

    pref["ubicacion"] = {
        "modo": normalize_mode(c.get("location_mode"), pref["ubicacion"].get("modo")),
        "valor": location or pref["ubicacion"].get("valor"),
    }
    pref["zonas_cercanas"] = {
        "modo": normalize_mode(c.get("nearby_zones_mode"), pref["zonas_cercanas"].get("modo")),
        "valor": nearby or pref["zonas_cercanas"].get("valor") or [],
    }
    pref["areas_comunes"] = {
        "modo": normalize_mode(c.get("common_areas_mode"), pref["areas_comunes"].get("modo")),
        "valor": common_areas or pref["areas_comunes"].get("valor") or [],
    }

    pref["habitaciones"] = {
        "modo": normalize_mode(c.get("bedrooms_mode"), pref["habitaciones"].get("modo")),
        "valor": _numeric_from_criteria(c.get("bedrooms"), c.get("bedrooms_min"), c.get("bedrooms_max")),
    }
    pref["banos"] = {
        "modo": normalize_mode(c.get("bathrooms_mode"), pref["banos"].get("modo")),
        "valor": _numeric_from_criteria(c.get("bathrooms"), c.get("bathrooms_min"), c.get("bathrooms_max")),
    }
    pref["metros_cuadrados"] = {
        "modo": normalize_mode(c.get("area_mode"), pref["metros_cuadrados"].get("modo")),
        "valor": _numeric_from_criteria(c.get("area_exact"), c.get("area_min"), c.get("area_max")),
    }
    return pref


def _numeric_to_criteria(value: dict | None, exact_key: str, min_key: str, max_key: str) -> dict:
    if not isinstance(value, dict):
        return {}
    out: dict = {}
    kind = str(value.get("tipo") or "exacto").lower()
    if kind == "rango":
        if value.get("min") is not None:
            out[min_key] = value.get("min")
        if value.get("max") is not None:
            out[max_key] = value.get("max")
    else:
        if value.get("exacto") is not None:
            out[exact_key] = value.get("exacto")
    return out


def criteria_from_preferences_v2(preferences_v2: dict | None, context: dict | None = None) -> dict:
    pref = preferences_v2 if isinstance(preferences_v2, dict) else default_preferences_v2()
    out: dict = {"features": [], "keywords": []}

    location = (pref.get("ubicacion", {}).get("valor") or "").strip()
    if location:
        out["location"] = location
    out["location_mode"] = normalize_mode(pref.get("ubicacion", {}).get("modo"), "preferencia")

    nearby = _clean_terms(pref.get("zonas_cercanas", {}).get("valor") or [])
    if nearby:
        out["nearby_zones"] = nearby
        near_terms = [f"cerca de {term}" for term in nearby]
        out["features"].extend(near_terms)
        out["keywords"].extend(near_terms)
    out["nearby_zones_mode"] = normalize_mode(pref.get("zonas_cercanas", {}).get("modo"), "preferencia")

    common = _clean_terms(pref.get("areas_comunes", {}).get("valor") or [])
    if common:
        out["common_areas"] = common
        out["features"].extend(common)
        out["keywords"].extend(common)
    out["common_areas_mode"] = normalize_mode(pref.get("areas_comunes", {}).get("modo"), "preferencia")

    room_value = pref.get("habitaciones", {}).get("valor")
    out.update(_numeric_to_criteria(room_value, "bedrooms", "bedrooms_min", "bedrooms_max"))
    out["bedrooms_mode"] = normalize_mode(pref.get("habitaciones", {}).get("modo"), "preferencia")

    bath_value = pref.get("banos", {}).get("valor")
    out.update(_numeric_to_criteria(bath_value, "bathrooms", "bathrooms_min", "bathrooms_max"))
    out["bathrooms_mode"] = normalize_mode(pref.get("banos", {}).get("modo"), "preferencia")

    area_value = pref.get("metros_cuadrados", {}).get("valor")
    out.update(_numeric_to_criteria(area_value, "area_exact", "area_min", "area_max"))
    out["area_mode"] = normalize_mode(pref.get("metros_cuadrados", {}).get("modo"), "preferencia")

    ctx = context if isinstance(context, dict) else {}
    budget_ctx = ctx.get("budget_context") or {}
    if isinstance(budget_ctx, dict):
        if budget_ctx.get("min") is not None:
            out["min_price"] = budget_ctx.get("min")
        if budget_ctx.get("max") is not None:
            out["max_price"] = budget_ctx.get("max")
        if budget_ctx.get("strictness"):
            out["budget_mode"] = normalize_mode(budget_ctx.get("strictness"), "preferencia")

    out["features"] = _clean_terms(out.get("features"))
    out["keywords"] = _clean_terms(out.get("keywords"))
    if not out["features"]:
        out.pop("features", None)
    if not out["keywords"]:
        out.pop("keywords", None)
    return {k: v for k, v in out.items() if v not in (None, "", [], {})}


def merge_consolidated_context(
    existing_context: dict | None,
    criteria: dict | None,
    description: str,
    extra_context: dict | None = None,
) -> dict:
    existing = existing_context if isinstance(existing_context, dict) else {}
    criteria = criteria or {}
    extra = extra_context if isinstance(extra_context, dict) else {}

    budget = dict(existing.get("budget_context") or {})
    if criteria.get("min_price") is not None:
        budget["min"] = criteria.get("min_price")
    if criteria.get("max_price") is not None:
        budget["max"] = criteria.get("max_price")
    budget["currency"] = budget.get("currency") or "PEN"
    if budget.get("min") is not None or budget.get("max") is not None:
        budget["strictness"] = normalize_mode(
            criteria.get("budget_mode"),
            budget.get("strictness") or "preferencia",
        )

    lead_profile = dict(existing.get("lead_profile") or {})
    lead_data = criteria.get("_lead")
    if isinstance(lead_data, dict):
        lead_profile.update({
            "full_name": lead_data.get("full_name") or lead_profile.get("full_name"),
            "country": lead_data.get("country_of_residence") or lead_profile.get("country"),
            "whatsapp": lead_data.get("whatsapp") or lead_profile.get("whatsapp"),
            "document": lead_data.get("document_number") or lead_profile.get("document"),
            "financial_capacity_doc": (
                lead_data.get("financial_capacity_doc") or lead_profile.get("financial_capacity_doc")
            ),
        })
    lead_profile.update(extra.get("lead_profile") or {})

    behavior = dict(existing.get("behavior_signals") or {})
    behavior.setdefault("viewed_record_ids", [])
    behavior.setdefault("rated_record_ids", [])
    behavior.setdefault("interested_record_ids", [])
    behavior.setdefault("discarded_record_ids", [])
    behavior.update(extra.get("behavior_signals") or {})

    memory = dict(existing.get("conversation_memory") or {})
    memory["last_search_description"] = description or memory.get("last_search_description")
    memory.update(extra.get("conversation_memory") or {})
    memory.setdefault("ajustes_aceptados", [])
    memory.setdefault("ajustes_rechazados", [])

    out = {
        "budget_context": budget if budget else {},
        "lead_profile": lead_profile if lead_profile else {},
        "behavior_signals": behavior,
        "conversation_memory": memory,
    }
    return out


def summarize_preferences_v2(preferences_v2: dict | None, context: dict | None = None) -> str:
    pref = preferences_v2 if isinstance(preferences_v2, dict) else default_preferences_v2()
    parts: list[str] = []

    loc = (pref.get("ubicacion", {}).get("valor") or "").strip()
    if loc:
        parts.append(f"ubicación: {loc}")

    rooms = pref.get("habitaciones", {}).get("valor") or {}
    if rooms.get("exacto") is not None:
        parts.append(f"{rooms['exacto']} dormitorios")

    baths = pref.get("banos", {}).get("valor") or {}
    if baths.get("exacto") is not None:
        parts.append(f"{baths['exacto']} baños")

    area = pref.get("metros_cuadrados", {}).get("valor") or {}
    if area.get("exacto") is not None:
        parts.append(f"{area['exacto']} m2")
    elif area.get("min") is not None or area.get("max") is not None:
        a_min = area.get("min")
        a_max = area.get("max")
        if a_min is not None and a_max is not None:
            parts.append(f"área {int(a_min)}–{int(a_max)} m2")
        elif a_min is not None:
            parts.append(f"área desde {int(a_min)} m2")
        else:
            parts.append(f"área hasta {int(a_max)} m2")

    nearby = _clean_terms(pref.get("zonas_cercanas", {}).get("valor") or [])
    if nearby:
        parts.append("zonas cercanas: " + ", ".join(nearby[:2]))

    common = _clean_terms(pref.get("areas_comunes", {}).get("valor") or [])
    if common:
        parts.append("áreas comunes: " + ", ".join(common[:2]))

    ctx = context if isinstance(context, dict) else {}
    budget = ctx.get("budget_context") if isinstance(ctx.get("budget_context"), dict) else {}
    b_min = budget.get("min") if budget else None
    b_max = budget.get("max") if budget else None
    currency = (budget.get("currency") or "PEN") if budget else "PEN"
    if b_min is not None or b_max is not None:
        def _fmt_budget(v: float) -> str:
            return f"S/ {int(v):,}".replace(",", ".") if currency == "PEN" else f"USD {int(v):,}".replace(",", ".")
        if b_min is not None and b_max is not None:
            parts.append(f"presupuesto {_fmt_budget(b_min)}–{_fmt_budget(b_max)}")
        elif b_max is not None:
            parts.append(f"hasta {_fmt_budget(b_max)}")
        elif b_min is not None:
            parts.append(f"desde {_fmt_budget(b_min)}")

    return ", ".join(parts) if parts else "sin criterios guardados todavía"
