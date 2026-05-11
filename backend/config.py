import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """Application configuration"""
    
    # Server
    API_TITLE: str = "PropScraper API"
    API_VERSION: str = "0.1.0"
    DEBUG: bool = os.getenv("DEBUG", "True").lower() == "true"
    
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://proptech:proptech@localhost:5432/proptech_db"
    )
    
    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # Celery
    CELERY_BROKER_URL: str = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/1")
    CELERY_RESULT_BACKEND: str = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/2")
    
    # Tavily API
    TAVILY_API_KEY: str = os.getenv("TAVILY_API_KEY", "")

    # Anthropic API
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    # Twilio WhatsApp
    TWILIO_ACCOUNT_SID: str = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN: str = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_WHATSAPP_NUMBER: str = os.getenv("TWILIO_WHATSAPP_NUMBER", "whatsapp:+14155238886")

    # Visual selector
    MAX_BROWSER_SESSIONS: int = int(os.getenv("MAX_BROWSER_SESSIONS", "3"))
    
    # Auth
    SECRET_KEY: str = os.getenv("SECRET_KEY", "change-me-in-production-use-a-long-random-string")
    JWT_EXPIRE_DAYS: int = int(os.getenv("JWT_EXPIRE_DAYS", "30"))

    # Email (Resend)
    RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")
    FROM_EMAIL: str = os.getenv("FROM_EMAIL", "onboarding@resend.dev")

    # CORS
    CORS_ORIGINS: list = ["http://localhost:5173", "http://localhost:3000"]
    
    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
