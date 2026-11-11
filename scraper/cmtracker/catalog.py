"""Meilenstein 1: Katalog und Price Guide täglich übernehmen.

Ablauf eines Laufs:
1. Produktkatalog (Non-Singles) und Price Guide herunterladen und prüfen.
2. Rohdateien unverändert archivieren (Price Guide auf Non-Singles gefiltert).
3. Tagespreise (avg, low, trend) als Parquet speichern.
4. Katalog-Zustand fortschreiben: neue / verschwundene Produkte, Scope, Angebote vorhanden, aktiv.
5. Zustand und Lauf-Metadaten speichern (state.json zuletzt – gilt als "Lauf abgeschlossen").
"""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

import pandas as pd
import pyarrow as pa

from . import sources
from .settings import Scope
from .storage import Storage, df_to_parquet, parquet_to_df

STATE_COLUMNS = [
    "id_product", "name", "id_category", "category_name", "id_expansion", "id_metacard",
    "cm_date_added", "first_seen", "last_seen", "removed_since",
    "in_scope", "has_offers", "active", "offerless_since", "excluded_reason",
]


STATE_SCHEMA = pa.schema([
    ("id_product", pa.int64()), ("name", pa.string()), ("id_category", pa.int64()),
    ("category_name", pa.string()), ("id_expansion", pa.int64()), ("id_metacard", pa.int64()),
    ("cm_date_added", pa.string()), ("first_seen", pa.date32()), ("last_seen", pa.date32()),
    ("removed_since", pa.date32()), ("in_scope", pa.bool_()), ("has_offers", pa.bool_()),
    ("active", pa.bool_()), ("offerless_since", pa.date32()), ("excluded_reason", pa.string()),
])

PRICE_SCHEMA = pa.schema([
    ("date", pa.date32()), ("id_product", pa.int64()),
    ("avg", pa.float64()), ("low", pa.float64()), ("trend", pa.float64()),
])


class ValidationError(RuntimeError):
    """Der neue Katalog sieht unplausibel aus – Lauf wird abgebrochen."""


@dataclass
class Keys:
    game: str

    def raw_catalog(self, d: date) -> str:
        return f"raw/catalog/{self.game}/date={d.isoformat()}/products_nonsingles.json.gz"

    def raw_price_guide(self, d: date) -> str:
        return f"raw/priceguide/{self.game}/date={d.isoformat()}/price_guide_nonsingles.json.gz"

    def price_guide_day(self, d: date) -> str:
        return f"priceguide/{self.game}/date={d.isoformat()}/part.parquet"

    @property
    def catalog_state(self) -> str:
        return f"catalog/{self.game}/products.parquet"

    @property
    def run_state(self) -> str:
        return f"catalog/{self.game}/state.json"

    @property
    def meta(self) -> str:
        return f"catalog/{self.game}/meta.parquet"


@dataclass
class CatalogResult:
    data_date: date
    catalog_created_at: str
    price_guide_created_at: str
    first_run: bool
    state: pd.DataFrame
    prices: pd.DataFrame
    new_ids: set[int]
    removed_ids: set[int]
    reactivated_ids: set[int]
    warnings: list[str] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)   # Schwellen überschritten -> Mail
    storage_description: str = ""
    storage_persistent: bool = True


def _to_date(value: Any) -> date | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return pd.Timestamp(value).date()


def _gz_json(payload: dict[str, Any]) -> bytes:
    return gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def load_no_language_ids(storage: Storage, keys: Keys, scope: Scope) -> set[int]:
    """Aus den Scraper-Stammdaten: Produkte ohne eine der gewünschten Sprachen (z. B. nur ID/TH)."""
    data = storage.get(keys.meta)
    if not data:
        return set()
    meta = parquet_to_df(data)
    out = set()
    for pid, langs in zip(meta["id_product"], meta["languages"]):
        langs = list(langs) if langs is not None else []
        if langs and not any(lang in langs for lang in scope.languages):
            out.add(int(pid))
    return out


