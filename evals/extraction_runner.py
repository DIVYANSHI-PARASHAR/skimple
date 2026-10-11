"""Run a private, labeled packaging set against the configured Gemini model.

Manifest schema: [{"front": "path", "back": "path", "brand": "...",
"product_name": "...", "variant": "...", "ingredients_in_order": ["..."]}]
"""

import argparse
import json
from pathlib import Path

from PIL import Image
from skimple.ingredients import normalize_name
from skimple.providers import extract_product


def image_payload(path: Path) -> tuple[bytes, str]:
    with Image.open(path) as image:
        mime = Image.MIME[image.format]
    return path.read_bytes(), mime


def score(manifest: list[dict], root: Path) -> dict:
    identity_correct = exact_list = tokens_correct = tokens_total = 0
    errors = []
    for item in manifest:
        try:
            found = extract_product(
                image_payload(root / item["front"]), image_payload(root / item["back"])
            )
            expected_identity = tuple(
                item[x].strip().casefold() for x in ("brand", "product_name", "variant")
            )
            actual_identity = tuple(
                getattr(found, x).strip().casefold() for x in ("brand", "product_name", "variant")
            )
            identity_correct += actual_identity == expected_identity
            expected = [normalize_name(x).casefold() for x in item["ingredients_in_order"]]
            actual = [normalize_name(x).casefold() for x in found.ingredients_in_order]
            exact_list += actual == expected
            tokens_total += len(expected)
            tokens_correct += sum(a == b for a, b in zip(actual, expected))
        except Exception as exc:  # noqa: BLE001 - keep scoring other benchmark samples
            errors.append({"front": item["front"], "error": type(exc).__name__})
    total = len(manifest)
    return {
        "samples": total,
        "identity_exact_accuracy": identity_correct / total if total else None,
        "ingredient_exact_list_accuracy": exact_list / total if total else None,
        "ingredient_position_accuracy": tokens_correct / tokens_total if tokens_total else None,
        "errors": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    print(json.dumps(score(json.loads(args.manifest.read_text()), args.manifest.parent), indent=2))


if __name__ == "__main__":
    main()
