# Skimple

Skimple combines the illustrated interface with FastAPI, worker, and storage services. `live.js` connects the product shelf and skin profile to the API.

## Local development

1. Copy `.env.example` to `.env` and set the Gemini, Nimble, S3, TigerData `DATABASE_URL` (including `sslmode=require`), and Redis values. Set `ALLOWED_ORIGINS` to the address where you open the UI. The API, worker and migrations all require this URL; there is no local database fallback.
2. Start infrastructure: `docker compose up -d redis minio`. Create the private `skimple-media` bucket in MinIO. PostgreSQL runs in TigerData; the optional Compose `local-postgres` profile is only for explicit offline development.
3. Install Python dependencies and migrate: `uv sync && uv run alembic upgrade head`.
4. Start the API: `uv run uvicorn skimple.api:app --reload --app-dir apps/api`.
5. Start the worker: `uv run rq worker scans analyses --url redis://localhost:6379/0 --with-scheduler --worker-class rq.worker.SimpleWorker`.
6. Start the UI: `npm install && npm run dev`. Open `http://localhost:3000`.

Open the HTTP address to use the connected app. Opening `index.html` as a file forwards to `http://localhost:3000`, preserving the current page. Both the UI and API servers must be running, and the researched catalog must be seeded using the command below. Loading failures show a persistent retry button on the shelf.

The UI server reads `PUBLIC_API_URL` from its environment; it defaults to `http://localhost:8000`. Shelf products load from the database catalog; an unavailable service does not substitute sample products. Scans made with real product photos use the API for extraction, confirmation, review processing, analysis, reports, and report-grounded chat. Bookmarks, the separate "My products" shelf, and questionnaire answers (including extra context and any photo observation text) sync to the anonymous visitor record. The AM/PM routine and watch-outs use those saved answers and products. Face-photo observation remains subject to `ENABLE_FACE_PHOTO`; when disabled, the UI reports that the pilot is unavailable rather than inventing an observation. When enabled, the profile page deletes the uploaded photo after receiving its text observations.

## Data and evidence

Product photos are uploaded privately for extraction and expire under the configured media retention. The backend only publishes ingredient findings linked to reviewed claims and papers. Review themes only include sources with recorded use permission; missing coverage is shown explicitly. The catalog contains full published formulas with region, retrieval date, source URLs and disclosed concentrations. Staged PubMed literature is labeled as awaiting scientific review; it cannot affect benefit scores until reviewed claims are curated. The optional demo face remains labeled as an example.

Each browser has an anonymous visitor key in local storage. Clearing it loses access to saved reports, favorites, and the "My products" shelf. The API also provides `DELETE /v1/me/data` for complete visitor data removal. See [deployment notes](docs/deployment.md) for research curation and privacy operations.

## Seed the researched catalog

After migrations, run the repeatable import against the configured `DATABASE_URL`:

```sh
PYTHONPATH=apps/api uv run python -m skimple.ops seed-products db/seeds/products.json --literature db/research/papers.json --dry-run
PYTHONPATH=apps/api uv run python -m skimple.ops seed-products db/seeds/products.json --literature db/research/papers.json
```

The bundle includes the six original shelf products and four additional products, with nine verified PubMed records. Re-running it creates no duplicates. See [the catalog research notes](docs/catalog-research.md) for sources, limitations and refresh operations.

## Checks

Run `uv run pytest`, `uv run ruff check apps/api/skimple tests`, `uv run ruff format --check apps/api tests`, and `npm run build`. Run `SKIMPLE_TEST_POSTGRES=1 uv run pytest` to exercise the same backend suite on TigerData in a temporary, isolated schema that is removed afterward. An optional `SKIMPLE_TEST_DATABASE_URL` overrides `.env` for that test run. Application tables are never used by tests.

With the UI server on port 4173 and Playwright Chromium installed, run `npm test` for the browser regression journey (API responses are intercepted). See [database cutover and verification](docs/deployment.md#transfer-an-existing-local-database) for data migration. API documentation is at `http://localhost:8000/docs`.

With both API and UI running against the seeded TigerData database, run `SKIMPLE_TEST_LIVE=1 npm run test:connected` for real browser checks of search, formulas, sources, chat, favorites, profiles and owned-product persistence. It creates a fresh anonymous visitor and removes that visitor's data afterward. The UI defaults to `http://localhost:3000`; `BASE_URL` can override it and must be included in `ALLOWED_ORIGINS`.
