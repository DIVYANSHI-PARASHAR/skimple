# Skimple

Skimple combines the illustrated `ui` branch with the FastAPI, worker, and storage services from `main`. The original UI stylesheet and prototype script are kept byte for byte. `live.js` connects its controls to the API and renders live report data in the same layout.

## Local development

1. Copy `.env.example` to `.env` and set the Gemini, Nimble, S3, PostgreSQL, and Redis values. Set `ALLOWED_ORIGINS` to the address where you open the UI.
2. Start infrastructure: `docker compose up -d postgres redis minio`. Create the private `skimple-media` bucket in MinIO.
3. Install Python dependencies and migrate: `uv sync && uv run alembic upgrade head`.
4. Start the API: `uv run uvicorn skimple.api:app --reload --app-dir apps/api`.
5. Start the worker: `uv run rq worker scans analyses --url redis://localhost:6379/0 --with-scheduler --worker-class rq.worker.SimpleWorker`.
6. Start the UI: `npm install && npm run dev`. Open `http://localhost:3000`.

The UI server reads `PUBLIC_API_URL` from its environment; it defaults to `http://localhost:8000`. The six illustrated shelf products are interactive samples. Scans made with real product photos use the API for extraction, confirmation, review processing, analysis, reports, and report-grounded chat. Saved products and questionnaire answers sync to the anonymous visitor record. Face-photo observation remains subject to `ENABLE_FACE_PHOTO`; when disabled, the UI reports that the pilot is unavailable rather than inventing an observation.

## Data and evidence

Product photos are uploaded privately for extraction and expire under the configured media retention. The backend only publishes ingredient findings linked to reviewed claims and papers. Review themes only include sources with recorded use permission; missing coverage is shown explicitly. The UI's sample product research and demo face remain labeled examples.

Each browser has an anonymous visitor key in local storage. Clearing it loses access to saved reports and favorites. The API also provides `DELETE /v1/me/data` for complete visitor data removal. See [deployment notes](docs/deployment.md) for research curation and privacy operations.

## Checks

Run `uv run pytest`, `uv run ruff check apps/api/skimple tests`, and `npm run build`. With the UI server on port 4173 and Playwright Chromium installed, run `npm test` for the live browser journey. API documentation is at `http://localhost:8000/docs`.
