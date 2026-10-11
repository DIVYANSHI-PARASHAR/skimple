# Skimple

Skimple combines the illustrated `ui-newpage` branch with the FastAPI, worker, and storage services from `main`. The new page's `app.js`, `profile.js`, `profile.css`, and `index.html` are copied without changes from that branch. `live.js` connects their controls to the API and renders live report data in the same layout.

## Local development

1. Copy `.env.example` to `.env` and set the Gemini, Nimble, S3, PostgreSQL, and Redis values. Set `ALLOWED_ORIGINS` to the address where you open the UI.
2. Start infrastructure: `docker compose up -d postgres redis minio`. Create the private `skimple-media` bucket in MinIO.
3. Install Python dependencies and migrate: `uv sync && uv run alembic upgrade head`.
4. Start the API: `uv run uvicorn skimple.api:app --reload --app-dir apps/api`.
5. Start the worker: `uv run rq worker scans analyses --url redis://localhost:6379/0 --with-scheduler --worker-class rq.worker.SimpleWorker`.
6. Start the UI: `npm install && npm run dev`. Open `http://localhost:3000`.

The UI server reads `PUBLIC_API_URL` from its environment; it defaults to `http://localhost:8000`. The six illustrated shelf products are interactive samples. To add another product, customers can select a Nimble search result with an image or upload one front photo. The API identifies the product, retrieves an exact ingredient list through Nimble, runs the analysis, and adds the report to "My products". If it cannot verify a complete list for the selected variant, it shows an error instead of analyzing a different formula. Bookmarks, the separate "My products" shelf, and questionnaire answers (including extra context and any photo observation text) sync to the anonymous visitor record. The AM/PM routine and watch-outs use those saved answers and products. Face-photo observation remains subject to `ENABLE_FACE_PHOTO`; when disabled, the UI reports that the pilot is unavailable rather than inventing an observation. When enabled, the profile page deletes the uploaded photo after receiving its text observations.

## Data and evidence

Front product photos are uploaded privately for identification and expire under the configured media retention. Ingredient lists are taken from product pages found through Nimble; formulas and availability can differ by variant or region. The backend only publishes ingredient findings linked to reviewed claims and papers. Review themes only include sources with recorded use permission; missing coverage is shown explicitly. The UI's sample product research and demo face remain labeled examples.

Each browser has an anonymous visitor key in local storage. Clearing it loses access to saved reports, favorites, and the "My products" shelf. The API also provides `DELETE /v1/me/data` for complete visitor data removal. See [deployment notes](docs/deployment.md) for research curation and privacy operations.

## Checks

Run `uv run pytest`, `uv run ruff check apps/api/skimple tests`, and `npm run build`. With the UI server on port 4173 and Playwright Chromium installed, run `npm test` for the live browser journey. API documentation is at `http://localhost:8000/docs`.
