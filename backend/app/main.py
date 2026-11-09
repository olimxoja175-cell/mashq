from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import admin, auth, meetings, profile, realtime
from .config import get_settings
from .realtime.pipeline import get_stack
from .security.ratelimit import allow

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("worldvoice")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    s.resolved_secret_key()  # fail fast in production if secrets are missing
    s.resolved_data_key()
    if s.dev_mode:
        log.warning("WORLDVOICE is running in DEVELOPMENT MODE — demo accounts and dev codes are enabled")
        from . import seed

        await seed.main(["--demo"])
    get_stack()
    yield


app = FastAPI(
    title="WORLDVOICE API",
    version="1.0.0",
    description="Secure multilingual presidential video communication platform. "
                "All mutating requests require the `X-WV-Request: 1` header (CSRF defence) and a session cookie.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-WV-Request"],
)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/"):
        ip = request.client.host if request.client else "?"
        if not await allow(f"api:{ip}", 600, 60):
            return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
        # CSRF: browsers cannot attach this custom header cross-site without a CORS preflight,
        # which our CORS policy rejects for foreign origins. Combined with SameSite=Strict cookies.
        if request.method not in SAFE_METHODS and request.headers.get("x-wv-request") != "1":
            return JSONResponse({"detail": "Missing X-WV-Request header"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if get_settings().cookie_secure:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "worldvoice", "ai": get_stack().status()}


app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(meetings.router)
app.include_router(admin.router)
app.include_router(realtime.router)
