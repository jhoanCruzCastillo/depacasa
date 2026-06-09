"""Credit settings, packages, and advisor balance management."""
from typing import List, Optional
from uuid import UUID

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from app.models.credit_settings import CreditSettings
from app.models.credit_package import CreditPackage
from app.models.credit_transaction import CreditTransaction
from app.models.payment import Payment
from app.models.sales_advisor import SalesAdvisor
from app.routers.chat.advisors import _get_current_advisor

DRONS_PROVIDER = "drons"
STRIPE_PROVIDER = "stripe"

router = APIRouter(prefix="/api/credits", tags=["credits"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreditSettingsOut(BaseModel):
    base_price: float
    currency: str


class CreditSettingsIn(BaseModel):
    base_price: float = Field(gt=0)
    currency: str = Field(min_length=3, max_length=3)


class PackageOut(BaseModel):
    id: str
    label: str
    credits: int
    price: float
    badge: Optional[str]
    is_highlighted: bool
    is_active: bool
    sort_order: int


class PackageIn(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    credits: int = Field(gt=0)
    price: float = Field(ge=0)
    badge: Optional[str] = None
    is_highlighted: bool = False
    is_active: bool = True
    sort_order: int = 0


class TransactionOut(BaseModel):
    id: str
    type: str
    amount: int
    balance_after: int
    description: Optional[str]
    created_at: Optional[str]
    # enriched from Payment / CreditPackage joins
    package_label: Optional[str] = None
    amount_usd: Optional[float] = None
    payment_method: Optional[str] = None   # "stripe" | "drons" | "admin"
    payment_reference: Optional[str] = None  # Stripe cs_... or payment UUID


class AdvisorCreditsOut(BaseModel):
    balance: int
    transactions: List[TransactionOut]


class PurchaseIn(BaseModel):
    package_id: str
    provider: str = DRONS_PROVIDER  # "drons" or "stripe"


class DronsSessionOut(BaseModel):
    payment_id: str
    status: str
    amount: float
    currency: str
    credits: int
    package_label: str
    advisor_name: Optional[str]


class DronsPayIn(BaseModel):
    card_name: str = Field(min_length=1, max_length=200)
    card_number: str = Field(min_length=4, max_length=20)
    card_expiry: str = Field(min_length=4, max_length=7)


class DronsPayOut(BaseModel):
    status: str
    credits_granted: int
    new_balance: int
    redirect_url: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pkg_out(p: CreditPackage) -> dict:
    return {
        "id": str(p.id),
        "label": p.label,
        "credits": p.credits,
        "price": float(p.price),
        "badge": p.badge,
        "is_highlighted": p.is_highlighted,
        "is_active": p.is_active,
        "sort_order": p.sort_order,
    }


def _grant_credits(
    db: Session,
    payment: Payment,
    advisor: SalesAdvisor,
    description: str,
) -> int:
    """Grants credits for a completed payment. Returns new balance."""
    new_balance = (advisor.credit_balance or 0) + payment.credits_granted
    tx = CreditTransaction(
        advisor_id=advisor.id,
        type="purchase",
        amount=payment.credits_granted,
        balance_after=new_balance,
        description=description,
        package_id=payment.package_id,
        payment_id=payment.id,
    )
    db.add(tx)
    advisor.credit_balance = new_balance
    payment.status = "completed"
    db.commit()
    return new_balance


# ── Credit settings (admin) ───────────────────────────────────────────────────

@router.get("/settings", response_model=CreditSettingsOut)
def get_credit_settings(db: Session = Depends(get_db)):
    row = db.query(CreditSettings).filter_by(id=1).first()
    if not row:
        return {"base_price": 0.50, "currency": "USD"}
    return {"base_price": float(row.base_price), "currency": row.currency}


@router.put("/settings", response_model=CreditSettingsOut)
def update_credit_settings(data: CreditSettingsIn, db: Session = Depends(get_db)):
    row = db.query(CreditSettings).filter_by(id=1).first()
    if not row:
        row = CreditSettings(id=1)
        db.add(row)
    row.base_price = data.base_price
    row.currency = data.currency
    db.commit()
    return {"base_price": float(row.base_price), "currency": row.currency}


# ── Credit packages (admin CRUD) ──────────────────────────────────────────────

@router.get("/packages", response_model=List[PackageOut])
def list_packages(db: Session = Depends(get_db)):
    pkgs = (
        db.query(CreditPackage)
        .order_by(CreditPackage.sort_order, CreditPackage.created_at)
        .all()
    )
    return [_pkg_out(p) for p in pkgs]


@router.get("/packages/public", response_model=List[PackageOut])
def list_packages_public(db: Session = Depends(get_db)):
    pkgs = (
        db.query(CreditPackage)
        .filter_by(is_active=True)
        .order_by(CreditPackage.sort_order, CreditPackage.created_at)
        .all()
    )
    return [_pkg_out(p) for p in pkgs]


@router.post("/packages", response_model=PackageOut, status_code=201)
def create_package(data: PackageIn, db: Session = Depends(get_db)):
    pkg = CreditPackage(**data.model_dump())
    db.add(pkg)
    db.commit()
    db.refresh(pkg)
    return _pkg_out(pkg)


@router.put("/packages/{pkg_id}", response_model=PackageOut)
def update_package(pkg_id: UUID, data: PackageIn, db: Session = Depends(get_db)):
    pkg = db.query(CreditPackage).filter(CreditPackage.id == pkg_id).first()
    if not pkg:
        raise HTTPException(status_code=404, detail="Paquete no encontrado")
    for k, v in data.model_dump().items():
        setattr(pkg, k, v)
    db.commit()
    db.refresh(pkg)
    return _pkg_out(pkg)


@router.delete("/packages/{pkg_id}", status_code=204)
def delete_package(pkg_id: UUID, db: Session = Depends(get_db)):
    pkg = db.query(CreditPackage).filter(CreditPackage.id == pkg_id).first()
    if not pkg:
        raise HTTPException(status_code=404, detail="Paquete no encontrado")
    db.delete(pkg)
    db.commit()


# ── Advisor credit operations ─────────────────────────────────────────────────

@router.get("/me", response_model=AdvisorCreditsOut)
def get_my_credits(
    current: SalesAdvisor = Depends(_get_current_advisor),
    db: Session = Depends(get_db),
):
    txs = (
        db.query(CreditTransaction)
        .filter(CreditTransaction.advisor_id == current.id)
        .order_by(CreditTransaction.created_at.desc())
        .limit(50)
        .all()
    )

    # Batch-load related payments and packages to avoid N+1
    payment_ids = [t.payment_id for t in txs if t.payment_id]
    package_ids = [t.package_id for t in txs if t.package_id]

    payments_by_id: dict = {}
    if payment_ids:
        for p in db.query(Payment).filter(Payment.id.in_(payment_ids)).all():
            payments_by_id[p.id] = p

    packages_by_id: dict = {}
    if package_ids:
        for p in db.query(CreditPackage).filter(CreditPackage.id.in_(package_ids)).all():
            packages_by_id[p.id] = p

    rows = []
    for t in txs:
        payment = payments_by_id.get(t.payment_id) if t.payment_id else None
        package = packages_by_id.get(t.package_id) if t.package_id else None
        rows.append({
            "id": str(t.id),
            "type": t.type,
            "amount": t.amount,
            "balance_after": t.balance_after,
            "description": t.description,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "package_label": package.label if package else None,
            "amount_usd": float(payment.amount_paid) if payment else None,
            "payment_method": payment.provider if payment else None,
            "payment_reference": payment.provider_payment_id if payment else None,
        })

    return {"balance": current.credit_balance or 0, "transactions": rows}


@router.post("/purchase")
def purchase_credits(
    data: PurchaseIn,
    current: SalesAdvisor = Depends(_get_current_advisor),
    db: Session = Depends(get_db),
):
    """
    Creates a pending payment session and returns a checkout URL.
    Pass provider="stripe" to use Stripe Checkout (real test payments).
    Pass provider="drons" (default) to use the simulated Drons Pay page.
    Credits are granted only after payment confirmation / webhook.
    """
    try:
        pkg_id = UUID(data.package_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="ID de paquete inválido")

    pkg = (
        db.query(CreditPackage)
        .filter(CreditPackage.id == pkg_id, CreditPackage.is_active == True)
        .first()
    )
    if not pkg:
        raise HTTPException(status_code=404, detail="Paquete no disponible")

    if data.provider == STRIPE_PROVIDER:
        if not settings.STRIPE_SECRET_KEY:
            raise HTTPException(
                status_code=503,
                detail="Stripe no está configurado. Agrega settings.STRIPE_SECRET_KEY a .env",
            )
        return _purchase_stripe(current, pkg, db)

    # Default: Drons Pay
    return _purchase_drons(current, pkg, db)


def _purchase_drons(
    current: SalesAdvisor,
    pkg: CreditPackage,
    db: Session,
) -> dict:
    payment = Payment(
        advisor_id=current.id,
        package_id=pkg.id,
        amount_paid=pkg.price,
        currency="USD",
        credits_granted=pkg.credits,
        status="pending",
        provider=DRONS_PROVIDER,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    session_id = str(payment.id)
    return {
        "checkout_url": f"/drons-pay/{session_id}",
        "session_id": session_id,
    }


def _purchase_stripe(
    current: SalesAdvisor,
    pkg: CreditPackage,
    db: Session,
) -> dict:
    # Create pending record first so we have an internal payment_id for metadata
    payment = Payment(
        advisor_id=current.id,
        package_id=pkg.id,
        amount_paid=pkg.price,
        currency="USD",
        credits_granted=pkg.credits,
        status="pending",
        provider=STRIPE_PROVIDER,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    try:
        stripe.api_key = settings.STRIPE_SECRET_KEY
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "product_data": {
                            "name": pkg.label,
                            "description": f"{pkg.credits} créditos · plataforma Depacasa",
                        },
                        # Stripe uses integer cents
                        "unit_amount": int(float(pkg.price) * 100),
                    },
                    "quantity": 1,
                }
            ],
            mode="payment",
            # {CHECKOUT_SESSION_ID} is replaced by Stripe on redirect
            success_url=(
                f"{settings.FRONTEND_URL}/asesores"
                f"?payment=success&stripe_session_id={{CHECKOUT_SESSION_ID}}"
            ),
            cancel_url=f"{settings.FRONTEND_URL}/asesores?payment=cancelled",
            metadata={"payment_id": str(payment.id)},
            customer_email=current.email or None,
        )
    except stripe.StripeError as exc:
        # Roll back the pending record so we don't leave orphan rows
        db.delete(payment)
        db.commit()
        raise HTTPException(status_code=502, detail=f"Stripe error: {exc.user_message}")

    payment.provider_payment_id = checkout_session.id
    db.commit()

    return {
        "checkout_url": checkout_session.url,
        "session_id": str(payment.id),
    }


# ── Drons Pay (simulated gateway) ────────────────────────────────────────────

@router.get("/drons/session/{payment_id}", response_model=DronsSessionOut)
def get_drons_session(payment_id: UUID, db: Session = Depends(get_db)):
    """Public endpoint — the Drons Pay page calls this to render the order."""
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")

    pkg = (
        db.query(CreditPackage).filter(CreditPackage.id == payment.package_id).first()
        if payment.package_id else None
    )
    advisor = (
        db.query(SalesAdvisor).filter(SalesAdvisor.id == payment.advisor_id).first()
        if payment.advisor_id else None
    )
    return DronsSessionOut(
        payment_id=str(payment.id),
        status=payment.status,
        amount=float(payment.amount_paid),
        currency=payment.currency,
        credits=payment.credits_granted,
        package_label=pkg.label if pkg else "Paquete de créditos",
        advisor_name=advisor.name if advisor else None,
    )


@router.post("/drons/session/{payment_id}/pay", response_model=DronsPayOut)
def complete_drons_payment(
    payment_id: UUID,
    data: DronsPayIn,
    db: Session = Depends(get_db),
):
    """
    Simulates payment completion. Stores fake card metadata, grants credits,
    and creates the ledger transaction — mirroring what a real webhook does.
    """
    payment = db.query(Payment).filter(
        Payment.id == payment_id,
        Payment.provider == DRONS_PROVIDER,
        Payment.status == "pending",
    ).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Sesión inválida o ya procesada")

    advisor = db.query(SalesAdvisor).filter(SalesAdvisor.id == payment.advisor_id).first()
    if not advisor:
        raise HTTPException(status_code=404, detail="Asesor no encontrado")

    payment.provider_payment_id = str(payment.id)
    payment.provider_metadata = {
        "card_name": data.card_name,
        "card_last4": data.card_number[-4:] if len(data.card_number) >= 4 else "****",
        "card_expiry": data.card_expiry,
        "gateway": "drons_simulated",
    }

    new_balance = _grant_credits(
        db, payment, advisor,
        f"Compra Drons Pay: {payment.credits_granted} créditos",
    )

    return DronsPayOut(
        status="completed",
        credits_granted=payment.credits_granted,
        new_balance=new_balance,
        redirect_url="/asesores?payment=success",
    )


# ── Stripe webhook ────────────────────────────────────────────────────────────

@router.post("/stripe/webhook", status_code=200)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Receives checkout.session.completed from Stripe and grants credits.
    Stripe must be able to reach this URL — use `stripe listen` locally.
    """
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="STRIPE_WEBHOOK_SECRET no configurado")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        stripe.api_key = settings.STRIPE_SECRET_KEY
        event = stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Firma de webhook inválida")
    except Exception:
        raise HTTPException(status_code=400, detail="Payload de webhook inválido")

    if event["type"] != "checkout.session.completed":
        return {"status": "ignored"}

    # StripeObject uses attribute access, not .get() — use getattr or dot notation
    session_obj = event["data"]["object"]
    metadata = session_obj.metadata or {}
    raw_payment_id = metadata.get("payment_id") if isinstance(metadata, dict) else getattr(metadata, "payment_id", None)
    if not raw_payment_id:
        return {"status": "ignored"}

    try:
        pid = UUID(raw_payment_id)
    except ValueError:
        return {"status": "ignored"}

    payment = db.query(Payment).filter(
        Payment.id == pid,
        Payment.provider == STRIPE_PROVIDER,
        Payment.status == "pending",
    ).first()

    if not payment:
        # Already processed — return 200 so Stripe stops retrying
        return {"status": "already_processed"}

    advisor = db.query(SalesAdvisor).filter(SalesAdvisor.id == payment.advisor_id).first()
    if not advisor:
        return {"status": "advisor_not_found"}

    customer_details = getattr(session_obj, "customer_details", None)
    payment.provider_metadata = {
        "stripe_session_id": session_obj.id,
        "stripe_payment_intent": getattr(session_obj, "payment_intent", None),
        "customer_email": getattr(customer_details, "email", None) if customer_details else None,
        "amount_total": getattr(session_obj, "amount_total", None),
        "currency": getattr(session_obj, "currency", None),
    }

    _grant_credits(
        db, payment, advisor,
        f"Compra Stripe: {payment.credits_granted} créditos",
    )

    return {"status": "ok"}
