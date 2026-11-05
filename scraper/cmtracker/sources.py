"""Öffentliche Cardmarket-Downloads (Produktkatalog und Price Guide).

Die Dateien liegen auf downloads.s3.cardmarket.com – ohne Login und ohne Cloudflare-Schutz.
"""

from __future__ import annotations

import time
from datetime import date, datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

import requests

BASE = "https://downloads.s3.cardmarket.com/productCatalog"
PRODUCTS_NONSINGLES_URL = BASE + "/productList/products_nonsingles_{game_id}.json"
PRICE_GUIDE_URL = BASE + "/priceGuide/price_guide_{game_id}.json"

BERLIN = ZoneInfo("Europe/Berlin")
USER_AGENT = "cm-market-tracker/0.1 (daily catalog sync)"

PRODUCT_FIELDS = ("idProduct", "name", "idCategory", "categoryName", "idExpansion", "dateAdded")
PRICE_FIELDS = ("idProduct", "avg", "low", "trend")

Fetcher = Callable[[str], dict[str, Any]]


class SourceError(RuntimeError):
    """Download fehlgeschlagen oder Datei hat nicht das erwartete Format."""


def fetch_json(url: str, attempts: int = 3, timeout: int = 90) -> dict[str, Any]:
    last_err: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            resp = requests.get(url, timeout=timeout, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as err:
            last_err = err
            if attempt < attempts:
                time.sleep(5 * attempt)
    raise SourceError(f"Download fehlgeschlagen nach {attempts} Versuchen: {url} ({last_err})")


def parse_created_at(value: str) -> datetime:
    """'2026-11-05T02:50:00+0100' -> zeitzonenbewusstes datetime."""
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S%z")
    except (TypeError, ValueError) as err:
        raise SourceError(f"Unbekanntes createdAt-Format: {value!r}") from err


def berlin_date(dt: datetime) -> date:
    return dt.astimezone(BERLIN).date()


def validate_products(payload: dict[str, Any]) -> list[dict[str, Any]]:
    products = payload.get("products")
    if not isinstance(products, list) or not products:
        raise SourceError("Produktkatalog enthält keine Produktliste.")
    missing = [f for f in PRODUCT_FIELDS if f not in products[0]]
    if missing:
        raise SourceError(f"Produktkatalog: Felder fehlen {missing}")
    parse_created_at(payload.get("createdAt"))
    return products


def validate_price_guide(payload: dict[str, Any]) -> list[dict[str, Any]]:
    guides = payload.get("priceGuides")
    if not isinstance(guides, list) or not guides:
        raise SourceError("Price Guide enthält keine Preisliste.")
    missing = [f for f in PRICE_FIELDS if f not in guides[0]]
    if missing:
        raise SourceError(f"Price Guide: Felder fehlen {missing}")
    parse_created_at(payload.get("createdAt"))
    return guides
