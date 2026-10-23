"""
Единая защита административных эндпоинтов (admin auth).

Использование:
    from security import require_admin_auth
    api_router = APIRouter(prefix="/api", dependencies=[require_admin_auth])  # для admin-роутера

Токен задаётся переменной окружения ADMIN_API_TOKEN.
Если токен не задан и ENVIRONMENT=production — сервер НЕ стартует (fail-fast).
Если токен не задан в dev — запросы разрешаются без авторизации (об этом пишется warning).
"""
import logging
import os
import secrets

from fastapi import HTTPException, Request, status

logger = logging.getLogger(__name__)


def _get_expected_token() -> str:
    """Читает токен при каждом вызове, чтобы его можно было задать позже/в тестах."""
    return os.environ.get("ADMIN_API_TOKEN", "").strip()


def is_production() -> bool:
    return os.environ.get("ENVIRONMENT", "development").lower() in ("production", "prod")


def validate_admin_config_at_startup() -> None:
    """Вызывается на startup: в проде запрещаем запускать открытый admin-API."""
    if not _get_expected_token() and is_production():
        raise RuntimeError(
            "ADMIN_API_TOKEN must be set when ENVIRONMENT=production: "
            "admin endpoints are disabled without authentication."
        )
    if not _get_expected_token():
        logger.warning(
            "ADMIN_API_TOKEN is not set - admin endpoints are UNPROTECTED. "
            "This is allowed only in development."
        )


def extract_token_from_request(request: Request) -> str:
    """Извлекает админ-токен из Bearer / X-Admin-Token / query ?token=."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    provided = request.headers.get("X-Admin-Token", "").strip()
    if provided:
        return provided
    return request.query_params.get("token", "").strip()


async def check_admin_token_request(request: Request):
    """
    Возвращает None, если запрос разрешён, иначе HTTP-код (401).
    Используется middleware в server.py и FastAPI-зависимостями.
    """
    expected = _get_expected_token()
    if not expected:
        # В dev без токена — пропускаем. В prod такой ситуации быть не должно:
        # startup fail-fast в validate_admin_config_at_startup().
        return None
    provided = extract_token_from_request(request)
    if not provided or not secrets.compare_digest(provided, expected):
        return status.HTTP_401_UNAUTHORIZED
    return None


async def verify_admin_token(request: Request) -> None:
    """
    FastAPI dependency: проверяет Bearer-токен / X-Admin-Token / query ?token=.
    Небросовый параметр confirm=CONFIRM больше не является защитой.
    """
    code = await check_admin_token_request(request)
    if code is not None:
        raise HTTPException(
            status_code=code,
            detail="Unauthorized: valid admin token required",
            headers={"WWW-Authenticate": "Bearer"},
        )


from fastapi import Depends  # noqa: E402

# Готовая зависимость для использования в dependencies=[Depends(require_admin_auth)]
require_admin_auth = Depends(verify_admin_token)
