"""Evaluate Gemini aspect classification on licensed, human-labeled review text."""

import argparse
import json
from pathlib import Path

from skimple.providers import classify_review


def score(manifest: list[dict], root: Path) -> dict:
    true_positive = false_positive = false_negative = 0
    errors = []
    for item in manifest:
        try:
            content = (root / item["text_path"]).read_text()
            found = classify_review(content, item["product_identity"])
            actual = {(f.aspect, f.sentiment) for f in found.findings if f.explicitly_about_product}
            expected = {(f["aspect"], f["sentiment"]) for f in item["findings"]}
            true_positive += len(actual & expected)
            false_positive += len(actual - expected)
            false_negative += len(expected - actual)
        except Exception as exc:  # noqa: BLE001 - continue scoring the remaining samples
            errors.append({"text_path": item["text_path"], "error": type(exc).__name__})
    precision = (
        true_positive / (true_positive + false_positive) if true_positive + false_positive else None
    )
    recall = (
        true_positive / (true_positive + false_negative) if true_positive + false_negative else None
    )
    return {
        "samples": len(manifest),
        "precision": precision,
        "recall": recall,
        "false_positive": false_positive,
        "false_negative": false_negative,
        "errors": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    print(json.dumps(score(json.loads(args.manifest.read_text()), args.manifest.parent), indent=2))


if __name__ == "__main__":
    main()
