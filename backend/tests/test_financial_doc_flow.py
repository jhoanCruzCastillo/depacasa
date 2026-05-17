from __future__ import annotations

import os
from types import SimpleNamespace

import pytest

os.environ["DEBUG"] = "false"

from app.services import web_conversation as wc


def _build_session() -> SimpleNamespace:
    return SimpleNamespace(
        site_user_id=None,
        matched_record_ids=["rec-1"],
        current_match_index=0,
        extracted_criteria={},
        info_step=7,
        state="presenting",
        country=None,
        name=None,
        phone=None,
        ideal_description="quiero comprar una casa en surco",
    )


def test_interest_requires_financial_doc_for_any_property(monkeypatch):
    session = _build_session()

    monkeypatch.setattr(wc, "_hydrate_lead_from_db", lambda session_obj, lead, db: lead)

    response = wc._do_interested(session, "lo quiero", SimpleNamespace())

    assert session.info_step == 12
    assert session.state == "collecting_info"
    assert "sustento" in response["message"].lower()
    lead = (session.extracted_criteria or {}).get("_lead") or {}
    assert lead.get("requires_financial_capacity_doc") is True


def test_interest_with_contact_data_still_requires_financial_doc(monkeypatch):
    session = _build_session()

    monkeypatch.setattr(
        wc,
        "_hydrate_lead_from_db",
        lambda session_obj, lead, db: {
            **lead,
            "full_name": "Juan Perez",
            "country_of_residence": "Peru",
            "whatsapp": "999111222",
            "document_number": "12345678",
        },
    )

    response = wc._do_interested(session, "lo quiero", SimpleNamespace())

    assert session.info_step == 12
    assert session.state == "collecting_info"
    assert "capacidad de compra" in response["message"].lower()


def test_extract_financial_doc_from_media_path():
    value = wc._extract_financial_capacity_doc("Adjunto: /media/chat_uploads/20260517/s1/archivo.pdf")
    assert value == "/media/chat_uploads/20260517/s1/archivo.pdf"


@pytest.mark.asyncio
async def test_step12_captures_financial_doc_and_moves_to_contact(monkeypatch):
    session = _build_session()
    session.info_step = 12
    session.state = "collecting_info"
    session.extracted_criteria = {"_lead": {"requires_financial_capacity_doc": True}}

    monkeypatch.setattr(wc, "_hydrate_lead_from_db", lambda session_obj, lead, db: lead)
    monkeypatch.setattr(wc, "_get_missing_lead_fields", lambda lead: ["pais de residencia"])

    response = await wc._handle_contact_capture_step(
        session,
        "te paso el enlace https://drive.google.com/file/d/abc123/view",
        SimpleNamespace(),
    )

    assert response is not None
    assert session.info_step == 9
    lead = (session.extracted_criteria or {}).get("_lead") or {}
    assert lead.get("financial_capacity_doc", "").startswith("https://drive.google.com")


@pytest.mark.asyncio
async def test_step12_rejects_missing_document_reference(monkeypatch):
    session = _build_session()
    session.info_step = 12
    session.state = "collecting_info"
    session.extracted_criteria = {"_lead": {"requires_financial_capacity_doc": True}}

    monkeypatch.setattr(wc, "_hydrate_lead_from_db", lambda session_obj, lead, db: lead)

    response = await wc._handle_contact_capture_step(
        session,
        "te lo comparto luego",
        SimpleNamespace(),
    )

    assert response is not None
    assert "no pude identificar" in response["message"].lower()
