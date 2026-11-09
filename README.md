# WORLDVOICE — AI interpreted video conferencing for heads of state

**Development mode** (no AI keys) uses a labelled DEV glossary instead of real translation. Nothing is claimed as connected unless its key is set.

## Local run (tested on Windows, Python 3.14, Node 24)
```bash
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
cp ../.env.example .env   # set WV_DEV_MODE=true for demo
.venv/Scripts/alembic upgrade head
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
cd ../frontend && npm ci && npm run build && npx next start -p 3000
```
Open http://localhost:3000 · API docs http://127.0.0.1:8000/docs

Demo accounts (dev only), password `WorldVoice#2026`; the MFA code is shown on the verify page in dev mode (TOTP secret `JBSWY3DPEHPK3PXP`):
uz.president@, cn.president@, gb.pm@, eg.president@, fr.minister@, security@, admin@ — all `@demo.worldvoice`.

## Tests
```bash
cd backend && .venv/Scripts/python -m pytest -q          # 37 integration/unit tests
PYTHONIOENCODING=utf-8 .venv/Scripts/python e2e/browser_e2e.py   # 16 browser checks (servers running, fresh DB)
```

## Production (Docker — NOT yet tested: Docker was not available on the build machine)
```bash
cp .env.example .env   # fill secrets, WV_DEV_MODE=false, WV_DOMAIN
docker compose up -d --build
docker compose exec backend python -m app.seed --admin admin@your.gov 'StrongPass#2026'
```
Caddy terminates TLS (ports 80/443); coturn relays media (3478/5349, UDP 49160-49200).

## Credentials needed for real AI
`ANTHROPIC_API_KEY` (translation), `OPENAI_API_KEY` (speech recognition + generic voice), `ELEVENLABS_API_KEY` (consented voice identity), `WV_TURN_SECRET` + public TURN host.
