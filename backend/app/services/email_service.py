"""Email sending via Resend."""

import resend
from config import settings

resend.api_key = settings.RESEND_API_KEY
FROM = settings.FROM_EMAIL


def send_email(to: str, subject: str, html: str) -> bool:
    """Send a single email. Returns True on success, False on failure."""
    if not settings.RESEND_API_KEY:
        return False
    try:
        resend.Emails.send({"from": FROM, "to": to, "subject": subject, "html": html})
        return True
    except Exception as e:
        print(f"[email] error sending to {to}: {e}")
        return False


def send_welcome(to: str, name: str) -> bool:
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px 24px">
      <h2 style="color:#1e3a5f;margin-bottom:8px">¡Bienvenido, {name}!</h2>
      <p style="color:#475569">Tu cuenta ha sido creada exitosamente. Ya puedes guardar tus propiedades favoritas y recibir novedades personalizadas.</p>
      <p style="color:#94a3b8;font-size:13px;margin-top:32px">Si no creaste esta cuenta, puedes ignorar este correo.</p>
    </div>
    """
    return send_email(to, "¡Bienvenido al portal!", html)
