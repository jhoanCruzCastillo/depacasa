"""Credit settings, packages, and advisor balance management."""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from app.models.credit_settings import CreditSettings
from app.models.credit_package import CreditPackage
from app.models.credit_transaction import CreditTransaction
from app.models.payment import Payment
from app.models.sales_advisor import SalesAdvisor
from app.routers.chat.advisors import _get_current_advisor

DRONS_PROVIDER = "drons"

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


class AdvisorCreditsOut(BaseModel):
    balance: int
    transactions: List[TransactionOut]


class PurchaseIn(BaseModel):
    package_id: str


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
    return {
        "balance": current.credit_balance or 0,
        "transactions": [
            {
                "id": str(t.id),
                "type": t.type,
                "amount": t.amount,
                "balance_after": t.balance_after,
                "description": t.description,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in txs
        ],
    }


@router.post("/purchase")
def purchase_credits(
    data: PurchaseIn,
    current: SalesAdvisor = Depends(_get_current_advisor),
    db: Session = Depends(get_db),
):
    """
    Creates a pending payment session and returns the Drons Pay checkout URL.
    Credits are granted only after the payment page confirms the transaction.
    Designed so swapping Drons for Stripe requires only this endpoint.
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

    new_balance = (advisor.credit_balance or 0) + payment.credits_granted

    tx = CreditTransaction(
        advisor_id=advisor.id,
        type="purchase",
        amount=payment.credits_granted,
        balance_after=new_balance,
        description=f"Compra Drons Pay: {payment.credits_granted} créditos",
        package_id=payment.package_id,
        payment_id=payment.id,
    )
    db.add(tx)

    advisor.credit_balance = new_balance
    payment.status = "completed"
    payment.provider_payment_id = str(payment.id)
    payment.provider_metadata = {
        "card_name": data.card_name,
        "card_last4": data.card_number[-4:] if len(data.card_number) >= 4 else "****",
        "card_expiry": data.card_expiry,
        "gateway": "drons_simulated",
    }
    db.commit()

    return DronsPayOut(
        status="completed",
        credits_granted=payment.credits_granted,
        new_balance=new_balance,
        redirect_url="/asesores?payment=success",
    )