def build_state(
    products: list[dict[str, Any]],
    prices: dict[int, dict[str, Any]],
    previous: pd.DataFrame | None,
    scope: Scope,
    data_date: date,
    no_language: set[int] | frozenset[int] = frozenset(),
) -> tuple[pd.DataFrame, set[int], set[int], set[int]]:
    """Neuen Katalog-Zustand aus heutigem Katalog, Price Guide und Vortages-Zustand berechnen.

    no_language: Produkte, die Cardmarket in keiner der gewünschten Sprachen führt (vom Scraper erkannt)
    – sie werden dauerhaft aus dem Scope genommen."""
    prev: dict[int, dict[str, Any]] = {}
    if previous is not None:
        prev = {int(r["id_product"]): r for r in previous.to_dict("records")}

    rows: list[dict[str, Any]] = []
    seen: set[int] = set()
    new_ids: set[int] = set()
    reactivated: set[int] = set()

    for p in products:
        pid = int(p["idProduct"])
        if pid in seen:  # doppelte Einträge im Katalog ignorieren
            continue
        seen.add(pid)
        old = prev.get(pid)
        if previous is not None and old is None:
            new_ids.add(pid)
        has_offers = (prices.get(pid) or {}).get("low") is not None
        if has_offers:
            offerless_since = None
        elif old is not None and _to_date(old.get("offerless_since")) is not None:
            offerless_since = _to_date(old["offerless_since"])
        else:
            offerless_since = data_date
        excluded_reason = None
        if int(p["idCategory"]) not in scope.category_ids:
            excluded_reason = "Kategorie"
        elif scope.is_excluded(pid, p["name"]):
            excluded_reason = "Ausschluss-Regel"
        elif pid in no_language:
            excluded_reason = "keine passende Sprache"
        in_scope = excluded_reason is None
        active = in_scope and has_offers
        if old is not None and active and not bool(old.get("active")):
            reactivated.add(pid)
        rows.append({
            "id_product": pid,
            "name": p["name"],
            "id_category": int(p["idCategory"]),
            "category_name": p["categoryName"],
            "id_expansion": int(p["idExpansion"]) if p.get("idExpansion") is not None else None,
            "id_metacard": int(p["idMetacard"]) if p.get("idMetacard") is not None else None,
            "cm_date_added": str(p.get("dateAdded") or "")[:10] or None,
            "first_seen": _to_date(old["first_seen"]) if old is not None else data_date,
            "last_seen": data_date,
            "removed_since": None,
            "in_scope": in_scope,
            "has_offers": has_offers,
            "active": active,
            "offerless_since": offerless_since,
            "excluded_reason": excluded_reason,
        })

    # Produkte, die nicht mehr im Katalog stehen: behalten, aber markieren.
    removed: set[int] = set()
    for pid, old in prev.items():
        if pid in seen:
            continue
        was_removed = _to_date(old.get("removed_since")) is not None
        if not was_removed:
            removed.add(pid)
        row = {k: old.get(k) for k in STATE_COLUMNS}
        row.update({
            "removed_since": _to_date(old["removed_since"]) if was_removed else data_date,
            "in_scope": False, "has_offers": False, "active": False,
        })
        rows.append(row)

    reactivated -= new_ids
    df = pd.DataFrame(rows, columns=STATE_COLUMNS)
    for col in ("first_seen", "last_seen", "removed_since", "offerless_since"):
        df[col] = pd.Series([_to_date(v) for v in df[col]], dtype="object")
    for col in ("in_scope", "has_offers", "active"):
        df[col] = df[col].astype(bool)
    df = df.sort_values("id_product").reset_index(drop=True)
    return df, new_ids, removed, reactivated


