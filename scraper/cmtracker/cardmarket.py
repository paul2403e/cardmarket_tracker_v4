"""Cardmarket-spezifische Konstanten und URL-Regeln."""

from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlencode

BASE_URL = "https://www.cardmarket.com"
LOCALE = "de"  # einheitlich deutsche Seiten -> deutsches Zahlenformat beim Parsen

# Sprach-Filter auf Produktseiten (Parameter "language")
LANGUAGE_IDS = {"en": 1, "fr": 2, "de": 3, "es": 4, "it": 5, "zh": 6, "ja": 7, "pt": 8, "ru": 9, "ko": 10}

# Katalog-Kategorie -> Pfadsegment auf der Website. Wird in der Erkundung überprüft.
CATEGORY_SLUGS = {
    53: "Booster-Boxes",          # Pokémon Display
    1016: "Elite-Trainer-Boxes",  # Pokémon Elite Trainer Boxes
    1015: "Box-Sets",             # Pokémon Box Set
    1014: "Tins",                 # Pokémon Tins
    1083: "Blisters",             # Pokémon Blisters
}

GAME_PATHS = {"pokemon": "Pokemon"}


def slugify(name: str) -> str:
    """Produktname -> URL-Teil, wie Cardmarket ihn bildet (Vermutung, wird in der Erkundung geprüft).

    'Black Bolt & White Flare: Unova Mini Tin Display' -> 'Black-Bolt-White-Flare-Unova-Mini-Tin-Display'
    'Pokémon Card 151 Booster Box'                     -> 'Pokemon-Card-151-Booster-Box'
    """
    text = unicodedata.normalize("NFKD", name)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^A-Za-z0-9\s-]", "", text)
    text = re.sub(r"[\s-]+", "-", text).strip("-")
    return text


def product_url(game_key: str, id_category: int, name: str) -> str | None:
    category = CATEGORY_SLUGS.get(id_category)
    if not category:
        return None
    return f"{BASE_URL}/{LOCALE}/{GAME_PATHS[game_key]}/Products/{category}/{slugify(name)}"


def search_url(game_key: str, name: str) -> str:
    return f"{BASE_URL}/{LOCALE}/{GAME_PATHS[game_key]}/Products/Search?" + urlencode({"searchString": name})


def with_language(url: str, language: str | None) -> str:
    if not language:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}language={LANGUAGE_IDS[language]}"
