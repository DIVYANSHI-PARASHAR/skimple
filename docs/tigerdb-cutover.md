# TigerData cutover — October 11, 2026

Merged `origin/main` at `21bd305` into `merge-main-and-tigerdb`, preserving the seeded catalog commit `7feb5e4`. Conflict resolutions retain both the catalog retry behavior and scan progress/error handling, with both browser regressions covered.

The active ignored `.env` points to TigerData. API and worker were restarted and their database connections verified against TigerData over TLS. No application process uses local PostgreSQL. Missing `DATABASE_URL` now fails configuration instead of falling back to localhost.

## Data verification

Both databases use Alembic revision `c4a920f17b62`. Every source application row was verified in the destination, including foreign keys and JSON metadata. A repeated dry run required zero new rows.

| Records | TigerData after transfer |
| --- | ---: |
| Brands | 8 |
| Products / formulations | 10 / 10 |
| Formula ingredient entries | 207 |
| Ingredients | 143 |
| Papers / staged findings | 9 / 10 |
| Original visitor records | 1 |

The 138 local ingredients were combined with existing TigerData starter ingredients. Eleven names overlapped and five starter entries were additional; existing IDs and synonyms were preserved. Papers and findings retain their original review status. No scientific approvals or review permissions were invented.

## Checks completed

- All 32 backend tests passed locally and against an isolated TigerData schema. The temporary schema was removed.
- Alembic migration checks passed for SQLite and TigerData; `alembic check` detected no schema changes.
- Ruff lint/format and the JavaScript build passed.
- Browser regression tests passed, including catalog retry, shelf search, scan progress/failure recovery and responsive layouts.
- The connected browser journey passed against the real API: catalog, full formulas, paper links, chat, search, favorites, questionnaire and owned-product persistence after reload.
- A synthetic Squalane label passed through real MinIO upload, Redis/RQ, Gemini extraction, product lookup, confirmation against the existing catalog formulation, analysis, report retrieval, chat, alternatives, feedback and visitor isolation. Test visitors and uploaded photos were removed afterward.

Redis and MinIO run through Compose; local PostgreSQL is excluded from normal Compose startup. The private media bucket has one-day expiry rules. The existing face-photo pilot remains disabled by configuration.

## Recovery

The local source database remains intact. Private, Git-ignored backups are stored under `.local-backups/tigerdb-cutover-20261011/`: `local-postgres.dump` is a full custom-format PostgreSQL archive, and `tiger-before-import.json` records the destination's starter data before import. Restore the archive into a separate recovery database with `pg_restore`; avoid overwriting the active TigerData database. Credentials are not included in these files.

See [deployment instructions](deployment.md#transfer-an-existing-local-database) for the repeatable transfer command and [the README](../README.md#checks) for test commands.
