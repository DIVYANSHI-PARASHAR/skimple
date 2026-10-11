# Skimple

Mobile-first skincare product scanner. The implementation follows [the product plan](skincare_ai_implementation_plan.md) with a FastAPI API, Redis worker, PostgreSQL storage, and Next.js web app.

## Local development

1. Copy `.env.example` to `.env` and set the OIDC, Gemini, Nimble, S3, PostgreSQL, and Redis values there. The web app reads the same root file. For a local-only run without OIDC, set both `DEV_AUTH_ENABLED=true` and `NEXT_PUBLIC_DEV_AUTH_ENABLED=true`; never use these settings in deployment.
2. Start local infrastructure: `docker compose up -d postgres redis minio`.
3. Install Python dependencies: `uv sync`.
4. Apply migrations: `uv run alembic upgrade head`.
5. Start the API: `uv run uvicorn skimple.api:app --reload --app-dir apps/api`.
6. Start a worker: `uv run rq worker scans analyses --url redis://localhost:6379/0 --with-scheduler --worker-class rq.worker.SimpleWorker`.
7. Install web dependencies: `npm install`, then run `npm run dev`.

The API is at `http://localhost:8000`, the web app at `http://localhost:3000`, and MinIO's console at `http://localhost:9001`. For local development, create the private `skimple-media` bucket in MinIO. In production, use TigerData PostgreSQL, a private S3-compatible bucket with lifecycle expiry, a managed OIDC provider, and deployed API/worker services.

## What works

- Authenticated front/back image upload with format, dimensions and size validation, private object storage, and queued extraction.
- Gemini structured extraction, INCI normalization, bounded Nimble product search, user correction, and formulation persistence.
- Questionnaire profile, confirmed-formulation analysis, deterministic compatibility rules, report retrieval, and deletion endpoints.
- Research ingestion commands for PubMed/OpenAlex, a source-verified claim model, and a conservative evidence fallback when curated claims are unavailable.
- Source-permission-gated review processing. Unlicensed pages are not stored or analyzed.

## Rollout gates

Live integrations require credentials and source-use permissions. Scientific claims need domain review and a curated evidence corpus before a public beta. The experimental face-photo feature is disabled by default and requires representative evaluation. See [deployment notes](docs/deployment.md).

Run `uv run pytest` and `npm run lint` to verify the code. API docs are at `/docs` in development.
