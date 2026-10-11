# Private packaging benchmark

Create a manifest in this folder using the schema at the top of `evals/extraction_runner.py`, plus licensed front/back photos. Include similar variants, regional packaging, glare, curved bottles and small type. Keep any user-owned or copyrighted photos out of Git unless use and retention rights are documented.

Run with `PYTHONPATH=apps/api uv run python evals/extraction_runner.py evals/datasets/packaging.json`. The runner reports exact identity, strict ingredient-list accuracy, and position-level ingredient accuracy. Human annotations remain the ground truth; these numbers are not established until a representative dataset is collected.

For review evaluation, create a private JSON manifest of `{ "text_path": "review.txt", "product_identity": "Brand Product Variant", "findings": [{"aspect":"hydration","sentiment":"positive"}] }` records and run `PYTHONPATH=apps/api uv run python evals/review_runner.py MANIFEST.json`. Use only text that may be processed under the source's terms.

For scientific extraction, create a private JSON manifest of `{ "ingredient": "INCI name", "abstract": "licensed abstract text", "expected": { "outcome": "...", "route": "topical", "design": "...", "effect_direction": "...", "topical_human_relevance": true } }` records and run `PYTHONPATH=apps/api uv run python evals/study_runner.py MANIFEST.json`. Expert labels are required before these results can be interpreted.
