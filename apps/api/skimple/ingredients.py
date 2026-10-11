import hashlib
import re
import unicodedata

# Starter aliases only. Unknown ingredients keep their packaging name for review.
ALIASES = {
    "aqua": "Water",
    "water": "Water",
    "aqua (water)": "Water",
    "aqua / water / eau": "Water",
    "water (aqua) (eau)": "Water",
    "vitamin b3": "Niacinamide",
    "nicotinamide": "Niacinamide",
    "hyaluronic acid": "Hyaluronic Acid",
    "sodium hyaluronate": "Sodium Hyaluronate",
    "glycerol": "Glycerin",
    "glycerine": "Glycerin",
    "glycerin": "Glycerin",
    "niacinamide": "Niacinamide",
    "panthenol": "Panthenol",
    "provitamin b5": "Panthenol",
    "ceramide np": "Ceramide NP",
    "salicylic acid": "Salicylic Acid",
    "lactic acid": "Lactic Acid",
    "glycolic acid": "Glycolic Acid",
    "ascorbic acid": "Ascorbic Acid",
    "vitamin c": "Ascorbic Acid",
    "retinol": "Retinol",
    "tocopherol": "Tocopherol",
    "vitamin e": "Tocopherol",
    "allantoin": "Allantoin",
    "petrolatum": "Petrolatum",
    "dimethicone": "Dimethicone",
}


def normalize_name(raw: str) -> str:
    name = unicodedata.normalize("NFKC", raw).strip(" .;\n\t")
    name = re.sub(r"\s+", " ", name)
    return ALIASES.get(name.casefold(), name)


def formula_hash(names: list[str]) -> str:
    canonical = "\x1f".join(normalize_name(n).casefold() for n in names)
    return hashlib.sha256(canonical.encode()).hexdigest()
