# Researched product catalog

Research date: 11 October 2026. The source bundle is `db/seeds/products.json`;
the PubMed/OpenAlex snapshot is `db/research/papers.json`. These are real source
records, not test fixtures. All ten products have complete published ingredient
lists, an explicit regional formula, source links, directions and caveats.

| Catalog key | Product | Region | Formula source |
| --- | --- | --- | --- |
| byoma | BYOMA Moisturizing Gel-Cream | US | [Ulta, authorized retailer](https://www.ulta.com/p/moisturizing-gel-cream-pimprod2034790?sku=2601332); [manufacturer corroboration](https://byoma.com/products/moisturizing-gel-cream) |
| ordinary | The Ordinary Niacinamide 10% + Zinc 1% | US | [Manufacturer](https://theordinary.com/en-us/niacinamide-10-zinc-1-serum-100436.html) |
| joseon | Beauty of Joseon Relief Sun: Rice + Niacinamide | EU | [Manufacturer](https://ie.beautyofjoseon.com/products/relief-sun-rice-probiotics-duo-global) |
| cerave | CeraVe Hydrating Facial Cleanser | US | [Manufacturer](https://www.cerave.com/skincare/cleansers/hydrating-facial-cleanser) |
| laroche | La Roche-Posay Cicaplast Baume B5+ | UK | [Manufacturer](https://www.laroche-posay.co.uk/en_GB/cicaplast-baume-b5-repairing-balm/LRP_035.html) |
| cocokind | cocokind Ceramide Barrier Serum | US | [Manufacturer](https://www.cocokind.com/products/ceramide-barrier-serum) |
| vanicream-cleanser | Vanicream Gentle Facial Cleanser | US | [Manufacturer](https://www.vanicream.com/product/vanicream-facial-cleanser) |
| vanicream-moisturizer | Vanicream Daily Facial Moisturizer | US | [Manufacturer](https://www.vanicream.com/product/vanicream-daily-facial-moisturizer) |
| paulas-bha | Paula's Choice SKIN PERFECTING 2% BHA Liquid Exfoliant | US | [Manufacturer](https://www.paulaschoice.com/skin-perfecting-2pct-bha-liquid-exfoliant/201-2010.html) |
| ordinary-squalane | The Ordinary 100% Plant-Derived Squalane | US | [Manufacturer](https://theordinary.com/en-us/100-plant-derived-squalane-face-oil-100398.html) |

Beauty of Joseon renamed Rice + Probiotics to Rice + Niacinamide; the manufacturer
states that the formula is unchanged. Its EU/global sunscreen is distinct from the
US Daily Relief formula. The current cocokind manufacturer page describes a
reformulation with beta-glucan and jojoba oil and no lactic acid; the older FAQ and
retailer formulas must not overwrite it. BYOMA's official page groups ingredients
by function, so the ordered formula comes from Ulta. The source checks file records
successful direct retrieval hashes and the La Roche-Posay page's direct-fetch
failure; that formula was verified through the web source reader.

## Scientific research

The existing `skimple.research.search_pubmed` function was run with a limit of two
for seven ingredient queries. Search results are retained in the snapshot. Nine
additional relevant primary records/reviews were selected by source inspection,
then fetched and PMID-verified with the existing `fetch_pubmed` XML pipeline.
DOIs were enriched through `enrich_openalex`: seven matches and two absent
matches. PubMed retraction annotations and available OpenAlex retraction flags
are retained. A missing flag does not establish that a paper can never be retracted.

| PMID | Topic | Main limitation |
| --- | --- | --- |
| [16766489](https://pubmed.ncbi.nlm.nih.gov/16766489/) | 2% niacinamide and sebum | Outcomes differed between two populations; not a 10% serum trial |
| [12100180](https://pubmed.ncbi.nlm.nih.gov/12100180/) | Niacinamide and pigmentation | 2–5% study formulations; sunscreen co-treatment in one comparison |
| [18025807](https://pubmed.ncbi.nlm.nih.gov/18025807/) | 20% glycerol and hydration | 24 patients; leave-on emollient, not rinse-off cleanser |
| [10965426](https://pubmed.ncbi.nlm.nih.gov/10965426/) | Dexpanthenol and barrier measures | Seven days; concentration/sample size absent from abstract |
| [31585489](https://pubmed.ncbi.nlm.nih.gov/31585489/) | Ceramide moisturizer and xerosis | 24 adults; mixed ingredients applied to shins |
| [33984185](https://pubmed.ncbi.nlm.nih.gov/33984185/) | Ceramide regimen and eczema | Manufacturer sponsorship; no between-group eczema-severity advantage |
| [22052267](https://pubmed.ncbi.nlm.nih.gov/22052267/) | Hyaluronan and hydration | 76 women; 0.1% periocular creams, not the catalog moisturizer |
| [1535287](https://pubmed.ncbi.nlm.nih.gov/1535287/) | 0.5% and 2% salicylic acid pads | Review of four studies; abstract omits sample sizes |
| [32356369](https://pubmed.ncbi.nlm.nih.gov/32356369/) | Cochrane acne review | Many comparisons have low/very-low certainty; multiple treatments |

The existing Nimble `product_candidates` discovery method was run for all ten
products, returning 50 candidates. Results are recorded in
`db/research/product-discovery.json`; discovery results do not override the
published formula sources.

The PubMed/OpenAlex refresh and Gemini extraction completed for all nine papers
and ten ingredient findings using `gemini-3.1-flash-lite`, with `reviewed_by` unset.
Each record includes a machine consistency check against its verified abstract.
Corrections retain the original provider values in `source_check`, including
unsupported design assumptions and an invented funding limitation. These checks
do not constitute scientific review. A future refresh must be checked again.
The old configured model returned a retirement error; the default now uses
[Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).
That model returned a temporary overload error during this run, so the supported
Flash Lite model was used for the completed extraction.
The extraction summaries are staged research, not published clinical claims.
No human reviewer, expert formula approval, review permission, user review,
rating, positive percentage or personalized efficacy score is invented.

The existing scientific curation gate remains in force. A scientific reviewer
can publish a claim using `python -m skimple.research curate claim.json` after
checking the studies. Until then, the UI displays the real literature and its
limitations separately from reviewed claims. Review observations remain empty
until approved sources are configured through the existing review workflow.

To repeat source verification and optionally use the configured Gemini extractor:

```sh
PYTHONPATH=apps/api uv run python -m skimple.research refresh-snapshot db/research/papers.json
# Requires GEMINI_API_KEY; extractions still require scientific review:
PYTHONPATH=apps/api uv run python -m skimple.research refresh-snapshot db/research/papers.json --extract
# Model used for this snapshot:
GEMINI_MODEL=gemini-3.1-flash-lite PYTHONPATH=apps/api uv run python -m skimple.research refresh-snapshot db/research/papers.json --extract
```

The refresh replaces the snapshot atomically after all requests succeed. Changed
abstracts invalidate old extractions unless fresh extraction is requested.

## Database import

Set `DATABASE_URL` for the intended database using the existing environment
configuration. Migrate first, then inspect and import:

```sh
uv run alembic upgrade head
PYTHONPATH=apps/api uv run python -m skimple.ops seed-products db/seeds/products.json --literature db/research/papers.json --dry-run
PYTHONPATH=apps/api uv run python -m skimple.ops seed-products db/seeds/products.json --literature db/research/papers.json
```

The dry run performs the actual inserts and validation and rolls back the entire
transaction. The import is one transaction across products and literature. Exact
formulas are reused; a changed formula creates a new version, preserving scans
and existing reports. Existing expert approvals are preserved. Legacy `demo:`
bookmarks/owned keys for these ten identities are merged into `catalog:` keys
without deleting unrelated user data. Unknown formulas and private reports are
not removed. No fake visitor or scan is created to make catalog products visible.

`GET /v1/catalog` returns source dossiers and questionnaire-aware reports;
`GET /v1/catalog/{key}` returns a product, and the catalog chat endpoint shares
the report-grounded answer logic. The frontend loads these records instead of
hardcoded product fixtures, including after reload and in My products.
