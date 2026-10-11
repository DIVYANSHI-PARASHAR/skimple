"""Evaluate abstract-only extraction against expert labels without publishing claims."""

import argparse
import json
from pathlib import Path

from skimple.research import extract_study

FIELDS = (
    "outcome",
    "route",
    "design",
    "concentration",
    "sample_size",
    "effect_direction",
    "topical_human_relevance",
)


def score(manifest: list[dict]) -> dict:
    correct = total = 0
    by_field = {field: {"correct": 0, "total": 0} for field in FIELDS}
    errors = []
    for index, item in enumerate(manifest):
        try:
            found = extract_study(item["abstract"], item["ingredient"])
            for field in FIELDS:
                if field not in item["expected"]:
                    continue
                match = getattr(found, field) == item["expected"][field]
                correct += match
                total += 1
                by_field[field]["correct"] += match
                by_field[field]["total"] += 1
        except Exception as exc:  # noqa: BLE001 - continue scoring the remaining samples
            errors.append({"sample": index, "error": type(exc).__name__})
    return {
        "samples": len(manifest),
        "field_accuracy": correct / total if total else None,
        "by_field": by_field,
        "errors": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    print(json.dumps(score(json.loads(args.manifest.read_text())), indent=2))


if __name__ == "__main__":
    main()
