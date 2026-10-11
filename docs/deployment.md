# Deployment and operating notes

## Services

- Frontend: the illustrated UI from `ui` is served by the provided Node web container. Set `PUBLIC_API_URL` to the browser-reachable API URL and allow the web origin through `ALLOWED_ORIGINS`. The browser creates a random visitor key and keeps it in local storage, so there is no sign-in setup.
- API: deploy `infra/Dockerfile.python` with its default command. Set all non-public values from `.env.example` as secrets. Requests include the anonymous `X-Visitor-Key` header to keep scans and reports separate between browsers.
- Worker: deploy the same Python image with command `rq worker scans analyses --url "$REDIS_URL" --with-scheduler`. Run one or more independently of API traffic.
- Database: use TigerData PostgreSQL. Run `alembic upgrade head` before a new API release. No analytics warehouse is required.
- Media: create a private S3-compatible bucket with no public ACL, server-side encryption, and a lifecycle rule to delete `scans/` and `face/` objects after 24 hours (or the configured retention). CORS is unnecessary because uploads pass through the API. Run `python -m skimple.ops purge-expired-media` hourly to clear database references and provide a second deletion mechanism.
- Redis: provide a private Redis instance to the API and worker. Keep queues private; job IDs contain internal UUIDs only.

The local Compose file is development infrastructure. Its MinIO bucket must be created once through the console or S3 CLI. Docker Desktop must be running before `docker compose up`.

### Tiger Data connection

Create a Tiger Cloud service with TimescaleDB enabled. For a development or demo database, Shared compute is the free option; check its current storage and feature limits in the console. Copy the service connection string into the ignored `.env` file as `DATABASE_URL`, changing only the `postgres://` prefix to `postgresql+psycopg://` for this project's Psycopg driver. Keep the `sslmode=require` query parameter. In deployment, provide the same value as a secret to both API and worker. Run `uv run alembic upgrade head` to create or update the schema; Alembic reads `DATABASE_URL` from the environment or `.env`.

## Research and review operations

1. Load the starter INCI names with `python -m skimple.ops seed-ingredients db/seeds/ingredients.json`.
2. Fetch a bounded PubMed set, enrich DOI metadata through OpenAlex, and stage structured abstract extractions with `python -m skimple.research search 'Niacinamide' --limit 5`. These extractions are **not** automatically published as claims.
3. Have a scientific reviewer check paper identity, route, population, methods, concentration, contradictions, and retraction status. Save a claim JSON containing `ingredient`, `outcome`, `effect`, `confidence`, `synthesis`, `version`, `reviewed_by`, and `papers` (each with a verified `pmid`, `relation`, `relevance`). Publish with `python -m skimple.research curate claim.json`. An example is in `docs/claim-example.json` and is illustrative only.
4. Document rights to use review content before setting `REVIEW_ALLOWED_DOMAINS` and running `python -m skimple.ops approve-review-source example.com --permission-note 'contract reference and permitted uses'`. The environment allowlist and database approval must both match. Only aspect observations and source URLs are stored; full review text is not retained.
5. Verify a confirmed catalog formula before it may appear as an alternative: `python -m skimple.ops verify-formulation FORMULATION_ID --reviewer NAME --source-url https://...`. This is an expert action, not an automatic consequence of one user's confirmation.

## Privacy and quality gates

- Product photos expire; face photos require separate consent and are disabled until the pilot evaluation passes. `DELETE /v1/me/skin-photo` removes retained face media; `DELETE /v1/me/data` removes the current visitor's scans, profile, analyses, reports, feedback and media. Clearing browser storage also loses the visitor key, so the browser can no longer retrieve or delete that saved data. Catalog formulations and de-identified scientific records are shared and retained.
- Sentry receives IDs, error categories and spans. Request bodies are disabled in the API SDK; never add prompts, photos, profile answers or review text to traces.
- Run golden-set evaluations and specialist review before enabling a controlled beta. The repository has a test harness and a sample contract; it does not contain the representative product photos or expert labels needed to claim the accuracy targets in the plan.
- Confirm third-party API quotas and review content-use terms. Provider failures leave an explicit limitation or actionable error. Do not replace missing research with generated citations.
