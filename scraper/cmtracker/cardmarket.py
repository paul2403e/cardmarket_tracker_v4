"""Cardmarket-spezifische Konstanten und URL-Regeln."""

from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlencode

BASE_URL = "https://www.cardmarket.com"
LOCALE = "de"  # einheitlich deutsche Seiten -> deutsches Zahlenformat beim Parsen

# Sprach-Filter auf Produktseiten (Parameter "language")
LANGUAGE_IDS = {"en": 1, "fr": 2, "de": 3, "es": 4, "it": 5, "zh": 6, "ja": 7, "pt": 8, "ru": 9, "ko": 10}

LANGUAGE_NAMES_DE = {
    "Englisch": "en", "Französisch": "fr", "Deutsch": "de", "Spanisch": "es", "Italienisch": "it",
    "S-Chinesisch": "zh", "Japanisch": "ja", "Portugiesisch": "pt", "Russisch": "ru", "Koreanisch": "ko",
    "T-Chinesisch": "zh-tw", "Niederländisch": "nl", "Polnisch": "pl", "Tschechisch": "cs",
    "Indonesisch": "id", "Thailändisch": "th",
}
# Alle Sprach-IDs, die im Filterformular vorkommen können (zum Auslesen der verfügbaren Sprachen)
LANGUAGE_BY_ID = {v: k for k, v in LANGUAGE_IDS.items()} | {11: "zh-tw", 12: "nl", 13: "pl", 14: "cs",
                                                          16: "id", 17: "th"}

# Artikelstandort (deutsche Bezeichnung auf der Website) -> ISO-Ländercode
COUNTRY_CODES_DE = {
    "Österreich": "AT", "Belgien": "BE", "Bulgarien": "BG", "Schweiz": "CH", "Zypern": "CY",
    "Tschechien": "CZ", "Deutschland": "DE", "Dänemark": "DK", "Estland": "EE", "Spanien": "ES",
    "Finnland": "FI", "Frankreich": "FR", "Vereinigtes Königreich": "GB", "Griechenland": "GR",
    "Ungarn": "HU", "Irland": "IE", "Italien": "IT", "Liechtenstein": "LI", "Litauen": "LT",
    "Luxemburg": "LU", "Lettland": "LV", "Malta": "MT", "Niederlande": "NL", "Norwegen": "NO",
    "Polen": "PL", "Portugal": "PT", "Rumänien": "RO", "Schweden": "SE", "Singapur": "SG",
    "Slowenien": "SI", "Slowakei": "SK", "Kanada": "CA", "Kroatien": "HR", "Japan": "JP",
    "Island": "IS",
}


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


def product_url(game_path: str, category_slug: str, name: str) -> str | None:
    if not category_slug:
        return None
    return f"{BASE_URL}/{LOCALE}/{game_path}/Products/{category_slug}/{slugify(name)}"


def normalize_url(url: str) -> str:
    """Produkt-URL vereinheitlichen: immer deutsche Seite (/de/), ohne Filter-Parameter.

    Der Parser liest deutsche Beschriftungen ("Verfügbare Artikel", "Artikelstandort" …); eine
    englische Seite würde Felder leer lassen."""
    url = url.split("?")[0].split("#")[0]
    if url.startswith("/"):
        url = BASE_URL + url
    return re.sub(r"^(https://www\.cardmarket\.com)/[a-z]{2}/", rf"\1/{LOCALE}/", url)


def search_terms(name: str) -> list[str]:
    """Suchbegriffe von genau nach locker – Cardmarkets Suche findet lange Namen mit Präfix oft nicht."""
    terms = [name]
    if ":" in name:
        terms.append(name.split(":", 1)[1].strip())          # "Pitch Black: Gengar …" -> "Gengar …"
    plain = re.sub(r"[’'`´]", "", terms[-1])
    plain = re.sub(r"(?<=\w)-(?=\w)", " ", plain)          # "Ho-Oh" -> "Ho Oh"
    terms.append(plain)
    return list(dict.fromkeys(t for t in terms if t))


def search_url(game_path: str, name: str) -> str:
    return f"{BASE_URL}/{LOCALE}/{game_path}/Products/Search?" + urlencode({"searchString": name})


def ajax_url(game_path: str, action: str) -> str:
    return f"{BASE_URL}/{LOCALE}/{game_path}/AjaxAction/{action}"


def image_url(id_category: int, id_product: int) -> str:
    return f"https://product-images.s3.cardmarket.com/{id_category}/{id_product}/{id_product}.jpg"


def with_filters(url: str, language: str | None = None, seller_type: int | None = None,
                 seller_country: int | None = None) -> str:
    """Filter als URL-Parameter anhängen (wie im alten Projekt: language=1, sellerCountry=7 …)."""
    params = {}
    if language:
        params["language"] = LANGUAGE_IDS[language]
    if seller_type is not None:
        params["sellerType"] = seller_type
    if seller_country is not None:
        params["sellerCountry"] = seller_country
    if not params:
        return url
    sep = "&" if "?" in url else "?"
    return url + sep + urlencode(params)


def with_language(url: str, language: str | None) -> str:
    return with_filters(url, language=language)
