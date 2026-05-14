from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # DB / Redis
    database_url: str = "postgresql+asyncpg://huashan:huashan_dev@localhost:5432/huashan"
    redis_url: str = "redis://localhost:6379/0"

    # 会话
    session_secret: str = "dev-session-secret-change-me"
    anon_cookie_name: str = "hs_anon"
    anon_cookie_max_age: int = 60 * 60 * 24 * 365  # 1 年
    auth_secret: str = "dev-auth-secret-change-me"
    password_hash_pepper: str = "dev-password-pepper-change-me"
    auth_cookie_name: str = "hs_session"
    auth_cookie_secure: bool = False
    auth_session_max_age: int = 60 * 60 * 24 * 30  # 30 天

    # Skill
    skill_dir: Path = Path("/app/skills/huashan-lungu-v2")

    # CORS
    cors_origins: str = "http://localhost:3000"

    # 限流
    rate_limit_per_day: int = 20

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