def run(scope: Scope, storage: Storage, fetch: sources.Fetcher = sources.fetch_json,
        thresholds: dict | None = None, now: datetime | None = None) -> CatalogResult:
    gid = scope.cardmarket_game_id
    keys = Keys(scope.game_key)
    warnings: list[str] = []

    print("⬇️  Lade Produktkatalog und Price Guide …", flush=True)
    catalog_raw = fetch(sources.PRODUCTS_NONSINGLES_URL.format(game_id=gid))
    guide_raw = fetch(sources.PRICE_GUIDE_URL.format(game_id=gid))
    products = sources.validate_products(catalog_raw)
    guides = sources.validate_price_guide(guide_raw)

    guide_created = sources.parse_created_at(guide_raw["createdAt"])
    data_date = sources.berlin_date(guide_created)
    print(f"   Katalog: {len(products)} Produkte (Stand {catalog_raw['createdAt']})", flush=True)
    print(f"   Price Guide: {len(guides)} Einträge (Stand {guide_raw['createdAt']}) → Datentag {data_date}", flush=True)

    prev_state_bytes = storage.get(keys.run_state)
    prev_run = json.loads(prev_state_bytes) if prev_state_bytes else None
    prev_df_bytes = storage.get(keys.catalog_state)
    previous = parquet_to_df(prev_df_bytes) if prev_df_bytes else None
    first_run = previous is None

    if prev_run:
        prev_count = int(prev_run.get("catalog_product_count", 0))
        if prev_count and len(products) < prev_count * scope.min_products_ratio:
            raise ValidationError(
                f"Katalog hat nur {len(products)} Produkte, beim letzten Lauf waren es {prev_count}. "
                "Abbruch, damit keine unvollständigen Daten gespeichert werden."
            )
        if prev_run.get("price_guide_created_at") == guide_raw["createdAt"]:
            warnings.append(
                "Der Price Guide wurde seit dem letzten Lauf nicht aktualisiert "
                f"(Stand {guide_raw['createdAt']}). Die Tagesdaten wurden überschrieben, nicht neu angelegt."
            )

    product_ids = {int(p["idProduct"]) for p in products}
    guide_ns = [g for g in guides if int(g["idProduct"]) in product_ids]
    prices = {int(g["idProduct"]): g for g in guide_ns}
    missing_prices = len(product_ids - prices.keys())
    if missing_prices:
        warnings.append(f"{missing_prices} Produkte haben keinen Eintrag im Price Guide.")

    no_language = load_no_language_ids(storage, keys, scope)
    state, new_ids, removed_ids, reactivated_ids = build_state(products, prices, previous, scope, data_date,
                                                               no_language)

    prices_df = pd.DataFrame(
        [{
            "date": data_date,
            "id_product": int(g["idProduct"]),
            "avg": g.get("avg"),
            "low": g.get("low"),
            "trend": g.get("trend"),
        } for g in guide_ns],
        columns=["date", "id_product", "avg", "low", "trend"],
    ).astype({"avg": "float64", "low": "float64", "trend": "float64"})

    print(f"💾 Speichere nach {storage.describe()} …", flush=True)
    storage.put(keys.raw_catalog(data_date), _gz_json(catalog_raw), "application/gzip")
    storage.put(
        keys.raw_price_guide(data_date),
        _gz_json({"version": guide_raw.get("version"), "createdAt": guide_raw["createdAt"], "priceGuides": guide_ns}),
        "application/gzip",
    )
    storage.put(keys.price_guide_day(data_date), df_to_parquet(prices_df, PRICE_SCHEMA))
    storage.put(keys.catalog_state, df_to_parquet(state, STATE_SCHEMA))
    run_state = {
        "data_date": data_date.isoformat(),
        "catalog_created_at": catalog_raw["createdAt"],
        "price_guide_created_at": guide_raw["createdAt"],
        "catalog_product_count": len(products),
        "in_scope": int(state["in_scope"].sum()),
        "active": int(state["active"].sum()),
        "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    storage.put(keys.run_state, json.dumps(run_state, indent=2).encode("utf-8"), "application/json")

    # Plausibilität: Price Guide zu alt? Aktive Produkte stark gesunken?
    issues: list[str] = []
    t = (thresholds or {}).get("catalog", {})
    today = (now or datetime.now(timezone.utc)).astimezone(sources.BERLIN).date()
    age = (today - data_date).days
    if age >= int(t.get("price_guide_stale_days", 2)):
        issues.append(f"Der Price Guide von Cardmarket ist {age} Tage alt (Stand {guide_raw['createdAt']}).")
    if prev_run and prev_run.get("active"):
        prev_active, now_active = int(prev_run["active"]), int(state["active"].sum())
        drop = (prev_active - now_active) / prev_active
        if drop > float(t.get("active_drop_max", 0.10)):
            issues.append(f"Aktive Produkte von {prev_active} auf {now_active} gesunken ({drop:.0%}).")
    # Speicher: wird täglich beim Tagesbericht gemessen (storage_usage.py)

    if not storage.is_persistent:
        warnings.append(
            "R2 ist noch nicht eingerichtet: Die Daten wurden nur für diesen Lauf gespeichert. "
            "Die Review-Datei ist trotzdem vollständig."
        )

    return CatalogResult(
        data_date=data_date,
        catalog_created_at=catalog_raw["createdAt"],
        price_guide_created_at=guide_raw["createdAt"],
        first_run=first_run,
        state=state,
        prices=prices_df,
        new_ids=new_ids,
        removed_ids=removed_ids,
        reactivated_ids=reactivated_ids,
        warnings=warnings,
        issues=issues,
        storage_description=storage.describe(),
        storage_persistent=storage.is_persistent,
    )
